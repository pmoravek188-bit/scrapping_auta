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
