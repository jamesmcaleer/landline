<p align="center">
  <img src="docs/banner.png" alt="Landline: the web, for the generation that only makes phone calls" width="100%">
</p>

<p align="center">
  Built in 36 hours at HackHarvard 2026 · <a href="https://devpost.com/software/landline-0rmti3">Devpost</a>
</p>

## The problem

63 million Americans are family caregivers (AARP, 2025), and for many seniors that caregiver is the only way anything gets done online. Health portals, utilities, insurance, the library: check a bill, move an appointment, read a message from the doctor. The senior waits for something that should take a minute, and every small task goes through someone else.

The same people are the main target of fraud. Americans 60 and older reported $7.7 billion lost to scams in 2025, up 59% in one year (FBI IC3).

Most products for this take control away from the senior, either with a caregiver dashboard or a locked-down phone. Landline gives that autonomy back: the senior asks for things in their own words, over a phone call, and the caregiver only has to say yes or no.

## What Landline does

**The senior calls.** A normal phone number, on purpose. There's no app, password or smartphone involved. They talk: "When is my next bill?" "Move my appointment to Thursday." "What did the doctor's office send me?" An agent that is already logged into their accounts answers in plain words.

**The caregiver approves.** Anything that only reads goes straight through. Anything that changes something, like a payment, a new appointment time or a changed setting, waits. The caregiver gets a text, taps the link, passes Face ID, and the agent finishes the job.

### Security model

- **The person who asks cannot approve.** Social-engineering the senior gets a scammer nothing. A write needs the caregiver's passkey, and the passkey lives on the caregiver's device.
- **No credentials move.** The caregiver enrolls an account in one click from a browser that's already logged in. The password never leaves that browser and the agent never sees it. Only the session is transferred.
- **The agent has ground truth.** It reads the real account from the site's own data. If a scam email says the senior owes $500 and the account shows $45, the agent says so instead of paying.

## How it works

1. **Enroll in one click.** The caregiver opens a site they're logged into and clicks the Landline Chrome extension. The session moves to the backend; the password stays in the browser. The caregiver gets a contact card with the Landline number to add to the senior's phone.
2. **Each account gets its own cloud browser.** The session loads into a real Google Chrome running in an isolated sandbox, one per connected site.
3. **The senior calls.** The call reaches a voice agent written for someone who has never used a website: short sentences, no technical words.
4. **An agent works the site.** Each account has its own agent. It reverse-engineers the site from its network traffic, then drives the browser to read or change what was asked, keeping the caller updated while it works.
5. **Writes wait for family.** Before any change, the agent stops and texts the caregiver a single-use approval link. The change only happens after a Face ID confirmation.
6. **The senior hears back.** "Done. Your appointment is Tuesday at 10."

## Built with

<table>
<tr>
<td width="200" align="center" valign="middle">
<a href="https://photon.codes/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/sponsors/photon-dark.png">
<img src="docs/sponsors/photon-light.png" alt="Photon" width="150">
</picture>
</a>
<br><sub><a href="https://photon.codes/">photon.codes</a></sub>
</td>
<td valign="top">

**Voice and iMessage: the senior's interface and the caregiver's approvals.**

- **The phone number the senior calls** is a Photon 2.0 number, routed over SIP to an ElevenLabs conversational agent. That agent talks to the Landline backend to list the senior's accounts, start a request and wait for the result, giving short spoken updates so the call never goes quiet.
- **Approval links reach the caregiver over Photon's iMessage line**, using Photon's Users, Spaces and Messages APIs. Each send carries an idempotency key, so a retry never texts the caregiver twice.

</td>
</tr>
</table>

<table>
<tr>
<td width="200" align="center" valign="middle">
<a href="https://factory.ai/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/sponsors/factory-dark.svg">
<img src="docs/sponsors/factory-light.svg" alt="Factory" width="150">
</picture>
</a>
<br><sub><a href="https://factory.ai/">factory.ai</a></sub>
</td>
<td valign="top">

**The Droid SDK: one agent per connected account.**

- **Each account gets its own Droid**, running in the backend through the TypeScript SDK. It drives that account's browser through Playwright tools: navigating, clicking and filling out forms from first click to confirmation.
- **It reverse-engineers the site's API as it goes.** Every request the site's own frontend makes is logged, with its response, into the Droid's working directory, and the Droid reads that log instead of scraping the page. That's how it gets the real balance: from the JSON the site itself fetched.
- **Autonomy is set to Off**, so every tool call passes through a permission handler. Two in-process tools enforce the safety rules: one requests caregiver approval before any write, and the Droid blocks until the caregiver decides; the other asks the senior when a detail is missing.

</td>
</tr>
</table>

<table>
<tr>
<td width="200" align="center" valign="middle">
<a href="https://chalk.ai/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/sponsors/chalk-dark.svg">
<img src="docs/sponsors/chalk-light.svg" alt="Chalk" width="120">
</picture>
</a>
<br><sub><a href="https://chalk.ai/">chalk.ai</a></sub>
</td>
<td valign="top">

**Sandboxes: an isolated cloud browser for every account.**

- **Each connected site runs in its own Chalk Sandbox**, so accounts never share a browser. Sandboxes restart automatically, and the backend reloads the account's session when one comes back.
- **A custom Chalk Image** builds on Debian slim and installs real Google Chrome, running headful on a virtual display, so sites see a normal browser rather than an automation build.
- **Sandboxes accept no inbound traffic**, so a relay inside each one dials out to the backend over a WebSocket. Every Chrome DevTools Protocol connection, from the agent's browser controls to the network log, is multiplexed over that one outbound tunnel.
- **Each sandbox gets a sticky residential exit** pinned to its connection, so sites don't challenge it as datacenter traffic.

</td>
</tr>
</table>

## Under the hood

- **Chrome extension.** Captures every cookie the browser would send for the page, across all domains, plus local and session storage, and hands the session to the backend. Shows the Landline number and a contact card after the first connection.
- **Backend.** Express 5 in TypeScript. Manages one sandbox and one Droid per connection, exposes the voice agent's tools as an MCP server over Streamable HTTP with a bearer token, and runs the approval flow.
- **Approvals.** Single-use links with a five-minute expiry. The page uses WebAuthn passkeys (Face ID). The first approval registers the caregiver's passkey; passkeys registered on a different host are dropped, so a moved deployment can't be approved with a stale credential.
- **Demo dashboard.** Next.js, served by the backend. A live screencast of the cloud browser, the call transcript, and a timeline with lanes for the call, the Droid, the browser and the passkey. It only watches: the approve button exists only on the caregiver's phone.
- **Shared types.** One package of event and session types used by the backend, dashboard and extension.

### Repository layout

| Path | What's there |
|---|---|
| `extension/` | Chrome extension (session capture, connect flow) |
| `backend/` | API, MCP server, Droid agents, approvals, Photon integration |
| `backend/sandbox/` | Chalk Image definition, sandbox control, and the outbound relay |
| `dashboard/` | Next.js demo dashboard |
| `shared/` | Types shared across packages |
| `tools/replay/` | Local session replay for testing captures |

Setup and environment variables are in [`backend/README.md`](backend/README.md).

## What's next

- **Compile each site into an API.** The Droid already reverse-engineers requests from the network log. Next it writes them down as typed tools, so the second question about a site never touches a browser.
- **Reach out first.** Landline calls or texts the senior when something needs attention: "Your electric bill is due Friday, want me to ask about paying it?"
- **Agent evals on Chalk.** A fixed task set per type of site, run on every prompt change, with the scam-mismatch catch as a required pass.
- **Caregiver rules,** so routine writes can skip approval while bigger ones always ask: for example, a copay under $50 goes straight through, while any larger payment or a change to account settings waits for the caregiver.
- **Pilots** with senior living communities and caregiver networks.

## Team

- **James McAleer:** Chrome extension, Photon, voice agent, dashboard
- **Caius Chevalier:** sandboxes/Chalk, Droid, approvals and passkeys
