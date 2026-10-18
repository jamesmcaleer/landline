# Write verification (issue #6) and the server view

Status: proposal, 2026-10-16. Branch `mitoiscool/agent-permission-gating`.

## Rule

Read actions run freely. Any action that changes something on the site goes through
approval first. The site agent decides what counts as a write. The backend never
sees the page, so it can't make that call. The agent is told: "if in doubt, ask."

## Flow

1. The site agent is about to do a write. It calls `request_approval` with the
   connection id, a one-line plain-English summary ("Pay the $84.12 Verizon bill
   with the card ending 4421"), and a kind (`payment`, `plan_change`, `order`,
   `settings`, `other`).
2. The backend creates an approval row, mints a single-use token, and texts the
   user a link directly over Photon. The orchestrator is not involved. The link is
   `https://<backend>/a/<token>`, valid for 10 minutes.
3. The user opens the link on their iPhone. The page shows the summary, the
   connection (site + when it was connected), and three buttons: Approve,
   Decline (with an optional message), Revoke this connection.
4. Approve runs WebAuthn with a platform authenticator, which is Face ID on
   iPhone. First approval on a phone registers the passkey, then authenticates
   with it in the same tap sequence. Later approvals only authenticate.
5. The page says "Done. You can close this tab." The pending tool call resolves
   with `{decision: "approved" | "declined" | "revoked", message?: string}`.
6. The agent continues or stops, then returns its result to the orchestrator as
   usual.

If the link expires or the token is reused, the tool call resolves `declined`
with reason `expired`.

## How the agent talks to the backend

Two surfaces over the same code. The HTTP API is the source of truth. The MCP
server is a thin wrapper so a generic agent can plug in.

HTTP (backend, Node + Hono):

```
POST /approvals            {connection_id, summary, kind}  -> {approval_id, status:"pending"}
GET  /approvals/:id/wait   long-poll, returns when resolved or after 25s  -> {status, message?}
GET  /approvals/:id        -> {status, message?}
```

MCP (streamable HTTP, `/mcp`), tools:

```
request_approval(connection_id, summary, kind) -> blocks until resolved, max 10 min
check_approval(approval_id)                   -> non-blocking status
```

`request_approval` blocks server-side by looping on the long-poll. Whether the
agent's MCP client tolerates a multi-minute tool call is the one thing to test
first. Browser Use's own tools are fine since we write them. Factory's SDK does
not document a tool timeout. If a client times out, the agent falls back to
`check_approval` in a loop. Both paths are in the tool descriptions so the agent
knows.

## Pairing and passkeys

The phone number is the identity. On first text the orchestrator creates a `user`
row with the phone and the Photon space id, so the backend can send proactive
texts later. Passkeys are stored per user: credential id, public key, counter.
Use `@simplewebauthn/server` and `@simplewebauthn/browser`. The relying party id
is the backend's domain, so the backend must be on a real HTTPS host (ngrok or a
Vercel deploy), not localhost, or Face ID won't appear.

Fallback when WebAuthn is unavailable: the page shows a 6-digit code and the
user texts it back. The orchestrator forwards the code to the backend. Build this
only if time allows. Without it, the action is declined.

## State

SQLite via `better-sqlite3` in the backend. Single process, so pending approvals
are also an in-memory map of `approval_id -> resolver`. Tables:

```
users        phone PK, photon_space_id, created_at
connections  id PK, phone, site, sandbox_id, status(active|revoked|expired), created_at, revoked_at
approvals    id PK, connection_id, summary, kind, token_hash, status, message, created_at, expires_at, resolved_at
passkeys     credential_id PK, phone, public_key, counter, created_at
events       id, ts, connection_id?, type, payload_json
```

Revoking a connection marks it revoked, tells the session service to stop the
sandbox, and resolves any pending approval for it as `revoked`.

## Server view

Everything the backend does emits an event into `events` and onto a WebSocket
at `/ws/dashboard`. The dashboard is one page per laptop in the demo. Per active
connection it shows a tile with:

- a live screencast of the sandbox browser (CDP `Page.startScreencast`, JPEG
  frames, pushed by the in-sandbox relay to the backend and fanned out to the
  dashboard, so the dashboard never talks to the sandbox host directly)
- the agent's step log and current thought
- an approval banner while a write is pending, flipping to approved or declined
  live when the phone responds

Plus a global strip: connections over time, approvals pending, messages in and
out. The event types are `connection.created|revoked|expired`,
`agent.step`, `agent.thought`, `agent.done`, `approval.requested|resolved`,
`message.in|out`.

## Sponsor stack

Core first, add-ons once the demo works end to end.

- **Photon** for iMessage in and out. Photon is transport only; we host the LLM
  loop. Inbound via the `spectrum-ts` webhook, outbound via `space.send(richlink(url))`
  for the approval link. Daily cap 5,000 messages, 50 new conversations per
  line per day.
- **Chalk** hosts the cloud browsers. Prize is $1,500+ in Apple gift cards,
  which buy hardware at apple.com and Apple Stores. Chalk sandboxes run with no
  lifetime limit and `restart_policy=ALWAYS`, so a browser can stay signed in
  for days. The sandbox accepts no inbound connections, so the design is an
  outbound relay: a small agent process inside the sandbox launches Chromium,
  opens a websocket out to our backend, and relays CDP commands and screencast
  frames over it. Egress is open by default on the host compute class, and a
  `NetworkPolicy` allowlist can pin it to the target site plus our backend. Also
  route all LLM calls through the Chalk model gateway (traces per request) and
  define an eval set: read tasks scored on the answer, write tasks scored on
  "stopped at the gate and caused no side effect before approval," and
  prompt-injection tasks that must be refused. The Python SDK is the only SDK,
  so sandbox control and the eval runner are small Python scripts the Node
  backend shells out to. Two spikes first: headless Chromium under gVisor, and
  a detached relay process surviving after `exec` returns (tmux in the image
  is the documented fallback). Signup is not self-serve in the docs, so get an
  environment from the Chalk booth on Saturday morning.
- **Daytona** only if the booth confirms our org is Tier 3 or higher. Tier 1
  and 2 sandboxes can only reach an "essential services" allowlist, with no
  per-sandbox override, so Chromium there can't load verizon.com. Tier 3+ has
  full egress plus `outboundProxyUrl`, which routes sandbox traffic through a
  proxy of ours. The proxy must be on a public address (ngrok, Tailscale
  Funnel, a VPS), not a LAN IP. $5,000 in credits is the prize.
- **Factory Droid SDK** ($2,000 cash) as the per-site script learner. After a
  browser-driven task succeeds, Droid gets the captured network log and writes
  `sites/<site>/<task>.ts`, runs it against the session cookies, and fixes it
  until it returns the right JSON. The next request runs the script instead of
  the UI. Its `permissionHandler` can also be wired to the same approval flow.

Anti-bot note for either host: run Chromium with `--proxy-server` pointed at a
proxy on the demo laptop, exposed through a public tunnel, so the site sees the
same residential IP the cookies were minted on. This works wherever the sandbox
has open egress.

Skip `jev-ultrafast`. It is a 3-commit MVP that needs a closed TypeSafe API key,
has no CDP URL or cookie support, and lists frames and popups as out of scope.
Vanilla Browser Use gives us `cdp_url`, storage state, and step hooks.

Apple Gift Cards buy products and accessories at apple.com, in Apple Stores,
and in the Apple Store app, plus App Store and subscriptions. They can't fund
Apple Pay or Apple Cash.

## Build order

1. Backend skeleton: Hono, SQLite, the three approval routes, the event bus,
   `/ws/dashboard`. Fake approve via curl. (2h)
2. Approval page with WebAuthn register-then-authenticate, on an HTTPS host.
   Test Face ID on a real iPhone. (3h)
3. Photon outbound richlink from the backend, pairing stores the space id. (1h)
4. MCP wrapper, then the blocking-tool-call test with the agent client we use. (1h)
5. Chalk spike: Chromium in a sandbox plus the outbound CDP relay. Dashboard
   tiles fed by the relayed screencast. (5h)
6. Chalk gateway + evals, then the Droid script learner, if time. (4h+)
