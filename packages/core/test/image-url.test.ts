import { describe, expect, it } from "vitest";
import { resolveImageUrl, resolveImageUrls } from "../src/image-url.js";

describe("resolveImageUrl", () => {
  it("adds the required fl= resize param to a sauto/sdn.cz image, stripping any existing query", () => {
    const url = resolveImageUrl("https://d19-a.sdn.cz/d_19/c_img_m4_A/kQOIvbF2D1C1XuFW4BsqDGn/7aea.jpeg?old=1");
    expect(url).toBe(
      "https://d19-a.sdn.cz/d_19/c_img_m4_A/kQOIvbF2D1C1XuFW4BsqDGn/7aea.jpeg?fl=exf|res,360,270,3|jpg,80,,1"
    );
  });

  it("uses a larger whitelisted size for a sdn.cz image at 'large' display size", () => {
    const url = resolveImageUrl("https://d19-a.sdn.cz/d_19/c_img_m4_A/kQOIvbF2D1C1XuFW4BsqDGn/7aea.jpeg", "large");
    expect(url).toContain("res,1024,768,1");
    expect(url).toContain("wrm,/watermark/sauto.png");
  });

  it("adds https: to a protocol-relative sdn.cz URL", () => {
    const url = resolveImageUrl("//d19-a.sdn.cz/d_19/c_img_m4_A/x/7aea.jpeg");
    expect(url).toMatch(/^https:\/\//);
  });

  it("upsizes an autoscout24 /WxH.webp suffix", () => {
    const url = resolveImageUrl(
      "https://prod.pictures.autoscout24.net/listing-images/abc.jpg/250x188.webp"
    );
    expect(url).toBe("https://prod.pictures.autoscout24.net/listing-images/abc.jpg/480x360.webp");
  });

  it("uses a larger size for autoscout24 at 'large' display size", () => {
    const url = resolveImageUrl(
      "https://prod.pictures.autoscout24.net/listing-images/abc.jpg/250x188.webp",
      "large"
    );
    expect(url).toBe("https://prod.pictures.autoscout24.net/listing-images/abc.jpg/1024x768.webp");
  });

  it("passes through an unrelated URL unchanged", () => {
    const url = resolveImageUrl("https://g.tipcars.com/abc/rs:fit:800:600:0:0/f:jpg/xyz");
    expect(url).toBe("https://g.tipcars.com/abc/rs:fit:800:600:0:0/f:jpg/xyz");
  });

  it("returns null for a null/empty input", () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl("")).toBeNull();
  });

  describe("'email' display size", () => {
    it("reuses the already-JPEG sauto/sdn.cz 'card' params", () => {
      const url = resolveImageUrl("https://d19-a.sdn.cz/d_19/c_img_m4_A/x/7aea.jpeg", "email");
      expect(url).toBe("https://d19-a.sdn.cz/d_19/c_img_m4_A/x/7aea.jpeg?fl=exf|res,360,270,3|jpg,80,,1");
    });

    it("swaps an autoscout24 .webp suffix for a confirmed-live .jpg one", () => {
      const url = resolveImageUrl(
        "https://prod.pictures.autoscout24.net/listing-images/abc.jpg/250x188.webp",
        "email"
      );
      expect(url).toBe("https://prod.pictures.autoscout24.net/listing-images/abc.jpg/480x360.jpg");
    });

    it("passes a tipcars URL through unchanged (already forced to JPEG via its own 'f:jpg' imgproxy segment)", () => {
      const url = resolveImageUrl("https://g.tipcars.com/abc/rs:fit:800:600:0:0/f:jpg/xyz", "email");
      expect(url).toBe("https://g.tipcars.com/abc/rs:fit:800:600:0:0/f:jpg/xyz");
    });

    it("keeps an aaaauto/vshcdn.net URL (webp-only CDN, no JPEG variant; Gmail/Apple Mail render webp)", () => {
      const u = "https://aaaautoeuimg.vshcdn.net/thumb/900591757_1024x768x95.jpg";
      expect(resolveImageUrl(u, "email")).toBe(u);
    });

    it("keeps a carvago/alpha-analytics.cz URL (redirects to a fixed-webp S3 object)", () => {
      const u = "https://storage.alpha-analytics.cz/get/cc85d554-63f0-475d-b010-b4173ae3df6b?ts=1";
      expect(resolveImageUrl(u, "email")).toBe(u);
    });
  });

  describe("dasweltauto / vmscdn.porscheinformatik.com", () => {
    const bare = "https://vmscdn.porscheinformatik.com/s2/cz/ABC123/images/fa37cd3d-7345-43f2-9c41-c5ba632b3bf8";

    it("appends a width segment at 'card' size (the bare URL 405s on its own)", () => {
      expect(resolveImageUrl(bare, "card")).toBe(`${bare}/440`);
    });

    it("appends a larger width segment at 'large' size", () => {
      expect(resolveImageUrl(bare, "large")).toBe(`${bare}/1024`);
    });

    it("appends a width segment at 'email' size too (plain width = JPEG, not the /webp/ variant)", () => {
      expect(resolveImageUrl(bare, "email")).toBe(`${bare}/440`);
    });

    it("is idempotent if a width segment is already present", () => {
      expect(resolveImageUrl(`${bare}/768`, "card")).toBe(`${bare}/440`);
    });
  });

  describe("aaaauto / vshcdn.net at non-email sizes", () => {
    it("passes the URL through unchanged at 'card'/'large' (display-time webp is fine; only email forces JPEG)", () => {
      const url = "https://aaaautoeuimg.vshcdn.net/thumb/900591757_1024x768x95.jpg";
      expect(resolveImageUrl(url, "card")).toBe(url);
      expect(resolveImageUrl(url, "large")).toBe(url);
    });
  });

  describe("carvago / alpha-analytics.cz at non-email sizes", () => {
    it("passes the URL through unchanged at 'card'/'large'", () => {
      const url = "https://storage.alpha-analytics.cz/get/cc85d554-63f0-475d-b010-b4173ae3df6b?ts=1";
      expect(resolveImageUrl(url, "card")).toBe(url);
      expect(resolveImageUrl(url, "large")).toBe(url);
    });
  });
});

describe("resolveImageUrls", () => {
  it("maps and drops nulls", () => {
    const urls = resolveImageUrls([
      "//d19-a.sdn.cz/d_19/c_img_m4_A/x/1.jpeg",
      null,
      "https://prod.pictures.autoscout24.net/listing-images/abc.jpg/250x188.webp",
    ]);
    expect(urls).toHaveLength(2);
  });

  it("returns [] for null/undefined", () => {
    expect(resolveImageUrls(null)).toEqual([]);
    expect(resolveImageUrls(undefined)).toEqual([]);
  });
});
