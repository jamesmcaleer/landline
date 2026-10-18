"use client";

import type { NetworkFrame } from "@landline/shared";
import type { SiteState } from "@/lib/live";
import { fmtBytes, shortUrl } from "@/lib/utils";

const SHOWN_TYPES = new Set(["Document", "XHR", "Fetch"]); // the calls that carry the account's data
const MAX_ROWS = 40;

function statusClass(code: number): "ok" | "redirect" | "bad" {
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redirect";
  return "bad";
}

/** Setup (DNS, connect, TLS), waiting for the server, and download, as fractions of the request. */
function phases(n: NetworkFrame): Array<{ ms: number; color: string }> {
  if (!n.timing) return [{ ms: n.ms, color: "var(--net-other)" }];
  const { dns, connect, tls, wait, download } = n.timing;
  return [
    { ms: dns + connect + tls, color: "var(--net-script)" },
    { ms: wait, color: "var(--net-doc)" },
    { ms: download, color: "var(--net-api)" },
  ];
}

function title(n: NetworkFrame): string {
  const t = n.timing;
  const parts = t ? ` · DNS ${t.dns} ms · connect ${t.connect} ms · TLS ${t.tls} ms · waiting ${t.wait} ms · download ${t.download} ms` : "";
  return `${n.method} ${n.url}\n${n.status} · ${n.ms} ms · ${fmtBytes(n.size)}${parts}`;
}

export function Requests({ site }: { site: SiteState }) {
  const rows = site.net.filter((n) => SHOWN_TYPES.has(n.resourceType)).slice(-MAX_ROWS).reverse();
  const slowest = Math.max(1, ...rows.map((n) => n.ms));

  return (
    <section className="panel reqs" aria-label="Requests">
      <div className="panel-head">
        <strong>Requests</strong>
        <span>pages and API calls</span>
        <span className="end mono">{site.net.length} seen</span>
      </div>
      <div className="req-list">
        {rows.length === 0 && <div className="empty" style={{ padding: "6px 14px" }}>No requests yet.</div>}
        {rows.map((n) => (
          <div key={n.id} className="req mono" data-status={statusClass(n.status)} title={title(n)}>
            <span className="method">{n.method}</span>
            <span className="code">{n.status}</span>
            <span className="path clip">{shortUrl(n.url)}</span>
            <span className="ms">{n.ms} ms</span>
            <span className="bar" style={{ width: `${Math.max(8, (n.ms / slowest) * 100)}%` }}>
              {phases(n).map((p, i) => (
                <span key={i} style={{ flex: Math.max(p.ms, 0.0001), background: p.color }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
