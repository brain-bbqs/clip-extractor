import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containerOf,
  conversionRefusal,
  needsConversion,
  parseContentRangeSize,
  remoteFileSize,
  streamsEfficiently,
  unstreamableRefusal,
  wholeFileRefusal,
  ENCODING_HELPER_URL,
  PARAGRAPH,
  TRANSCODE_LIMIT_BYTES,
  WHOLE_FILE_LIMIT_BYTES,
} from "../../src/lib/streamable";

const GB = 1024 * 1024 * 1024;

/** A response as only this module reads one: a status and a few headers. */
function response(status: number, headers: Record<string, string>): Response {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null } } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("containerOf", () => {
  it("reads the extension off a bare file name", () => {
    expect(containerOf("mice.mp4")).toBe("mp4");
    expect(containerOf("sub-1/session.AVI")).toBe("avi");
  });

  it("drops the query and fragment a signed bucket URL carries its signature in", () => {
    expect(containerOf("https://bucket.s3.amazonaws.com/blobs/abc.avi?X-Amz-Signature=deadbeef")).toBe("avi");
    expect(containerOf("https://example.test/clip.mp4#t=10")).toBe("mp4");
  });

  it("reports nothing for a URL naming no file", () => {
    expect(containerOf("https://api.test/assets/1234-5678/download/")).toBe("");
    expect(containerOf("recording")).toBe("");
    // A dotfile is named by its dot rather than extended by it, and a trailing dot extends nothing.
    expect(containerOf(".mp4")).toBe("");
    expect(containerOf("clip.")).toBe("");
  });
});

describe("streamsEfficiently", () => {
  it("accepts the containers whose index can be read a piece at a time", () => {
    for (const name of ["mice.mp4", "mice.mov", "mice.m4v", "mice.webm", "mice.mkv"]) {
      expect(streamsEfficiently(name)).toBe(true);
    }
  });

  it("refuses the containers that cost the whole file to open", () => {
    for (const name of ["mice.avi", "mice.wmv", "mice.mpg", "mice.mpeg", "mice.vob", "mice.flv", "mice.ogv"]) {
      expect(streamsEfficiently(name)).toBe(false);
    }
  });

  it("refuses a transport stream, which opens but carries no index to open it by", () => {
    expect(streamsEfficiently("mice.ts")).toBe(false);
    expect(streamsEfficiently("mice.m2ts")).toBe(false);
  });

  it("gives anything it does not recognize the benefit of the doubt, since opening it settles it", () => {
    expect(streamsEfficiently("https://api.test/assets/1234/download/")).toBe(true);
    expect(streamsEfficiently("mice.someformat")).toBe(true);
  });
});

describe("needsConversion", () => {
  it("names the containers nothing in the browser parses", () => {
    for (const name of ["mice.avi", "mice.wmv", "mice.mpg", "mice.vob", "mice.flv"]) {
      expect(needsConversion(name)).toBe(true);
    }
  });

  it("leaves out the ones that open once they have arrived, however badly they stream", () => {
    for (const name of ["mice.ts", "mice.m2ts", "mice.ogv", "mice.mp4", "mice.mkv"]) {
      expect(needsConversion(name)).toBe(false);
    }
  });
});

describe("unstreamableRefusal", () => {
  it("has nothing to say about a container that streams, however large it is", () => {
    expect(unstreamableRefusal("mice.mp4", 400 * GB)).toBeNull();
  });

  it("lets a small file in a container that does not stream be downloaded whole", () => {
    expect(unstreamableRefusal("mice.avi", 200 * 1024 * 1024)).toBeNull();
    expect(unstreamableRefusal("mice.avi", TRANSCODE_LIMIT_BYTES)).toBeNull();
  });

  it("allows a transport stream the whole gigabyte, since it opens once it is here", () => {
    expect(unstreamableRefusal("mice.ts", WHOLE_FILE_LIMIT_BYTES)).toBeNull();
    expect(unstreamableRefusal("mice.ts", 2 * GB)).toContain("1.00 GB");
  });

  it("holds a container nothing parses to what converting one costs, not to the download", () => {
    // It would arrive whole and still not open, so the ceiling that decides is the conversion's.
    const refusal = unstreamableRefusal("mice.avi", 512 * 1024 * 1024);
    expect(refusal).toContain("512.00 MB");
    expect(refusal).toContain("256.00 MB");
    expect(refusal).toContain("converting one in the browser");
  });

  it("refuses a large one, naming its size, the limit and where to re-encode it", () => {
    const refusal = unstreamableRefusal("mice.avi", 2 * GB);
    expect(refusal).toContain("cannot be opened efficiently through streaming");
    expect(refusal).toContain("2.00 GB");
    expect(refusal).toContain("256.00 MB");
    expect(refusal).toContain(`[Encoding Helper](${ENCODING_HELPER_URL})`);
  });

  it("leaves the way out as its own paragraph, so the page can set it on its own line", () => {
    const paragraphs = unstreamableRefusal("mice.avi", 2 * GB)!.split(PARAGRAPH);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].startsWith("Please use the")).toBe(true);
  });

  it("refuses one whose size nobody reports, an unbounded read being the same as too large a one", () => {
    expect(unstreamableRefusal("mice.avi", null)).toContain("nothing says how large");
  });
});

describe("conversionRefusal", () => {
  it("converts what fits", () => {
    expect(conversionRefusal("mice.avi", 1024)).toBeNull();
    expect(conversionRefusal("mice.avi", TRANSCODE_LIMIT_BYTES)).toBeNull();
  });

  it("refuses what would not fit through ffmpeg.wasm, naming the file, its size and the limit", () => {
    // Reached with the bytes in hand, so it answers for whatever arrived rather than for a name: a
    // URL naming no container at all still ends up here.
    const refusal = conversionRefusal("download", 700 * 1024 * 1024);
    expect(refusal).toContain("download");
    expect(refusal).toContain("700.00 MB");
    expect(refusal).toContain("256.00 MB");
    expect(refusal).toContain(`[Encoding Helper](${ENCODING_HELPER_URL})`);
  });
});

describe("wholeFileRefusal", () => {
  it("allows what fits, including a size nobody reported", () => {
    expect(wholeFileRefusal(900 * 1024 * 1024)).toBeNull();
    expect(wholeFileRefusal(WHOLE_FILE_LIMIT_BYTES)).toBeNull();
    expect(wholeFileRefusal(null)).toBeNull();
  });

  it("refuses to download a file past the limit, whatever container it is in", () => {
    const refusal = wholeFileRefusal(4 * GB);
    expect(refusal).toContain("4.00 GB");
    expect(refusal).toContain(`[Encoding Helper](${ENCODING_HELPER_URL})`);
    // The file is named by the line above this one wherever it is shown.
    expect(refusal!.split(PARAGRAPH)[0].startsWith("This file")).toBe(true);
  });

  it("leaves what the streaming open failed with to the console, saying only what can be acted on", () => {
    const refusal = wholeFileRefusal(300 * GB);
    expect(refusal).toContain("300.00 GB");
    // No aside about container internals in the sentence saying the file is too large. (The link
    // in the paragraph after it has brackets of its own, so this asks only of the first.)
    expect(refusal!.split(PARAGRAPH)[0]).not.toContain("(");
  });
});

describe("parseContentRangeSize", () => {
  it("reads the total off a partial answer", () => {
    expect(parseContentRangeSize("bytes 0-0/1234")).toBe(1234);
  });

  it("reports nothing when the server does not know the total, or does not say", () => {
    expect(parseContentRangeSize("bytes 0-0/*")).toBeNull();
    expect(parseContentRangeSize("bytes 0-0")).toBeNull();
    expect(parseContentRangeSize(null)).toBeNull();
  });
});

describe("remoteFileSize", () => {
  it("takes the length off a HEAD when the server answers one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { "content-length": "2048" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await remoteFileSize("https://example.test/mice.avi")).toBe(2048);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "HEAD", signal: undefined });
  });

  it("falls back to a one-byte range request, which is what a signed bucket URL answers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(403, {}))
      .mockResolvedValueOnce(response(206, { "content-length": "1", "content-range": "bytes 0-0/5000000000" }));
    vi.stubGlobal("fetch", fetchMock);
    // The 206's own length describes the one byte it carries, so the total has to come from the range.
    expect(await remoteFileSize("https://example.test/mice.avi")).toBe(5_000_000_000);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { Range: "bytes=0-0" } });
  });

  it("reports nothing rather than throwing when neither request answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await remoteFileSize("https://example.test/mice.avi")).toBeNull();
  });

  it("still reports the size when a HEAD is answered without a length", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(response(206, { "content-range": "bytes 0-0/900" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await remoteFileSize("https://example.test/mice.avi")).toBe(900);
  });

  it("passes an abort through rather than reporting an unknown size for a cancelled read", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(remoteFileSize("https://example.test/mice.avi", controller.signal)).rejects.toThrow(/aborted/);
  });
});
