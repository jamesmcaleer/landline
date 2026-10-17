# Session export format

The extension captures a site's logged-in session and serializes it as a single
JSON object. This is the contract between the extension and whatever replays the
session (the local replay script today, the session service later).

`formatVersion` lets the shape change later without breaking older captures.

`session.schema.json` is the machine-readable version of this document. The
extension produces data that validates against it, and the session service
should validate incoming captures against it.

```jsonc
{
  "formatVersion": 1,
  "capturedAt": "2026-01-15T18:30:00.000Z",   // ISO 8601, when the capture ran

  "site": {
    "url": "https://www.saucedemo.com/inventory.html", // tab URL at capture time
    "title": "Swag Labs",                              // tab title
    "domain": "www.saucedemo.com"                      // hostname of the URL
  },

  // Makes the replay browser resemble the user's machine. Reduces how much the
  // replayed session looks like a bot.
  "browser": {
    "userAgent": "Mozilla/5.0 ...",
    "platform": "MacIntel",
    "language": "en-US",
    "timezone": "America/New_York",   // IANA name
    "screen": { "width": 1512, "height": 982 }
  },

  // Every cookie readable for the site, including HttpOnly ones. Each field maps
  // directly onto a Playwright / CDP cookie, so replay can set them as-is.
  "cookies": [
    {
      "name": "session-username",
      "value": "standard_user",
      "domain": ".saucedemo.com",
      "path": "/",
      "secure": true,
      "httpOnly": false,
      "sameSite": "Lax",              // "Strict" | "Lax" | "None" | "no_restriction" normalized to these
      "expirationDate": 1773000000,   // unix seconds; omitted for session cookies
      "hostOnly": false,
      "session": false
    }
  ],

  // Per-origin state. Each browsing origin has its own web storage and
  // IndexedDB, so they are captured separately per origin.
  "origins": [
    {
      "origin": "https://www.saucedemo.com",
      "localStorage": { "cart-contents": "[1,2]" },
      "sessionStorage": {},

      // Full IndexedDB dump. This is where Firebase-based and many SPA auth
      // tokens live. One entry per database, each with its object stores and
      // their records.
      "indexedDB": [
        {
          "name": "firebaseLocalStorageDb",
          "version": 1,
          "stores": [
            {
              "name": "firebaseLocalStorage",
              "keyPath": "fbase_key",   // string | string[] | null (out-of-line)
              "autoIncrement": false,
              "records": [
                {
                  "key": "fbase:user:...",  // used on replay only when keyPath is null
                  "value": { "fbase_key": "...", "value": { "...auth token..." } }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## IndexedDB value limits

Records are serialized to JSON. Strings, numbers, booleans, plain objects and
arrays survive. Dates become strings. Binary values (Blob, ArrayBuffer) do not
survive and are dropped. Auth tokens are almost always strings or plain objects,
so this covers the cases that matter.

## Not captured (yet)

- In-memory JS tokens that never touch cookies, web storage, or IndexedDB.
- Cache Storage / service-worker caches (response caching, not auth).
- Passkeys, saved passwords, client certificates (not readable by extensions).
