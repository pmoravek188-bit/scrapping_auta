import { describe, expect, it } from "vitest";
import { applicationServerKeyMatches, bytesEqual, shortUserAgent, urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "./push";

/**
 * Unit tests for push.ts's pure helpers — the parts of the Web Push client
 * code that don't need a real browser (PushManager/ServiceWorker/Notification
 * aren't available under vitest's "node" environment, see vitest.config.ts).
 * `subscribeToPush`/`syncPushSubscription`/`unsubscribeFromPush` themselves
 * are exercised manually (see task) rather than unit-tested here.
 */

describe("urlBase64ToUint8Array", () => {
  it("decodes a URL-safe base64 string to the same bytes standard base64 would", () => {
    // "hello" -> base64 "aGVsbG8=" -> URL-safe "aGVsbG8" (no padding needed here)
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Buffer.from(bytes).toString("utf8")).toBe("hello");
  });

  it("handles '-' and '_' URL-safe substitutions and re-adds padding", () => {
    // Bytes chosen so the standard-base64 encoding contains '+' and '/'.
    const original = new Uint8Array([251, 255, 191]);
    const standardB64 = Buffer.from(original).toString("base64"); // "+/+/"-ish, contains + or /
    const urlSafe = standardB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const decoded = urlBase64ToUint8Array(urlSafe);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("decodes the real VAPID_PUBLIC_KEY to a 65-byte uncompressed P-256 point", () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04); // uncompressed EC point marker
  });
});

describe("bytesEqual", () => {
  it("is true for identical arrays", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("is false for different lengths", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("is false for same length but different content", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("is true for two empty arrays", () => {
    expect(bytesEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

function fakeSubscription(applicationServerKey: ArrayBuffer | null): PushSubscription {
  return { options: { applicationServerKey } } as unknown as PushSubscription;
}

describe("applicationServerKeyMatches", () => {
  it("is true when the subscription's key matches VAPID_PUBLIC_KEY", () => {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    expect(applicationServerKeyMatches(fakeSubscription(key.buffer as ArrayBuffer))).toBe(true);
  });

  it("is false when the subscription was made with a different (e.g. rotated) key", () => {
    const otherKey = new Uint8Array(65).fill(7);
    expect(applicationServerKeyMatches(fakeSubscription(otherKey.buffer))).toBe(false);
  });

  it("is true (don't force a resubscribe) when the browser doesn't expose applicationServerKey at all", () => {
    expect(applicationServerKeyMatches(fakeSubscription(null))).toBe(true);
  });
});

describe("shortUserAgent", () => {
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
  const MAC_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  const WINDOWS_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0";
  const IOS_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1";

  it("labels an iPhone Safari UA", () => {
    expect(shortUserAgent(IPHONE_SAFARI)).toBe("Safari na iPhone");
  });

  it("labels an Android Chrome UA", () => {
    expect(shortUserAgent(ANDROID_CHROME)).toBe("Chrome na Android");
  });

  it("labels a Mac Chrome UA", () => {
    expect(shortUserAgent(MAC_CHROME)).toBe("Chrome na Mac");
  });

  it("labels a Windows Firefox UA", () => {
    expect(shortUserAgent(WINDOWS_FIREFOX)).toBe("Firefox na Windows");
  });

  it("recognizes Chrome-on-iOS (CriOS) distinctly from Safari", () => {
    expect(shortUserAgent(IOS_CHROME)).toBe("Chrome na iPhone");
  });

  it("falls back to a generic label for an unrecognized UA", () => {
    expect(shortUserAgent("SomeWeirdBot/1.0")).toBe("Prohlížeč");
  });
});
