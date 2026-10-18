# Landline handoff

HackHarvard 2026. Track: Digital Trust.

## Pitch

**Devpost elevator pitch (180 characters):**
> Millions of older adults depend on family for every bill and appointment. Landline gives them their voice on the web: they call, it acts, and family approves payments with Face ID.

Alternatives:
- With scale: "Older adults lost $7.7B to scams last year, and millions rely on family for every online task. Landline gives them back their voice on the web, with family Face ID on every payment."
- With values: "Landline gives older adults their voice on the web. They call to manage bills and appointments themselves, and family approves payments with Face ID. Autonomy, with trust built in."
- Tagline: "Grandma makes the call. You approve the payments."
- Category line: "The secure accessibility layer between seniors and the web."

Themes: their **voice** on the web, **accessibility**, **autonomy** back, and **trust** built in.

Wording: say "aging parents" out loud and write "older adults" on slides. Avoid "the elderly," "can't be trusted," and "incapable." Frame the product as independence with a safety net, not as taking cards away.

## The problem

Many older adults depend on a family member for every online task: bills, health portals, appointments, and insurance. The family member becomes a caregiver. The older adult waits, and loses their independence. They are also the main target of scams.

### Scale (cite the primary sources)

- **$7.7 billion** stolen from Americans aged 60 and older in 2025, in 201,266 complaints. Losses rose 59% in one year. (FBI IC3 2025 Annual Report)
- Adults 60+ filed 20% of all complaints but lost 37% of all money reported. (FBI IC3)
- The FTC estimates fraud cost older adults **$10.1B to $81.5B** in 2024, because most fraud goes unreported. Say "up to" if you cite the high end. (FTC, Protecting Older Consumers 2024–2025)
- Reported losses grew about 4x from 2020 to 2024. Losses over $100,000 made up more than two-thirds of the total. (FTC)
- Phishing and "customer support" scams are among the most common complaints from older adults. (FBI)
- **61.2 million** Americans are 65 or older, 18% of the population. (Census Bureau, Vintage 2024)
- **63 million** Americans are family caregivers, up about 45% in a decade. (AARP and the National Alliance for Caregiving, Caregiving in the US 2025)
- Do not use smartphone ownership figures. Sources conflict (42% to 78%).

Sources: ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf, fbi.gov/news/stories/scammers-target-older-adult-victims, cnbc.com/2025/12/13/financial-fraud-seniors-ftc.html, aarp.org/pri/topics/ltss/family-caregiving/caregiving-in-the-us-2025/, the Census Vintage 2024 release (June 26, 2025).

## What Landline does

Two people, two roles:
- **The older adult** calls a phone number and asks in plain words: "When is my next bill?" or "Move my appointment." Questions are answered in seconds.
- **The caregiver** approves changes. Any change (a payment, a new appointment time, a setting) texts the caregiver a link. The caregiver approves with Face ID. Then the agent finishes.

Key claim: nobody can talk the older adult into a payment, because paying takes the caregiver's face, not the caller's voice. The agent also reads the real account, so a fake bill is caught. In testing, the agent found a $45 balance when the caller had been told $500.

## Positioning history

1. **Start:** "Text or call to use any website you're logged into." A judge kept comparing it to Instinct (instinct.com), a personal agent over iMessage.
2. **Pivot (day 2):** voice-first for older adults who depend on a caregiver. The caregiver only approves. Two principals (the asker and the approver) is the structural difference from Instinct. The stack did not change.
3. **Framing now:** the secure accessibility layer between seniors and the web. It gives them their voice on the web and their autonomy back, with trust built in.

## Demo script

Speakers: **Grandma** (a teammate playing the senior) and **Caius** (playing the grandson). About 75 seconds before the live demo.

**1. The reality (Grandma, to judges):** "For millions of families, here's what it looks like: seniors struggle with their online accounts. Their health portal, their bills, their insurance. So a family member becomes their caregiver, and every small task goes through them."

**2. Skit.**
- Grandma: "Let's show you. I'm a senior, and Caius is my grandson. I need to move my doctor's appointment. Today, I can't just do it. I have to call him."
- Grandma (on the phone): "Hi sweetie, can you change my appointment on the portal when you get a chance?"
- Caius: "Grandma, I'm at work right now. I'll do it when I get home."
- Grandma (to judges): "So now I wait. All day. For something I could have done in a minute, if the website worked for me."

**3. What we built.**
- Caius: "So we built Landline: the secure accessibility layer between seniors and the web."
- Grandma: "I just call a number and talk to a friendly agent that's logged into my accounts. I can ask anything, and I get the answer right away."
- Caius: "And when she asks to change something, like paying a bill or moving an appointment, it texts me first. I approve with Face ID, and it's done. She gets her independence back. I stay in the loop, without doing the work."

**4. Optional (Caius):** "That approval is a safety lock. Last year, scammers took $7.7 billion from Americans over 60. With Landline, nobody can talk Grandma into a payment, because paying takes my face, not her voice."

**5. Into the demo (Grandma):** "Let's show you how it actually works."

Demo flow: Grandma calls the number and asks to pay a $500 bill from an email. The agent checks the real account, finds $45, and asks about the mismatch. Then a real change goes to Caius's phone for Face ID.

Recording plan: screen-record every laptop and the phone at once, then edit them together. Shoot the phone close up for the Face ID moment.

Next sections to write: the caregiver setup flow (it sets up the permissions moment), then the tech stack.

## Sponsors and how we use them

- **Chalk:** one cloud sandbox per connected site, which runs the browser. Credits: $5,000. Prize: $1,500 in Apple gift cards.
- **Factory Droid:** the agent for each site (Droid SDK). It drives the browser with Playwright MCP tools. Credits: $2,000.
- **ElevenLabs:** the voice agent on the phone line. It reaches the backend through our MCP server.
- **Photon:** texts the approval link to the caregiver.
- **Playwright and CDP:** browser control and the live screencast.

On the dashboard, sponsors are named where they do work: the timeline lanes ("ElevenLabs · Photon," "Factory Droid," "Playwright over CDP," "Face ID passkey") and the browser bar ("Google Chrome on Chalk"). No chip row.

## Architecture

1. **Chrome extension** (`extension/`): captures a logged-in session (cookies, localStorage, sessionStorage) from the user's own browser and sends it to the backend.
2. **Backend** (`backend/`, Express 5): keeps state in memory and saves it to `data.json`. Routes: connections, actions, approvals, events, MCP, and dashboard.
3. **Browser provider:** `local` (Chromium on the laptop) or `chalk` (a sandbox per connection), set by `BROWSER_PROVIDER`. Code above the provider uses only a CDP URL.
4. **Chalk sandbox:** runs headful Google Chrome. A small relay inside the sandbox dials out to the backend over a WebSocket (sandboxes take no inbound traffic). The backend multiplexes CDP channels over it.
5. **Session load:** raw CDP sets cookies and adds a script that restores web storage on each page.
6. **Agent:** one Factory Droid per connection. It reads freely. Before any change, its instructions require it to call `request_approval`. It can call `ask_user` for missing details.
7. **Approvals:** a single-use link valid for 5 minutes, texted through Photon. The page uses WebAuthn (passkeys, Face ID). A passkey only works on the domain it was registered on.
8. **MCP server** (`/mcp`, Streamable HTTP, bearer token): tools `list_connections`, `send_action`, `wait_result`, and `stop_action`. The voice agent uses these.
9. **Dashboard** (`dashboard/`, Next.js static export served at `/dashboard`): live screencast, call transcript, requests with timing, browser identity, and a timeline. It watches only. Approval happens on the caregiver's phone.

## Dashboard notes

- Inspiration: two design mockups (Operations B "Session wall" and Operations C "Trace"). We kept their design system: dark #060709, glass panels, Geist and Geist Mono, blue for the agent working, amber only for changes held for approval, green for approved, and red for declined or broken.
- We chose the Trace layout with the approval gate as the main idea: reads flow freely, and a change holds until Face ID releases it.
- Feedback that shaped it: give the browser more room, remove decorative pills, no approve buttons on the dashboard, and show only real data (no invented timing or headers).
- New events behind it: `task.started`, `agent.action` (with `write`), `connection.identity`, and a dashboard-only `net` frame.
- `write` means a changing action (click, type, and similar) after the caregiver approved during that turn. Gating is set by the agent's instructions, not by code.
- Prototype variants (Trace, Depth with 3D, Wall) exist in a separate worktree. Rive was not used. The padlock moment can use a `.riv` file later.

## Build log and fixes

- **Droid CLI version:** SDK and CLI versions must match. The CLI is pinned to 0.212.1 and bundled at `backend/bin/droid` by a postinstall script.
- **One browser per connection:** an early design shared one CDP URL across connections. Fixed: the provider starts a browser per connection.
- **sessionStorage lost:** a Playwright init script disappeared on disconnect. Fixed by loading sessions over raw CDP.
- **WebAuthn domain errors:** the backend ran with an old `PUBLIC_URL`. Fixed by restarting with the current URL. On startup, the backend now drops a passkey registered on a different host, so the next approval registers again.
- **Approval page version:** a branch had an older page. Fixed by merging main.
- **Tunnel expiry (twice):** Cloudflare quick tunnels lost their hostnames after a few hours. Sandboxes could not reach the backend, so adding sites failed with "try again." Fixed by starting a new tunnel and updating `PUBLIC_URL`. A permanent hostname is still open (see below).
- **Extension hid errors:** every failure showed "Check your internet." The cause above was invisible until we read the server logs.
- **BPL (bibliocommons) login failed:** the extension captured only cookies for the exact host, so it missed cookies set on the parent domain (`.bibliocommons.com`). Fixed: `capture.js` also captures every cookie the browser sends to the page. Not yet confirmed with a live BPL login.
- **Voice call stalled ("still pulling that up"):** the agent found $45 vs $500 and asked about it, but a closing "done" message replaced the question, so `wait_result` never returned it. Also, `wait_result` rejected timeouts over 25 seconds before running ("Failed, 0 ms"). Both fixed and tested through MCP.
- **Voice prompt:** rewritten. It keeps a `wait_result` call running, gives short updates, and has a general rule for mismatched amounts instead of a demo-specific note.

## Runbook

1. Backend: `cd backend && npm run build && node dist/index.js`.
2. Tunnel: `cloudflared tunnel --url http://localhost:3000`. Put the URL in `backend/.env` as `PUBLIC_URL`, then restart the backend.
3. After a new tunnel URL:
   - Set the extension's server URL to `http://localhost:3000` (no change needed later).
   - Update the ElevenLabs MCP URL to `<PUBLIC_URL>/mcp`.
   - The caregiver registers Face ID again on the next approval.
4. Dashboard: `cd dashboard && npm install && npm run build`, then open `<PUBLIC_URL>/dashboard`.
5. Extension changes: reload it at `chrome://extensions`.
6. `.env` keys (no values here): `PORT`, `LANDLINE_PHONE`, `PUBLIC_URL`, `CALLBACK_URL`, `BROWSER_PROVIDER`, `FACTORY_API_KEY`, `MCP_TOKEN`, `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `VERIFIER_PHONE`, plus the sandbox network settings.

## Open items

- **Permanent public URL.** Quick tunnels expire. Use a named Cloudflare tunnel or Tailscale Funnel (Tailscale is installed; Funnel needs one click to enable).
- **Login check is weak.** The backend treats "login," "signin," or "auth" in the final URL as signed out. Some sites keep the login page at `/`.
- **Log the final URL** when a session load reports signed out.
- **Progress text to the voice agent is raw** (for example `TodoWrite: {...}`). Send plain English instead.
- **Requests panel** shows only traffic that happens while a dashboard is open.
- **Uncommitted work:** dashboard, backend signals, extension cookie fix, passkey host check, and MCP fixes.
- **Callback noise:** `CALLBACK_URL` points at a port with no listener, so the log shows "Callback failed." This is harmless.

## Voice agent system prompt (current)

See the streamlined prompt in the chat history (sections: Role, How you speak, Tools, Steps, Result kinds, Waiting, When the account does not match).
