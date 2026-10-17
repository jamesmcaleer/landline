# Landline backend

Keeps one Chromium per connected site, loads captured sessions into it, runs one long-lived Droid agent per connection to carry out requests, and gates write actions behind a Face ID approval link.

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
- `BROWSER_PROVIDER=local` spawns a Chromium per connection on this machine. `chalk` runs one Chalk sandbox per connection (see "Chalk sandbox provider").

## Chalk sandbox provider

`BROWSER_PROVIDER=chalk` runs each connection's Chromium in its own Chalk sandbox instead of on this machine.

Setup:

```sh
chalk login                  # once; the helper uses the Chalk CLI login (~/.chalk.yml)
sh backend/scripts/setup-chalk.sh   # creates backend/sandbox/.venv with chalkcompute (needs uv, Python 3.11-3.14)
```

`PUBLIC_URL` must be the public https host that reaches this backend (for example `cloudflared tunnel --url http://localhost:3000`), because the sandbox dials it. It is converted to `wss://`.

How it works: sandboxes accept no inbound connections, so a relay inside the sandbox (`backend/sandbox/relay.py`) dials `wss://<PUBLIC_URL>/ws/sandbox/<connectionId>` with the header `x-landline-token` (a random token the backend made for that connection). The backend (`src/browser/relay-hub.ts`) multiplexes CDP over that one socket. The `cdpUrl` handed to Playwright MCP, `cdp.ts` and the network log is `ws://127.0.0.1:<PORT>/cdp/<connectionId>`; every client socket on that path gets its own channel and its own socket to Chromium inside the sandbox. `GET /cdp/<id>/json/version` also works.

Protocol (JSON text frames): relay sends `{t:"hello",chromium}`, `{t:"msg",ch,d}`, `{t:"close",ch}`, `{t:"ping"}`/`{t:"pong"}`; backend sends `{t:"open",ch}`, `{t:"msg",ch,d}`, `{t:"close",ch}`, `{t:"ping"}`/`{t:"pong"}`. `d` is the raw CDP JSON string. The relay reconnects forever (1 s to 15 s backoff). When it reconnects for a connection with a saved session and no task running, the backend loads the session again (a sandbox restart wipes the profile) and emits `connection.ready`.

The sandbox name and token are saved in `data.json`, so after a backend restart the connection reattaches to its sandbox instead of creating a new one. Keep `data.json` private: it holds the relay tokens.

Cost: a sandbox is billed while it exists, also when idle. `DELETE /connections/:id` terminates it. A sandbox left behind can be removed with `backend/sandbox/.venv/bin/python backend/sandbox/sandbox_ctl.py stop lndl-<id>`.

The dashboard socket also carries live screencast frames `{type:"frame",connectionId,jpeg}` (base64 JPEG, at most 5 per second). They are not stored in `/events`.

## Voice agent (MCP)

The backend is an MCP server for voice agent platforms such as ElevenLabs Agents.

- Streamable HTTP: `POST {PUBLIC_URL}/mcp` (stateless; `GET`/`DELETE` return 405)
- Legacy SSE: `GET {PUBLIC_URL}/mcp/sse`, with messages posted to `/mcp/messages`
- Auth: every request needs `Authorization: Bearer <MCP_TOKEN>`. Set `MCP_TOKEN` in `.env`. Without the header, or with an empty `MCP_TOKEN`, the answer is 401.

Tools:

| Tool | Meaning |
| --- | --- |
| `list_connections()` | Connected sites: `id`, `domain`, `title`, `state`, `loggedIn`, `createdAt` |
| `send_action({ connectionId, query })` | `{ accepted: true }`, or an error `busy` if a turn is running. Returns at once |
| `wait_result({ connectionId, timeoutSeconds? })` | Waits up to 25 s (default and maximum). Returns `{kind:"result"\|"error"\|"question",text}`, `{kind:"approval",summary,url}`, `{kind:"progress",text}` or `{kind:"pending"}` |
| `stop_action({ connectionId })` | `{ stopped: true }` |

Tool loop: `list_connections` -> `send_action` -> repeat `wait_result` until `result` or `error`. On `question`, ask the caller and answer with `send_action`. On `approval`, tell the caller to approve on their phone and keep waiting. On `progress` or `pending`, call `wait_result` again. A late `wait_result` still gets the finished result (the backend keeps the last result until the next `send_action`).

The same wait exists over HTTP: `GET /actions/wait?connectionId=&timeout=25000` -> `{ event: TurnEvent | null }`.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP port, default 3000 |
| `PUBLIC_URL` | Base URL for approval links, and the URL the agent uses to reach this server. Default `http://localhost:$PORT` |
| `LANDLINE_PHONE` | Number shown by `GET /config` |
| `BROWSER_PROVIDER` | `local` or `chalk` |
| `DATA_FILE` | Where state is saved. Default `backend/data.json`. Set it to run a second backend in the same checkout |
| `MCP_TOKEN` | Bearer token required by `/mcp` (see "Voice agent (MCP)") |
| `CALLBACK_URL` | Where the backend POSTs callbacks (below). Optional |
| `FACTORY_API_KEY` | Factory key. The Droid SDK reads it from the environment |
| `DROID_EXEC_PATH` | Overrides the `droid` binary. Default: `backend/bin/droid`, then `droid` on PATH |

## Agent per connection

The first `POST /actions` for a connection creates a Droid session (`backend/src/agent/droid.ts`) with working directory `backend/work/<connectionId>/`. That directory holds `AGENTS.md` (instructions) and `network.jsonl` (every XHR, fetch and document response seen in the browser, bodies cut at 200 KB). The session has two MCP servers: Playwright MCP (`@playwright/mcp@0.0.83 --cdp-endpoint <cdpUrl>`, so it drives the connection's own Chrome) and an in-process `landline` server with `request_approval`, `ask_user` and `report_progress`.

The session uses `AutonomyLevel.Off` ("ask before every action"). With this level every tool call reaches `permissionHandler`, which logs it and returns `ProceedOnce`. See "Live test results" below for what was observed.

**One action at a time per connection.** `POST /actions` while the agent is `working` or `waiting_approval` returns 409. It is accepted when the state is `idle` or `waiting_user` (the user is answering a question the agent asked). `Connection.state` shows the current state.

## Photon tools

| Tool | Call |
| --- | --- |
| `list_connections` | `GET /connections` -> `{ connections: Connection[] }` (each has `state`) |
| `send_action` | `POST /actions` `{ connectionId, query }` -> `202 { accepted: true }`; `404` unknown connection; `409 { error: "action in progress" }` |
| `stop_action` | `POST /actions/stop` `{ connectionId }` -> `204` |

The result of an action does not come in the HTTP response. It arrives as a callback.

## Callback payload

When `CALLBACK_URL` is set the backend POSTs JSON `{ connectionId, type, text, url? }`:

| `type` | When | `text` |
| --- | --- | --- |
| `result` | The agent finished a turn | Final answer |
| `error` | The turn failed, `"timed out"` after 10 minutes, or `"stopped"` | Error text |
| `question` | The agent called `ask_user` | The question. Reply with the next `POST /actions` |
| `approval` | A write needs approval | `Approve: <summary>`, with `url` set to the Face ID page |
| `progress` | The agent called `report_progress` | Short status |

Errors while sending a callback are logged and ignored.

## Droid CLI version

`@factory/droid-sdk@0.9.1` speaks Factory protocol 1.201.1. SDK MCP tools (our `landline` server) need a `droid` CLI with the same protocol, otherwise `createSession` throws `MCP OAuth opt-out requires a confirmed matching Droid protocol version`. The current CLI install script gives 0.244.0, which fails. CLI 0.212.1 works.

`npm install` runs `scripts/fetch-droid.sh`, which downloads 0.212.1 for your platform into `backend/bin/droid` (gitignored, 267 MB). The backend uses that binary automatically. `DROID_EXEC_PATH` in `.env` overrides it. Rerun with `npm run fetch-droid -w backend`. Remove this pin when a newer SDK is released.

## Live test results (saucedemo, CLI 0.212.1, SDK 0.9.1)

- Permission handler: with `AutonomyLevel.Off` it fired for every Playwright MCP tool call (`playwright___browser_snapshot` impact `low`, `playwright___browser_click` impact `high`) and for `landline___request_approval`. It did not fire for native read-only tools (`Read`, `Glob`) or `ToolSearch`. Tool names are `<server>___<tool>`.
- "What items are in my cart and what is the total?": result callback after 51 s from the POST (47 s turn). Droid globbed and read `network.jsonl`, found nothing useful (saucedemo is a client-side app, and the log starts when the agent is created), then used `browser_snapshot` and `browser_click` on the cart. Answer was correct: 3 items, $41.97.
- "Add the backpack to my cart": Droid called `request_approval` (kind `order`) before touching the page. The approval callback arrived with the link. After a `declined` / "testing" decision Droid replied "I didn't add the backpack because approval was declined."
- A second `POST /actions` during the approval wait returned `409 {"error":"action in progress"}`, state was `waiting_approval`.
