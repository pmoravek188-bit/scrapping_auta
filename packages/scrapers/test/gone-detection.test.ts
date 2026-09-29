import { describe, expect, it } from "vitest";
import { isGone, isGoneGeneric } from "../src/gone-detection.js";

describe("isGoneGeneric", () => {
  it("confirms gone on a 404", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: 404, finalUrl: "https://x.test/a", html: "" })
    ).toBe(true);
  });

  it("confirms gone on a 410", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: 410, finalUrl: "https://x.test/a", html: "" })
    ).toBe(true);
  });

  it("confirms gone on a 200 page carrying a known Czech 'removed' phrase", () => {
    const html = "<html><body>Inzerát byl smazán a již není dostupný.</body></html>";
    expect(isGoneGeneric({ originalUrl: "https://x.test/a", status: 200, finalUrl: "https://x.test/a", html })).toBe(
      true
    );
  });

  it("confirms gone on a 200 page carrying a known German 'removed' phrase", () => {
    const html = "<html><body>Diese Anzeige wurde gelöscht.</body></html>";
    expect(isGoneGeneric({ originalUrl: "https://x.test/a", status: 200, finalUrl: "https://x.test/a", html })).toBe(
      true
    );
  });

  it("does not confirm gone on a normal 200 listing page", () => {
    const html = "<html><body>Škoda Octavia 2.0 TDI, 150 000 Kč</body></html>";
    expect(isGoneGeneric({ originalUrl: "https://x.test/a", status: 200, finalUrl: "https://x.test/a", html })).toBe(
      false
    );
  });

  it("does not confirm gone when status is null (network failure)", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: null, finalUrl: "https://x.test/a", html: "" })
    ).toBe(false);
  });

  it("does not confirm gone on an unrelated 5xx", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: 503, finalUrl: "https://x.test/a", html: "" })
    ).toBe(false);
  });

  it("does not confirm gone on a 403 (bot-blocked, not gone)", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: 403, finalUrl: "https://x.test/a", html: "" })
    ).toBe(false);
  });

  it("does not confirm gone on a 429 (rate-limited, not gone)", () => {
    expect(
      isGoneGeneric({ originalUrl: "https://x.test/a", status: 429, finalUrl: "https://x.test/a", html: "" })
    ).toBe(false);
  });
});

describe("isGone per-source overrides", () => {
  it("sauto: confirms gone when redirected away from the detail path (same site)", () => {
    const result = isGone("sauto", {
      originalUrl: "https://www.sauto.cz/osobni/detail/skoda/octavia/123",
      status: 200,
      finalUrl: "https://www.sauto.cz/osobni",
      html: "<html>ok</html>",
    });
    expect(result).toBe(true);
  });

  it("sauto: does not confirm gone when still on a detail URL", () => {
    const result = isGone("sauto", {
      originalUrl: "https://www.sauto.cz/osobni/detail/skoda/octavia/123",
      status: 200,
      finalUrl: "https://www.sauto.cz/osobni/detail/skoda/octavia/123",
      html: "<html>ok</html>",
    });
    expect(result).toBe(false);
  });

  it("tipcars: confirms gone when redirected to the /ojete list root (same site)", () => {
    const result = isGone("tipcars", {
      originalUrl: "https://www.tipcars.com/skoda-octavia/kombi/nafta/x-123.html",
      status: 200,
      finalUrl: "https://www.tipcars.com/ojete",
      html: "<html>ok</html>",
    });
    expect(result).toBe(true);
  });

  it("tipcars: does not confirm gone on a real .html detail page", () => {
    const result = isGone("tipcars", {
      originalUrl: "https://www.tipcars.com/skoda-octavia/kombi/nafta/x-123.html",
      status: 200,
      finalUrl: "https://www.tipcars.com/skoda-octavia/kombi/nafta/x-123.html",
      html: "<html>ok</html>",
    });
    expect(result).toBe(false);
  });

  it("bazos: confirms gone when redirected away from /inzerat/ (same site)", () => {
    const result = isGone("bazos", {
      originalUrl: "https://auto.bazos.cz/inzerat/224366040/x.php",
      status: 200,
      finalUrl: "https://auto.bazos.cz/",
      html: "<html>ok</html>",
    });
    expect(result).toBe(true);
  });

  it("falls back to the generic default for a source with no override", () => {
    const result = isGone("carvago", {
      originalUrl: "https://carvago.test/a",
      status: 404,
      finalUrl: "https://carvago.test/a",
      html: "",
    });
    expect(result).toBe(true);
  });
});

describe("isGone cross-host safety guard", () => {
  it("does NOT confirm gone when redirected to a different site's consent/captcha page, even though the path check would otherwise say gone", () => {
    // This is exactly the dangerous case: a GitHub Actions runner (US/EU
    // cloud IP) gets redirected to Seznam's consent wall instead of the
    // sauto.cz detail page. Without the cross-host guard, isGoneSauto's
    // "redirected away from /osobni/detail/" check would wrongly fire here.
    const result = isGone("sauto", {
      originalUrl: "https://www.sauto.cz/osobni/detail/skoda/octavia/123",
      status: 200,
      finalUrl: "https://cmp.seznam.cz/consent?redirect=...",
      html: "<html>Souhlas se zpracováním osobních údajů</html>",
    });
    expect(result).toBe(false);
  });

  it("does NOT confirm gone on a generic-default source redirected to a different host's 404 page", () => {
    const result = isGone("carvago", {
      originalUrl: "https://carvago.test/cars/123",
      status: 404,
      finalUrl: "https://some-cdn.example.net/error",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("still confirms gone for a same-host redirect to a different subdomain-less path", () => {
    // Sanity check that the guard only blocks cross-SITE redirects, not
    // same-site ones (e.g. www.sauto.cz -> sauto.cz would still count as
    // the same registrable domain).
    const result = isGone("tipcars", {
      originalUrl: "https://www.tipcars.com/skoda-octavia/kombi/nafta/x-123.html",
      status: 200,
      finalUrl: "https://tipcars.com/ojete",
      html: "<html>ok</html>",
    });
    expect(result).toBe(true);
  });
});
