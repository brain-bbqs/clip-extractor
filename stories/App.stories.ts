// Loaded via Vite's `?raw` import so this story always mirrors the real markup in index.html
// instead of a hand-maintained copy that can drift out of sync.
import indexHtml from "../index.html?raw";

interface AppStoryOptions {
  withSlp?: boolean;
  signedIn?: boolean;
}

// Mirrors what main.ts renders once an EMBER sign-in resolves and the incoming datasets load:
// the header avatar in place of the sign-in button, and the populated destination picker.
// Storybook never talks to the archive, so the story fills in the same elements by hand.
function applySignedIn(wrapper: HTMLElement): void {
  wrapper.querySelector("#oauthSigninBtn")?.setAttribute("hidden", "");
  wrapper.querySelector("#oauthSignedIn")?.removeAttribute("hidden");
  const avatar = wrapper.querySelector("#oauthAvatar");
  if (avatar) avatar.textContent = "AL";
  const username = wrapper.querySelector("#oauthUsername");
  if (username) username.textContent = "ada-lovelace";
  wrapper.querySelector("#dandisetMessage")?.setAttribute("hidden", "");
  const select = wrapper.querySelector<HTMLSelectElement>("#dandisetId");
  if (select) {
    select.hidden = false;
    for (const [identifier, title] of [
      ["000123", "Incoming: Example Lab"],
      ["000456", "Incoming: Second Lab"],
    ]) {
      const option = document.createElement("option");
      option.value = identifier;
      option.textContent = `(${identifier}) ${title}`;
      select.append(option);
    }
  }
  const link = wrapper.querySelector<HTMLAnchorElement>("#viewDatasetLink");
  if (link) {
    link.hidden = false;
    link.href = "https://dandi.emberarchive.org/dandiset/000123/draft";
  }
}

function buildApp({ withSlp = false, signedIn = false }: AppStoryOptions = {}): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // The app's own <script type="module"> wires up state against real video/ffmpeg backends;
  // Storybook only needs the static markup for a visual snapshot of the empty (unloaded) state.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  const wrapper = document.createElement("div");
  wrapper.innerHTML = doc.body.innerHTML;
  if (withSlp) {
    // Mirrors what main.ts does when the SLEAP annotations switch is flipped on.
    const toggle = wrapper.querySelector<HTMLInputElement>("#slpToggle");
    if (toggle) toggle.checked = true;
    wrapper.querySelector("#slpCard")?.removeAttribute("hidden");
  }
  if (signedIn) applySignedIn(wrapper);
  return wrapper;
}

export default {
  title: "App",
};

export const Default = {
  name: "Default (no video loaded)",
  render: () => buildApp(),
};

export const SlpEnabled = {
  name: "SLEAP annotations enabled",
  render: () => buildApp({ withSlp: true }),
};

export const SignedIn = {
  name: "Signed in (upload destination)",
  render: () => buildApp({ signedIn: true }),
};
