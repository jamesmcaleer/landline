import type { Callback } from "@landline/shared";

/** POSTs a callback to CALLBACK_URL. Errors are logged and swallowed. */
export async function sendCallback(cb: Callback): Promise<void> {
  const url = process.env.CALLBACK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cb),
    });
    if (!res.ok) console.error(`Callback to ${url} returned ${res.status}`);
  } catch (err) {
    console.error("Callback failed:", err instanceof Error ? err.message : err);
  }
}
