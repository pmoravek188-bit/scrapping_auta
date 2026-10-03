import { describe, expect, it, vi, afterEach } from "vitest";
import {
  getEmailConfigFromEnv,
  renderDigestHtml,
  renderDigestText,
  sendMatchDigestEmail,
  type NotifySearchGroup,
} from "../src/notify/email.js";

const group: NotifySearchGroup = {
  searchName: "Škoda Octavia do 400k",
  listings: [
    {
      title: "Škoda Octavia 2.0 TDI",
      url: "https://example.com/1",
      source: "sauto",
      priceCzk: 359900,
      year: 2019,
      mileageKm: 87000,
      fuel: "diesel",
      imageUrl: "https://example.com/1.jpg",
    },
  ],
};

describe("getEmailConfigFromEnv", () => {
  it("returns null when RESEND_API_KEY or NOTIFY_EMAIL_TO missing", () => {
    expect(getEmailConfigFromEnv({})).toBeNull();
    expect(getEmailConfigFromEnv({ RESEND_API_KEY: "x" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("uses a default from-address when NOTIFY_EMAIL_FROM is not set", () => {
    const cfg = getEmailConfigFromEnv({
      RESEND_API_KEY: "key",
      NOTIFY_EMAIL_TO: "me@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg?.from).toBe("Scrapping auta <onboarding@resend.dev>");
  });
});

describe("renderDigestHtml / renderDigestText", () => {
  it("includes car title, price and link", () => {
    const html = renderDigestHtml([group]);
    expect(html).toContain("Škoda Octavia 2.0 TDI");
    expect(html).toContain("359 900 Kč");
    expect(html).toContain("https://example.com/1");

    const text = renderDigestText([group]);
    expect(text).toContain("Škoda Octavia 2.0 TDI");
    expect(text).toContain("https://example.com/1");
  });

  it("resolves the image through resolveImageUrl's 'email' size, not the raw URL", () => {
    // A raw autoscout24 URL (as stored in image_urls / listing.imageUrl)
    // ends in /250x188.webp -- most mail clients (Outlook, some Apple Mail
    // builds) and Gmail's own proxy don't reliably render WebP, so the
    // email must use the confirmed-live JPEG variant instead.
    const html = renderDigestHtml([
      {
        searchName: "AutoScout",
        listings: [
          {
            title: "BMW 320d",
            url: "https://example.com/bmw",
            source: "autoscout24",
            priceCzk: 500000,
            year: 2020,
            mileageKm: 50000,
            fuel: "diesel",
            imageUrl:
              "https://prod.pictures.autoscout24.net/listing-images/abc_def.jpg/250x188.webp",
          },
        ],
      },
    ]);
    expect(html).toContain(
      "https://prod.pictures.autoscout24.net/listing-images/abc_def.jpg/480x360.jpg"
    );
    expect(html).not.toContain("250x188.webp");
  });

  it("keeps the webp image for a CDN with no JPEG variant", () => {
    // aaaauto's vshcdn.net CDN only serves WebP (confirmed live). Gmail and
    // Apple Mail render WebP, so the image is kept rather than dropped.
    const html = renderDigestHtml([
      {
        searchName: "AAA Auto",
        listings: [
          {
            title: "Ford Focus",
            url: "https://example.com/focus",
            source: "aaaauto",
            priceCzk: 300000,
            year: 2018,
            mileageKm: 80000,
            fuel: "benzin",
            imageUrl: "https://aaaautoeuimg.vshcdn.net/thumb/900591757_1024x768x95.jpg",
          },
        ],
      },
    ]);
    expect(html).toContain('<img src="https://aaaautoeuimg.vshcdn.net/thumb/900591757_1024x768x95.jpg"');
  });

  it("falls back to the placeholder when the listing has no image at all", () => {
    const html = renderDigestHtml([
      {
        searchName: "x",
        listings: [
          {
            title: "No photo",
            url: "https://example.com/no-photo",
            source: "bazos",
            priceCzk: 100000,
            year: null,
            mileageKm: null,
            fuel: null,
            imageUrl: null,
          },
        ],
      },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("background:#e5e7eb");
  });
});

describe("sendMatchDigestEmail", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("skips silently when config is missing", async () => {
    const sent = await sendMatchDigestEmail([group], null);
    expect(sent).toBe(false);
  });

  it("skips when there are no listings to send", async () => {
    const sent = await sendMatchDigestEmail(
      [{ searchName: "x", listings: [] }],
      { apiKey: "k", to: "a@b.com", from: "f@b.com" }
    );
    expect(sent).toBe(false);
  });

  it("calls the Resend API when configured and there is something to send", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const sent = await sendMatchDigestEmail([group], {
      apiKey: "key",
      to: "me@example.com",
      from: "Scrapping auta <onboarding@resend.dev>",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" })
    );
  });
});
