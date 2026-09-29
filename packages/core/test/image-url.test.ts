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
