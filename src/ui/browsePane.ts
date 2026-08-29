import type { ClipExtractorElements } from "./elements";
import { setMessage } from "./linkify";
import { bytes } from "../lib/format";
import { friendlyError } from "../lib/errors";
import { loadCachedNames, saveCachedNames } from "../lib/archiveNames";
import {
  canSweep,
  dandisetWebUrl,
  fetchDandisetVideos,
  hydrateDandisetNames,
  archiveSourceOf,
  indexDandisets,
  listManifestObjects,
  mergeDandisets,
  sweepArchiveVideos,
  type ArchiveDandiset,
  type ArchiveSource,
  type ArchiveVideo,
} from "../lib/archives";
import { listEmbargoedVideos, listOwnedEmbargoedDandisets, listPublicDandisetIds, resolveEmbargoedStreamUrl } from "../lib/embargoed";
import { unstreamableRefusal } from "../lib/streamable";
import { fakeArchiveBrowse } from "../lib/testInjection";
import type { ArchiveConfig } from "../lib/types";

// Browsing EMBER for a video to stream.
//
// Two halves, because an archive answers for a public dataset and an embargoed one in completely
// different ways. What is public is read straight out of EMBER's public S3 bucket (lib/archives.ts):
// one listing to learn which datasets exist, then the small `.jsonld` manifests each one publishes,
// with no sign-in and no call to the API. What is embargoed cannot be read that way at all — its
// manifests are listed in the bucket but refuse anonymous reads, which is the point — so a signed-in
// visitor's own datasets are asked of the API instead (lib/embargoed.ts) and merged into the same
// list.

/** What the pane needs from the page around it. Everything here is the host's because it belongs to
 * something other than this pane: the sign-in state, the player the picked video opens in, and the
 * stage that answers for a video asked for anywhere else. */
export interface BrowsePaneHost {
  /** The links a message in this pane may turn into real links — see ui/linkify.ts. */
  appLinks: readonly string[];
  log: (message: string, cls?: "err" | "warn" | "") => void;
  /** The archive config this pane's API calls run under. Unlike the upload destination's, it names
   * no dataset: which one is being read is passed per call. */
  config: () => ArchiveConfig;
  /** Whether every auth-dependent surface should read as signed in, live-smoketest stand-ins
   * included. What the pane can see changes with this and with nothing else, so it is the only
   * thing that forces a rebuild. */
  signedIn: () => boolean;
  /** Whether there is a real token to make an authenticated call with, which `signedIn` alone does
   * not answer: a faked sign-in reads as signed in and has none. */
  hasToken: () => boolean;
  ensureFreshToken: () => Promise<void>;
  /** The signed-in account's username, resolved once and held by the host — the pane asks for it on
   * every rebuild and the answer does not change between them. */
  username: (cfg: ArchiveConfig) => Promise<string>;
  /** How many videos `?test&remote_listing=` asks this pane to fake, or null on an ordinary load. */
  fakedListingCount: () => number | null;
  /** Takes down whatever the last load attempt left behind, on both surfaces, so a refusal is never
   * read beside the one before it. */
  clearLoadMessages: () => void;
  /** Says a video could not be opened, in this pane rather than on the stage. */
  reportFailure: (name: string, message: string) => void;
  /** Opens a video picked out of this pane, refusals reported back through `reportFailure`. */
  openVideo: (streamUrl: string, name: string, assetUrl: string, archive: ArchiveSource) => void;
}

/** What the page drives the pane by. */
export interface BrowsePane {
  /** Puts a line in the pane's own status slot, or clears it with "". */
  say: (message: string, cls?: "" | "err") => void;
  /** Reads the archive from scratch. */
  refresh: () => Promise<void>;
  /** Re-reads it when signing in or out has changed what there is to see, and only then. */
  syncToAuth: () => void;
  /** Whether the archive has been read at all yet — reading it costs a bucket listing and a
   * manifest per dataset, so nothing happens until somebody opens the pane. */
  opened: () => boolean;
}

export function createBrowsePane(els: ClipExtractorElements, host: BrowsePaneHost): BrowsePane {
  /** Dataset rows put on the page at once, so a filter that matches everything cannot flood it. */
  const BROWSE_ROW_LIMIT = 200;

  interface BrowseState {
    datasets: ArchiveDandiset[];
    /** Titles of the *public* datasets, read from their manifests. An embargoed dataset carries its
     * own title from the API listing that found it. */
    names: Map<string, string>;
    /** Videos per dataset id. A dataset missing from the map has not had its file list read yet. */
    videos: Map<string, ArchiveVideo[]>;
    /** Whether this pass reads every dataset's file list, and so gets to say which datasets hold
     * video. True from the moment the sweep is known to be affordable, not from the moment it
     * finishes: the list then fills in with the datasets the sweep has confirmed, instead of painting
     * every candidate up front and taking most of them back once it lands. False on an archive too
     * large to sweep at all (see SWEEP_BUDGET_BYTES), where nothing is confirmable and every
     * candidate is listed. */
    sweeping: boolean;
    /** True once every dataset's file list has been read, which is what "with video only" needs. */
    swept: boolean;
    selected: string | null;
    /** The asset URL of the video last picked out of the list, so its row can be marked the way the
     * open dataset's is. Held by asset URL rather than by path, which only identifies a file within
     * its own dataset. */
    selectedVideo: string | null;
    /** Cancels this pass's outstanding reads when the pane is rebuilt (a sign-in, say). */
    abort: AbortController;
  }

  let browse: BrowseState | null = null;
  /** Bumped on every rebuild, so a slow pass that has been superseded cannot paint over the one that
   * replaced it. */
  let browseGeneration = 0;
  /** Whether the list on screen was built signed in. What the pane can see changes with that and
   * with nothing else about the upload side, so it is the only thing that forces a rebuild. */
  let browseSignedIn = false;
  let browseFilterTimer: ReturnType<typeof setTimeout> | undefined;
  /** The label and trailing-detail nodes of the rows currently on the page, so a name or a video
   * count arriving mid-sweep updates one row instead of rebuilding the list. */
  const browseRowLabels = new Map<string, HTMLElement>();
  const browseRowMeta = new Map<string, HTMLElement>();
  /** The row buttons of the videos currently listed, by asset URL, so picking one can mark it where
   * it sits instead of rebuilding the list around it. */
  const browseVideoRows = new Map<string, HTMLElement>();

  function browseSay(message: string, cls: "" | "err" = ""): void {
    setMessage(els.browseStatus, message, host.appLinks);
    els.browseStatus.classList.toggle("err", cls === "err");
  }

  /** Appends a line of explanatory text as the last row of a list. */
  function browseNote(list: HTMLUListElement, message: string): void {
    const li = document.createElement("li");
    const p = document.createElement("p");
    p.className = "browse-empty";
    p.textContent = message;
    li.append(p);
    list.append(li);
  }

  /** Empties a list and replaces it with a single explanatory line. */
  function browseEmpty(list: HTMLUListElement, message: string): void {
    list.replaceChildren();
    browseNote(list, message);
  }

  /** Empties the video list and says why, dropping the rows the selection mark tracks along with it. */
  function browseVideosEmpty(message: string): void {
    browseVideoRows.clear();
    browseEmpty(els.browseVideos, message);
  }

  /** The title to show for a dataset, wherever it came from. */
  function browseName(current: BrowseState, dandiset: ArchiveDandiset): string {
    return dandiset.name || current.names.get(dandiset.id) || "";
  }

  /** Reads the archive from scratch. Run when the pane is first opened and again whenever signing in
   * or out changes which datasets there are to see. */
  async function refreshBrowse(): Promise<void> {
    const reopen = browse?.selected ?? null;
    // A rebuild changes what the pane can see, not what is on the stage, so the video picked out of it
    // stays picked and its row is marked again as soon as the list holding it is drawn.
    const picked = browse?.selectedVideo ?? null;
    browse?.abort.abort();
    browseSignedIn = host.signedIn();
    const generation = ++browseGeneration;
    const current: BrowseState = {
      datasets: [],
      names: loadCachedNames(),
      videos: new Map(),
      sweeping: false,
      swept: false,
      selected: null,
      selectedVideo: picked,
      abort: new AbortController(),
    };
    browse = current;
    const signal = current.abort.signal;
    els.browseDandisetLink.hidden = true;
    els.browseVideoHeading.textContent = "Videos";
    browseVideosEmpty("Choose a dataset to see the videos in it.");
    els.browseDandisets.replaceChildren();

    // `?test&remote_listing=N` fakes the whole pane — the bucket listing, the manifests, and the
    // embargoed API listing all at once — so a live smoketest never reads the real archive. Marked
    // swept immediately, since there is nothing left to sweep: every dataset's video list is already
    // in hand.
    const fakedListing = host.fakedListingCount();
    if (fakedListing !== null) {
      const { datasets, videos } = fakeArchiveBrowse(fakedListing);
      current.datasets = datasets;
      current.videos = videos;
      current.sweeping = true;
      current.swept = true;
      renderDandisetList();
      browseSay("");
      return;
    }

    browseSay("Reading the EMBER archive listing…");

    try {
      if (host.hasToken()) await host.ensureFreshToken();
      // Three independent reads, run together; only the bucket listing is allowed to fail the whole
      // pane. `publicIds` is what actually decides which bucket candidates are shown — see
      // lib/embargoed.ts's listPublicDandisetIds for why the bucket listing alone cannot be trusted
      // with that.
      const [candidates, owned, publicIds] = await Promise.all([
        listManifestObjects(signal).then(indexDandisets),
        listOwnedEmbargoed(signal),
        listPublicDandisetIds(host.config(), signal),
      ]);
      if (generation !== browseGeneration) return;
      const pub = candidates.filter((d) => publicIds.has(d.id));
      current.datasets = mergeDandisets(pub, owned);
      // Settled before the first paint, because it decides what that paint is allowed to show: a
      // sweep that is going to run makes every candidate row provisional, and a provisional row is
      // one the pane would have to take back.
      current.sweeping = canSweep(current.datasets);
      renderDandisetList();
      browseSay(browseCountLine(current));
      // A rebuild is a change of what can be seen, not a change of mind: whatever dataset was open
      // before is opened again, so signing in does not close it.
      const previous = reopen ? current.datasets.find((d) => d.id === reopen) : undefined;
      if (previous) void selectDandiset(previous);
      // Titles first, so the list is readable while the longer scan below runs against it.
      await hydrateNames(current, generation);
      await sweepVideos(current, generation);
    } catch (e) {
      if (signal.aborted) return;
      host.log(`Could not read the EMBER archive: ${(e as Error).message}`, "err");
      browseSay(`Could not read the EMBER archive: ${friendlyError(e)}`, "err");
    }
  }

  /** The datasets the signed-in visitor owns and nobody else can see. Signed out, there are none; a
   * failed lookup is reported and the public half of the pane carries on without them. */
  async function listOwnedEmbargoed(signal: AbortSignal): Promise<ArchiveDandiset[]> {
    if (!host.hasToken()) return [];
    const cfg = host.config();
    try {
      // Which datasets are the visitor's own is settled against their username, not against the
      // archive's `?user=me` filter — see listOwnedEmbargoedDandisets.
      return await listOwnedEmbargoedDandisets(cfg, await host.username(cfg));
    } catch (e) {
      if (signal.aborted) throw e;
      host.log(`Could not list your embargoed datasets: ${(e as Error).message}`, "warn");
      return [];
    }
  }

  function browseCountLine(current: BrowseState): string {
    const mine = current.datasets.filter((d) => d.embargoed).length;
    const suffix = mine ? `, ${mine} of them embargoed and yours` : "";
    return `${current.datasets.length} EMBER datasets${suffix}.`;
  }

  /** Fills in public dataset titles, which is what makes the filter box match anything but a number. */
  async function hydrateNames(current: BrowseState, generation: number): Promise<void> {
    const missing = current.datasets.filter((d) => !d.embargoed && !current.names.has(d.id));
    if (!missing.length) return;
    let done = 0;
    await hydrateDandisetNames(
      missing,
      (dandiset, name) => {
        if (generation !== browseGeneration) return;
        done++;
        if (name) {
          current.names.set(dandiset.id, name);
          const label = browseRowLabels.get(dandiset.id);
          if (label) label.textContent = name;
        }
        browseSay(`Naming datasets, ${done} of ${missing.length}…`);
      },
      current.abort.signal,
    );
    if (generation !== browseGeneration) return;
    saveCachedNames(current.names);
    browseSay(browseCountLine(current));
  }

  /** Every video in one dataset, asked of whichever side can answer for it. */
  function readDandisetVideos(dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<ArchiveVideo[]> {
    if (dandiset.embargoed) return listEmbargoedVideos(host.config(), dandiset.id, signal);
    return fetchDandisetVideos(dandiset, signal);
  }

  /**
   * Reads every dataset's file list, so the pane can show only the datasets that actually hold video.
   * Skipped when the public manifests are too large to read wholesale (see SWEEP_BUDGET_BYTES): a
   * dataset's file list is then read when it is opened instead.
   */
  async function sweepVideos(current: BrowseState, generation: number): Promise<void> {
    if (!current.sweeping) return;
    let done = 0;
    await sweepArchiveVideos(
      current.datasets,
      readDandisetVideos,
      (dandiset, videos) => {
        if (generation !== browseGeneration) return;
        done++;
        current.videos.set(dandiset.id, videos);
        // A dataset holding video is a row the list does not have yet; one holding none was never
        // drawn, so it needs no redraw at all. Either way a row's video count is drawn correct the
        // first time rather than filled in afterwards.
        if (videos.length) scheduleDandisetRender();
        browseSay(`Looking for video, ${done} of ${current.datasets.length} datasets…`);
      },
      current.abort.signal,
    );
    if (generation !== browseGeneration) return;
    current.swept = true;
    // Nothing left to report: the list itself is now the answer, and it holds only what can be
    // opened. The line stays clear until something is loading or has gone wrong.
    browseSay("");
    renderDandisetList();
  }

  function videoCountLabel(count: number): string {
    if (count === 0) return "no video";
    return count === 1 ? "1 video" : `${count} videos`;
  }

  /**
   * The datasets left visible. A dataset holding no video is never shown: this pane exists to pick a
   * video out of one, and a dataset that cannot offer one is a dead end. Whether it holds any is only
   * known once its file list has been read, so wherever a sweep is reading them (see
   * SWEEP_BUDGET_BYTES) a dataset waits its turn out of the list rather than sitting in it unconfirmed
   * — the pane fills in as the sweep lands instead of showing every candidate and then dropping most
   * of them. On an archive too large to sweep, no file list is read up front, so every dataset is
   * listed and a video-less one answers for itself when it is opened. Which datasets are candidates at
   * all (public vs. embargoed) is settled earlier, in refreshBrowse, before any of this ever runs.
   */
  function visibleDandisets(current: BrowseState): ArchiveDandiset[] {
    const query = els.browseFilter.value.trim().toLowerCase();
    return current.datasets.filter((d) => {
      const videos = current.videos.get(d.id);
      if (current.sweeping && !videos?.length) return false;
      if (!query) return true;
      if (d.id.includes(query)) return true;
      if (browseName(current, d).toLowerCase().includes(query)) return true;
      return (videos ?? []).some((v) => v.path.toLowerCase().includes(query));
    });
  }

  interface BrowseRowParts {
    li: HTMLLIElement;
    labelEl: HTMLElement;
    metaEl: HTMLElement;
  }

  /** One clickable row: an optional leading identifier, a wrapping label, an optional badge, and a
   * trailing detail. */
  function browseRow(id: string, label: string, meta: string, onClick: () => void, badge?: string): BrowseRowParts {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "browse-item";
    const labelEl = document.createElement("span");
    labelEl.className = "browse-label";
    labelEl.textContent = label;
    const metaEl = document.createElement("span");
    metaEl.className = "browse-meta";
    metaEl.textContent = meta;
    // A row with nothing to identify it beyond its label leads with the label itself, rather than
    // with a decorative stand-in for the identifier other rows carry.
    if (id || badge) {
      // The identifier and the badge share the row's leading column, stacked: a badge set between
      // the identifier and the title pushes every title across by a different amount, so a column of
      // them no longer lines up to be read down.
      const idCol = document.createElement("span");
      idCol.className = "browse-idcol";
      if (id) {
        const idEl = document.createElement("span");
        idEl.className = "browse-id";
        idEl.textContent = id;
        idCol.append(idEl);
      }
      if (badge) {
        const badgeEl = document.createElement("span");
        badgeEl.className = "badge restricted";
        badgeEl.textContent = badge;
        idCol.append(badgeEl);
      }
      button.append(idCol);
    }
    button.append(labelEl, metaEl);
    button.addEventListener("click", onClick);
    li.append(button);
    return { li, labelEl, metaEl };
  }

  /** A redraw asked for by the sweep, held to one a frame: the scan lands a dataset at a time and
   * each new row would otherwise rebuild the whole list on its own. */
  let browseRenderFrame: number | null = null;

  function scheduleDandisetRender(): void {
    if (browseRenderFrame === null) browseRenderFrame = requestAnimationFrame(renderDandisetList);
  }

  /** What an empty list has to say for itself, which during a sweep is "not yet" rather than "none". */
  function browseEmptyReason(current: BrowseState): string {
    if (current.sweeping && !current.swept) return "Looking for the datasets that hold video…";
    return current.datasets.length ? "No dataset matches that filter." : "No datasets found.";
  }

  function renderDandisetList(): void {
    if (browseRenderFrame !== null) cancelAnimationFrame(browseRenderFrame);
    browseRenderFrame = null;
    const current = browse;
    browseRowLabels.clear();
    browseRowMeta.clear();
    if (!current) return;
    const matches = visibleDandisets(current);
    if (!matches.length) {
      browseEmpty(els.browseDandisets, browseEmptyReason(current));
      return;
    }
    const shown = matches.slice(0, BROWSE_ROW_LIMIT);
    els.browseDandisets.replaceChildren();
    for (const dandiset of shown) {
      const videos = current.videos.get(dandiset.id);
      const { li, labelEl, metaEl } = browseRow(
        dandiset.id,
        browseName(current, dandiset),
        videos ? videoCountLabel(videos.length) : dandiset.embargoed ? "" : bytes(dandiset.manifestBytes),
        () => void selectDandiset(dandiset),
        dandiset.embargoed ? "embargoed" : undefined,
      );
      if (dandiset.id === current.selected) li.firstElementChild?.setAttribute("aria-current", "true");
      browseRowLabels.set(dandiset.id, labelEl);
      browseRowMeta.set(dandiset.id, metaEl);
      els.browseDandisets.append(li);
    }
    if (matches.length > shown.length) {
      browseNote(els.browseDandisets, `Showing ${shown.length} of ${matches.length} matches — narrow the filter to see the rest.`);
    }
  }

  /** Opens one dataset, reading its file list first if the sweep has not already done so. */
  async function selectDandiset(dandiset: ArchiveDandiset): Promise<void> {
    const current = browse;
    if (!current) return;
    const generation = browseGeneration;
    current.selected = dandiset.id;
    renderDandisetList();
    els.browseVideoHeading.textContent = `Videos in ${dandiset.id}`;
    els.browseDandisetLink.href = dandisetWebUrl(dandiset);
    els.browseDandisetLink.hidden = false;
    const known = current.videos.get(dandiset.id);
    if (known) {
      renderVideoList(known);
      return;
    }
    const cost = dandiset.embargoed ? "" : ` (${bytes(dandiset.manifestBytes)})`;
    browseVideosEmpty(`Reading the file list for ${dandiset.id}${cost}…`);
    try {
      const videos = await readDandisetVideos(dandiset, current.abort.signal);
      if (generation !== browseGeneration || browse?.selected !== dandiset.id) return;
      current.videos.set(dandiset.id, videos);
      const meta = browseRowMeta.get(dandiset.id);
      if (meta) meta.textContent = videoCountLabel(videos.length);
      renderVideoList(videos);
    } catch (e) {
      if (current.abort.signal.aborted || generation !== browseGeneration) return;
      host.log(`Could not read the file list for ${dandiset.id}: ${(e as Error).message}`, "err");
      browseVideosEmpty(`The file list for ${dandiset.id} could not be read: ${friendlyError(e)}`);
    }
  }

  /** Marks the row of the video the pane last picked, the same way the open dataset's row is marked.
   * Rows in another dataset's list never match, since the mark is held by asset URL: opening a second
   * dataset leaves nothing highlighted, which is the truth about that list. */
  function markSelectedVideo(): void {
    for (const [assetUrl, button] of browseVideoRows) {
      if (assetUrl === browse?.selectedVideo) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
  }

  function renderVideoList(videos: readonly ArchiveVideo[]): void {
    if (!videos.length) {
      browseVideosEmpty("This dataset holds no video files.");
      return;
    }
    browseVideoRows.clear();
    els.browseVideos.replaceChildren();
    for (const video of videos) {
      // The manifest reports every asset's size, so a file the player would refuse is marked as one
      // in the listing rather than only when it is picked. The mark rides in the trailing detail
      // beside the size that decided it, so a row carrying it still lines its path up with the rest.
      const refusal = unstreamableRefusal(video.path, video.size);
      const meta = refusal ? `${bytes(video.size)} · no streaming` : bytes(video.size);
      const { li } = browseRow("", video.path, meta, () => void streamArchiveVideo(video));
      const button = li.firstElementChild as HTMLElement | null;
      if (refusal) {
        button?.classList.add("blocked");
        button?.setAttribute("title", refusal);
      }
      if (button) browseVideoRows.set(video.assetUrl, button);
      els.browseVideos.append(li);
    }
    markSelectedVideo();
  }

  async function streamArchiveVideo(video: ArchiveVideo): Promise<void> {
    const name = video.path.split("/").pop() || video.path;
    // Marked before anything is attempted, a refusal included: the highlight says which row was
    // picked, the way the dataset list's does, and a file that will not open is one whose row most
    // needs pairing with the reason written out below it.
    if (browse) browse.selectedVideo = video.assetUrl;
    markSelectedVideo();
    // Settled against the size the archive reports, so an embargoed file is refused without a signed
    // link being asked for on its behalf.
    const refusal = unstreamableRefusal(video.path, video.size);
    // Refused or not, this is an attempt: whatever the last one left on the stage comes down first.
    host.clearLoadMessages();
    if (refusal) {
      host.log(`${name} will not be opened: ${refusal}`, "err");
      host.reportFailure(name, refusal);
      return;
    }
    let streamUrl = video.streamUrl;
    if (!streamUrl) {
      // Embargoed: the bytes sit behind a signature the archive has to issue, and it is only good for
      // a while, so it is asked for at the moment the video is opened rather than when it was listed.
      browseSay(`Asking EMBER for a link to ${name}…`);
      try {
        await host.ensureFreshToken();
        streamUrl = await resolveEmbargoedStreamUrl(host.config(), video.assetUrl);
      } catch (e) {
        host.log(`Could not open the embargoed file ${video.path}: ${(e as Error).message}`, "err");
        host.reportFailure(name, friendlyError(e));
        return;
      }
      browseSay("");
    }
    // Streamed from the bucket, which answers range requests cross-origin without a redirect, but
    // recorded against the archive's own asset URL: that is the one naming the file rather than its
    // content hash — and for an embargoed file, the only one that will still resolve tomorrow.
    // Reported in the pane, like the refusals above it: a video picked out of a list is answered for
    // where the list is, whether or not another one is already playing on the stage.
    host.openVideo(streamUrl, name, video.assetUrl, archiveSourceOf(video));
  }

  /**
   * Re-reads the archive when signing in or out has changed what the pane can see. Only then: the
   * auth path this hangs off runs on every load and on every change of upload destination, and
   * rebuilding the list underneath somebody who is reading it is not a free thing to do.
   */
  function syncBrowseToAuth(): void {
    if (browse && browseSignedIn !== host.signedIn()) void refreshBrowse();
  }

  els.browseFilter.addEventListener("input", () => {
    clearTimeout(browseFilterTimer);
    browseFilterTimer = setTimeout(renderDandisetList, 150);
  });

  return {
    say: browseSay,
    refresh: refreshBrowse,
    syncToAuth: syncBrowseToAuth,
    opened: () => browse !== null,
  };
}
