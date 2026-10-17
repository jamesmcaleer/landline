// Sends iMessages from the project's shared Photon line.
//
// A shared line can only text a handle that has an active assignment in the
// project and has texted its line at least once. That first text creates the
// direct space this module looks up.

const API = "https://api.photon.codes/v1";

interface Space {
  spaceId: string;
  /** The line's own user in the space. Messages are sent as this user. */
  agentId: string;
}

const spaces = new Map<string, Space>();

function credentials(): { projectId: string; apiKey: string } | null {
  const projectId = process.env.PHOTON_PROJECT_ID;
  const apiKey = process.env.PHOTON_API_KEY;
  return projectId && apiKey ? { projectId, apiKey } : null;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const creds = credentials();
  if (!creds) throw new Error("PHOTON_PROJECT_ID and PHOTON_API_KEY are not set");
  const res = await fetch(`${API}/projects/${creds.projectId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${creds.apiKey}`, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`Photon ${init.method ?? "GET"} ${path.split("?")[0]} returned ${res.status}`);
  return res.json();
}

/** Finds the direct iMessage space between `handle` and the line assigned to it. */
async function findSpace(handle: string): Promise<Space> {
  const cached = spaces.get(handle);
  if (cached) return cached;

  const query = new URLSearchParams({ platform: "imessage", participantHandle: handle });
  const { items } = (await request(`/spaces?${query}`)) as { items: Array<{ id: string; kind: string; participantIds: string[] }> };
  const direct = items.find((s) => s.kind === "direct");
  if (!direct) throw new Error(`${handle} has no iMessage conversation yet; they need to text their Landline line first`);

  for (const userId of direct.participantIds) {
    const user = (await request(`/users/${userId}`)) as { kind: string };
    if (user.kind === "agent") {
      const space = { spaceId: direct.id, agentId: userId };
      spaces.set(handle, space);
      return space;
    }
  }
  throw new Error(`no line found in ${handle}'s iMessage conversation`);
}

/** Texts `text` to `handle`. Sends with the same `idempotencyKey` are only delivered once. */
export async function sendText(handle: string, text: string, idempotencyKey: string): Promise<void> {
  const { spaceId, agentId } = await findSpace(handle);
  await request("/messages", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({ spaceId, senderId: agentId, content: { type: "text", format: "plain", text } }),
  });
}
