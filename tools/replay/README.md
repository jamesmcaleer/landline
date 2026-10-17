# replay

Local stand-in for the cloud browser. It loads a session captured by the
Landline extension, replays it into a fresh Chromium, opens the saved page, and
screenshots it. If the screenshot shows you logged in, the capture format works.

```sh
npm install
npx playwright install chromium   # one-time browser download
node replay.mjs ~/Downloads/landline-session-www.saucedemo.com-....json
```

It does **not** test bot detection: same machine, same IP. That gets tested on
the cloud side once the session service exists.

## Try it against the practice sites

1. Load the extension (`chrome://extensions` → Developer mode → Load unpacked →
   pick the `extension/` folder).
2. Log into a practice site and capture:
   - https://www.saucedemo.com — `standard_user` / `secret_sauce` (cookie + localStorage cart)
   - https://the-internet.herokuapp.com/login — `tomsmith` / `SuperSecretPassword!` (session cookie)
3. Run `replay.mjs` on the downloaded JSON and open the screenshot.
