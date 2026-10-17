# Session export format

The extension captures a site's logged-in session and serializes it as a single
JSON object. This is the contract between the extension and whatever replays the
session (the local replay script today, the session service later).

`formatVersion` lets the shape change later without breaking older captures.

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

  // Per-origin web storage. Each browsing origin has its own localStorage and
  // sessionStorage, so they are captured separately per origin.
  "origins": [
    {
      "origin": "https://www.saucedemo.com",
      "localStorage": { "cart-contents": "[1,2]" },
      "sessionStorage": {}
    }
  ]
}
```

## Not captured (yet)

- IndexedDB (some apps keep auth tokens here).
- In-memory JS tokens that never touch cookies or web storage.
- Passkeys, saved passwords, client certificates (not readable by extensions).
