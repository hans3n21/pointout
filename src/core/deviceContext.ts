type Brand = { brand: string; version: string };
type UAData = {
  brands?: Brand[];
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string; fullVersionList?: Brand[] }>;
};
type BrowserNavigator = { userAgent?: string; maxTouchPoints?: number; standalone?: boolean; language?: string; userAgentData?: UAData };
type BrowserEnvironment = {
  navigator: BrowserNavigator;
  location: { href: string; pathname: string };
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio?: number;
  screen: { width: number; height: number };
  matchMedia?: (query: string) => { matches: boolean };
  scrollY?: number;
  document?: { documentElement: { scrollHeight: number } };
};

export type DeviceContext = {
  page_url: string;
  route: string;
  timestamp: string;
  browser: string | null;
  browser_version: string | null;
  operating_system: string | null;
  operating_system_version: string | null;
  device_type: "mobile" | "tablet" | "desktop";
  viewport: { width: number; height: number };
  screen_size: { width: number; height: number };
  pixel_ratio: number;
  touch_enabled: boolean;
  display_mode: "standalone" | "browser";
  // Where the problem was seen - not the only format a fix has to work in.
  orientation: "portrait" | "landscape";
  aspect_ratio: number;
  color_scheme: "dark" | "light";
  language: string | null;
  scroll: { y: number; height: number } | null;
};

export function safePageUrl(href: string): string {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "/";
  }
}

function fallbackFromUserAgent(ua: string) {
  const browserMatch = /(Edg|OPR|CriOS|FxiOS|Chrome|Firefox|Version)\/([\d.]+)/.exec(ua);
  const browserNames: Record<string, string> = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome", FxiOS: "Firefox", Version: "Safari" };
  const os = /(?:Android\s([\d.]+))|(?:(?:iPhone|iPad).*?OS\s([\d_]+))|(?:Windows NT\s([\d.]+))|(?:Mac OS X\s([\d_.]+))/.exec(ua);
  const osName = os?.[1] ? "Android" : os?.[2] ? "iOS" : os?.[3] ? "Windows" : os?.[4] ? "macOS" : null;
  const osVersion = os?.slice(1).find(Boolean)?.replaceAll("_", ".") ?? null;
  return {
    browser: browserMatch ? (browserNames[browserMatch[1]] ?? browserMatch[1]) : null,
    browserVersion: browserMatch?.[2] ?? null,
    osName,
    osVersion,
  };
}

export async function collectDeviceContext(env: BrowserEnvironment = window): Promise<DeviceContext> {
  const nav = env.navigator;
  const ua = nav.userAgent ?? "";
  const fallback = fallbackFromUserAgent(ua);
  const hints = nav.userAgentData;
  let high: { platformVersion?: string; fullVersionList?: Brand[] } = {};
  try {
    high = await hints?.getHighEntropyValues?.(["platformVersion", "fullVersionList"]) ?? {};
  } catch { /* Hint permission is optional. */ }
  const usefulBrand = (high.fullVersionList ?? hints?.brands ?? [])
    .find((item) => !/Not.A.Brand|Chromium/i.test(item.brand))
    ?? (high.fullVersionList ?? hints?.brands ?? []).find((item) => /Chromium/i.test(item.brand));
  const isTablet = /iPad|Tablet/i.test(ua) || (hints?.mobile === false && (nav.maxTouchPoints ?? 0) > 0 && Math.min(env.screen.width, env.screen.height) < 900);
  const isMobile = hints?.mobile ?? /iPhone|Android.*Mobile|Mobile/i.test(ua);
  return {
    page_url: safePageUrl(env.location.href),
    route: env.location.pathname,
    timestamp: new Date().toISOString(),
    browser: usefulBrand?.brand ?? fallback.browser,
    browser_version: usefulBrand?.version ?? fallback.browserVersion,
    operating_system: hints?.platform ?? fallback.osName,
    operating_system_version: high.platformVersion || fallback.osVersion,
    device_type: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
    viewport: { width: env.innerWidth, height: env.innerHeight },
    screen_size: { width: env.screen.width, height: env.screen.height },
    pixel_ratio: env.devicePixelRatio || 1,
    touch_enabled: (nav.maxTouchPoints ?? 0) > 0,
    display_mode: env.matchMedia?.("(display-mode: standalone)").matches || nav.standalone ? "standalone" : "browser",
    orientation: env.innerHeight > env.innerWidth ? "portrait" : "landscape",
    aspect_ratio: Math.round((env.innerWidth / env.innerHeight) * 100) / 100,
    color_scheme: env.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    language: nav.language ?? null,
    scroll: typeof env.scrollY === "number" && env.document
      ? { y: Math.round(env.scrollY), height: env.document.documentElement.scrollHeight }
      : null,
  };
}
