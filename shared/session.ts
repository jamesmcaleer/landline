// The Landline session export format: the contract between the extension (which
// produces it) and the session service (which replays it). This file is the
// source of truth for the shape. SESSION_FORMAT.md explains it in prose.
//
// Bump SESSION_FORMAT_VERSION and the `formatVersion` literal together whenever
// the shape changes in a way old captures wouldn't satisfy.

export const SESSION_FORMAT_VERSION = 1;

export interface SessionExport {
  /** Format version. Lets the shape change without breaking old captures. */
  formatVersion: 1;
  /** ISO 8601 timestamp of when the capture ran. */
  capturedAt: string;
  site: SiteInfo;
  browser: BrowserInfo;
  cookies: Cookie[];
  origins: OriginState[];
}

export interface SiteInfo {
  /** The tab's URL at capture time. The replay browser opens this. */
  url: string;
  /** The tab's title. */
  title: string;
  /** Hostname of `url`, e.g. "www.saucedemo.com". */
  domain: string;
  /**
   * The tab's favicon. May be a remote URL, a data: URL, or "" if the tab had
   * none. Used to show a logo in the connected-sites list.
   */
  favIconUrl: string;
}

/** Makes the replay browser resemble the user's machine, to look less like a bot. */
export interface BrowserInfo {
  userAgent: string;
  platform: string;
  /** e.g. "en-US". */
  language: string;
  /** IANA timezone name, e.g. "America/New_York". */
  timezone: string;
  screen: { width: number; height: number };
}

/** One cookie, with every field needed to re-set it in another browser. */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  hostOnly: boolean;
  /** True for a session cookie (no expiry). */
  session: boolean;
  /** Unix seconds. Present only when `session` is false. */
  expirationDate?: number;
}

/** Web storage for a single browsing origin. */
export interface OriginState {
  /** e.g. "https://www.saucedemo.com". */
  origin: string;
  /** localStorage key/value pairs. */
  localStorage: Record<string, string>;
  /** sessionStorage key/value pairs. */
  sessionStorage: Record<string, string>;
}
