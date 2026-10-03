import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anyListingImageLoads,
  checkImageUrlLoads,
  checkListingsHaveLoadableImages,
} from "../src/image-check.js";

function jsonHeaders(contentType: string | null) {
  return { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) };
}

describe("checkImageUrlLoads", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns true for a 200 with an image/* content-type", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: jsonHeaders("image/jpeg"),
    }) as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/a.jpg")).resolves.toBe(true);
  });

  it("returns true for a 206 (ranged) response with an image/* content-type", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 206,
      ok: true,
      headers: jsonHeaders("image/webp"),
    }) as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/a.webp")).resolves.toBe(true);
  });

  it("returns false for a 200 with a non-image content-type (e.g. an HTML error page)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: jsonHeaders("text/html"),
    }) as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/a.jpg")).resolves.toBe(false);
  });

  it("returns false for a 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      headers: jsonHeaders(null),
    }) as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/missing.jpg")).resolves.toBe(false);
  });

  it("falls back to HEAD when the ranged GET throws, and succeeds if HEAD looks like an image", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.method === "GET") return Promise.reject(new Error("GET with Range not supported"));
      return Promise.resolve({ status: 200, ok: true, headers: jsonHeaders("image/jpeg") });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/a.jpg")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns false (never throws) when both GET and HEAD fail", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(checkImageUrlLoads("https://example.com/a.jpg")).resolves.toBe(false);
  });
});

describe("anyListingImageLoads", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns false for an empty imageUrls array without making any request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(anyListingImageLoads([])).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at the first URL that loads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: jsonHeaders("image/jpeg") });
    global.fetch = fetchMock as unknown as typeof fetch;
    const ok = await anyListingImageLoads(["https://example.com/1.jpg", "https://example.com/2.jpg"]);
    expect(ok).toBe(true);
    // One GET for the first URL -- never reaches the second.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries the next (up to 2 more) URLs when the first one fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("1.jpg")) return Promise.resolve({ status: 404, ok: false, headers: jsonHeaders(null) });
      return Promise.resolve({ status: 200, ok: true, headers: jsonHeaders("image/jpeg") });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const ok = await anyListingImageLoads(["https://example.com/1.jpg", "https://example.com/2.jpg"]);
    expect(ok).toBe(true);
  });

  it("returns false when none of up-to-3 image URLs load", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ status: 404, ok: false, headers: jsonHeaders(null) }) as unknown as typeof fetch;
    const ok = await anyListingImageLoads([
      "https://example.com/1.jpg",
      "https://example.com/2.jpg",
      "https://example.com/3.jpg",
      "https://example.com/4.jpg",
    ]);
    expect(ok).toBe(false);
    // Only the first 3 are tried, never the 4th.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("resolves a sauto/sdn.cz URL (via resolveImageUrl) before checking it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: jsonHeaders("image/jpeg") });
    global.fetch = fetchMock as unknown as typeof fetch;
    await anyListingImageLoads(["https://d19-a.sdn.cz/d_19/c_img_m4_A/x/7aea.jpeg"]);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("fl=exf|res,360,270,3|jpg,80,,1");
  });
});

describe("checkListingsHaveLoadableImages", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a same-length, same-order boolean array for several listings, respecting concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const ok = !url.includes("bad");
      return { status: ok ? 200 : 404, ok, headers: jsonHeaders(ok ? "image/jpeg" : null) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const imageUrlsList = Array.from({ length: 10 }, (_, i) => [
      i % 3 === 0 ? "https://example.com/bad.jpg" : `https://example.com/${i}.jpg`,
    ]);
    const results = await checkListingsHaveLoadableImages(imageUrlsList, 4);
    expect(results).toHaveLength(10);
    expect(results[0]).toBe(false); // index 0 -> "bad"
    expect(results[1]).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
