import { describe, expect, it, vi } from "vitest";
import { collectDeviceContext, safePageUrl } from "../deviceContext";

describe("PointOut device context", () => {
  it("drops query parameters and hash fragments that may contain tokens", () => {
    expect(safePageUrl("https://example.test/configure?id=secret#access_token=abc"))
      .toBe("https://example.test/configure");
  });

  it("uses client hints when offered and leaves undisclosed versions unknown", async () => {
    const browser = {
      userAgent: "UnknownBrowser",
      maxTouchPoints: 5,
      userAgentData: {
        brands: [{ brand: "Chromium", version: "131" }],
        mobile: true,
        platform: "Android",
        getHighEntropyValues: vi.fn().mockResolvedValue({ platformVersion: "15.0.0", fullVersionList: [{ brand: "Chromium", version: "131.0.1" }] }),
      },
    };
    const result = await collectDeviceContext({
      navigator: browser,
      location: { href: "https://example.test/path?secret=x", pathname: "/path" },
      innerWidth: 390,
      innerHeight: 844,
      devicePixelRatio: 3,
      screen: { width: 390, height: 844 },
      matchMedia: () => ({ matches: true }),
    });
    expect(result).toMatchObject({
      page_url: "https://example.test/path",
      route: "/path",
      browser: "Chromium",
      browser_version: "131.0.1",
      operating_system: "Android",
      operating_system_version: "15.0.0",
      device_type: "mobile",
      touch_enabled: true,
      display_mode: "standalone",
    });
  });

  it("falls back to honest Safari iPhone and desktop Chrome data", async () => {
    const base = {
      location: { href: "https://example.test/", pathname: "/" },
      innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
      screen: { width: 390, height: 844 },
      matchMedia: () => ({ matches: false }),
    };
    const safari = await collectDeviceContext({
      ...base,
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        maxTouchPoints: 5,
      },
    });
    expect(safari).toMatchObject({
      browser: "Safari", browser_version: "18.0",
      operating_system: "iOS", operating_system_version: "18.0",
      device_type: "mobile", touch_enabled: true,
    });
    const desktop = await collectDeviceContext({
      ...base,
      navigator: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        maxTouchPoints: 0,
      },
    });
    expect(desktop).toMatchObject({
      browser: "Chrome", operating_system: "Windows", device_type: "desktop", touch_enabled: false,
    });
  });
});
