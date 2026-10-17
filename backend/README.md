# Landline backend

Keeps one Chromium per connected site, loads captured sessions into it, and gates write actions behind a Face ID approval link.

## Setup

```sh
npm install                      # from the repo root
npx playwright install chromium  # once
cp backend/.env.example backend/.env
npm run build -w shared
npm run build -w backend
npm start -w backend
```

Face ID (WebAuthn) needs an HTTPS `PUBLIC_URL` with a real host, for example an ngrok URL. For local curl tests `http://localhost:3000` is fine, but the phone page cannot run WebAuthn there.

## Smoke test

```sh
S=examples/sessions/saucedemo.session.json

# 1. Create a connection (starts a Chromium)
curl -s localhost:3000/connections -H 'content-type: application/json' \
  -d "{\"site\": $(jq .site $S)}"
# -> {"connection":{"id":"con_...","loggedIn":null,...}}

# 2. Upload the session; expect "loggedIn":true
curl -s -X PUT localhost:3000/connections/con_XXXX/session -H 'content-type: application/json' \
  -d "{\"encoding\":\"plain\",\"session\": $(cat $S)}"

# 3. Ask for approval; the server log prints the /a/<token> link
curl -s localhost:3000/approvals -H 'content-type: application/json' \
  -d '{"connectionId":"con_XXXX","summary":"Pay $42.00 to Acme","kind":"payment"}'

# 4. Open the printed link on the phone and confirm with Face ID.
#    Meanwhile this call returns once the approval is resolved (or after 25s, still pending):
curl -s localhost:3000/approvals/apr_XXXX/wait

# Other
curl -s localhost:3000/connections
curl -s 'localhost:3000/events?since=0'
curl -s -X DELETE localhost:3000/connections/con_XXXX
```

Dashboard events stream over `ws://localhost:3000/ws/dashboard`.

## Notes

- State lives in memory and is dumped to `backend/data.json` after each change. Browsers are not restarted after a server restart, so stored connections point at dead CDP URLs.
- `BROWSER_PROVIDER=local` spawns a Chromium per connection on this machine. `chalk` (one sandbox per connection) is not implemented yet.
