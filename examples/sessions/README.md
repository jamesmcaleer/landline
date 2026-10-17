# Example sessions

Real captures from the extension, in the `SessionExport` format
(`shared/session.ts`). They exist so the session service can be built and tested
against actual data before the extension's upload path is wired up.

Both are logins to **public demo accounts with shared test credentials** — no
personal data. Only test-site sessions belong here. Never commit a capture of a
real personal login.

| File | Site | What it exercises |
|---|---|---|
| `saucedemo.session.json` | saucedemo.com | A cookie login plus a localStorage cart (`cart-contents`). |
| `the-internet-2fa.session.json` | the-internet.herokuapp.com | An HttpOnly, server-checked session cookie behind 2FA. |

Both replay cleanly with `tools/replay`:

```sh
cd tools/replay
node replay.mjs ../../examples/sessions/saucedemo.session.json
```

These demo sites have no short server-side expiry, so a capture keeps working
for a long time. A real site (Verizon, etc.) would not — that's the session
service's problem to solve, not something these examples show.
