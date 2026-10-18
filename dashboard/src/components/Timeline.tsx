"use client";

import { useEffect, useRef, useState } from "react";
import { pendingApproval, type SiteState } from "@/lib/live";
import { actionVerb } from "@/lib/describe";
import { mmss } from "@/lib/utils";

const WINDOW_MS = 60_000;
const LABEL_GAP_PX = 64; // a tick is labeled only when the next one is at least this far away
const BUBBLE_MAX_PX = 280;

const LANES = [
  { name: "Call", by: "ElevenLabs · Photon" },
  { name: "Agent", by: "Factory Droid" },
  { name: "Network", by: "Playwright over CDP" },
  { name: "Approval", by: "Face ID passkey" },
];

function netColor(type: string): string {
  if (type === "Document") return "var(--net-doc)";
  if (type === "XHR" || type === "Fetch") return "var(--net-api)";
  if (type === "Script") return "var(--net-script)";
  return "var(--net-other)";
}

export function Timeline({ site }: { site: SiteState }) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const tracks = useRef<Array<HTMLDivElement | null>>([]);
  const heldRef = useRef<HTMLDivElement>(null);
  const t0 = useRef(Date.now()); // items sit at fixed offsets from t0; the tracks slide left
  const [width, setWidth] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const pending = pendingApproval(site);
  const k = width / WINDOW_MS; // px per ms
  const x = (ts: number) => (ts - t0.current) * k;

  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drops expired items and refreshes the held label once a second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // One transform per lane per frame keeps the motion on the compositor.
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const t = Date.now();
      const shift = width - (t - t0.current) * k;
      for (const track of tracks.current) if (track) track.style.transform = `translate3d(${shift}px,0,0)`;
      if (heldRef.current && pending) heldRef.current.style.left = `${Math.max(0, width - (t - pending.requestedAt) * k)}px`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, k, pending]);

  const since = now - WINDOW_MS - 5000;
  const lines = site.lines.filter((l) => l.ts > since && (l.who === "caller" || l.who === "landline"));
  const actions = site.actions.filter((a) => a.ts > since);
  const net = site.net.filter((n) => Date.parse(n.ts) > since);
  const resolved = site.approvals.filter((a) => a.status !== "pending" && (a.resolvedAt ?? 0) > since);
  const anyApproval = pending !== null || resolved.length > 0;

  return (
    <section className="panel timeline" aria-label="Timeline">
      <div className="panel-head">
        <strong>Timeline</strong>
        <span>last 60 seconds</span>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <span />
          {LANES.map((l) => (
            <div className="tl-label" key={l.name}>
              <b>{l.name}</b>
              <span>{l.by}</span>
            </div>
          ))}
        </div>

        <div className="tl-lanes" ref={lanesRef}>
          <div className="tl-axis mono" aria-hidden>
            {[60, 45, 30, 15].map((s) => (
              <span key={s} style={{ left: `${((WINDOW_MS - s * 1000) / WINDOW_MS) * 100}%`, transform: s === 60 ? "none" : undefined }}>−{s}s</span>
            ))}
            <span style={{ left: "auto", right: 6, transform: "none", color: pending ? "var(--amber)" : "var(--blue-soft)" }}>{pending ? "held" : "now"}</span>
          </div>

          <div className="tl-lane">
            <div className="tl-track" ref={(el) => { tracks.current[0] = el; }}>
              {lines.map((l, i) => {
                // A bubble never runs into the next one: it is cut to the gap, down to a sliver.
                const next = lines[i + 1];
                const room = next ? (next.ts - l.ts) * k - 6 : BUBBLE_MAX_PX;
                return (
                  <div key={`${l.ts}-${l.who}`} className="tl-item" style={{ left: x(l.ts) }}>
                    <span className="bubble clip" data-out={l.who === "landline" ? "" : undefined} style={{ maxWidth: Math.max(14, Math.min(BUBBLE_MAX_PX, room)) }} title={l.text}>
                      {l.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tl-lane">
            <div className="tl-track" ref={(el) => { tracks.current[1] = el; }}>
              {actions.map((a, i) => {
                const next = actions[i + 1];
                const labeled = !next || (next.ts - a.ts) * k > LABEL_GAP_PX;
                return (
                  <div key={`${a.ts}-${i}`} className="tl-item" style={{ left: x(a.ts) }} title={a.target ? `${a.tool} · ${a.target}` : a.tool}>
                    <span className="tick" data-write={a.write ? "" : undefined} />
                    {labeled && <span className="tick-label">{a.write ? `write · ${actionVerb(a.tool)}` : actionVerb(a.tool)}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tl-lane">
            <div className="tl-track" ref={(el) => { tracks.current[2] = el; }}>
              {net.map((n, i) => {
                const end = Date.parse(n.ts);
                return (
                  <span
                    key={n.id}
                    className="netbar"
                    style={{ left: x(end - n.ms), width: Math.max(2, n.ms * k), top: `${22 + (i % 3) * 20}%`, background: netColor(n.resourceType) }}
                  />
                );
              })}
            </div>
          </div>

          <div className="tl-lane">
            <div className="tl-track" ref={(el) => { tracks.current[3] = el; }}>
              {resolved.map((a) => (
                <div key={a.id} className="gate" data-status={a.status} style={{ left: x(a.requestedAt), width: Math.max(4, ((a.resolvedAt ?? 0) - a.requestedAt) * k) }}>
                  {a.status === "approved" ? `Approved with Face ID after ${mmss((a.resolvedAt ?? 0) - a.requestedAt)}` : "Declined · nothing changed"}
                </div>
              ))}
            </div>
            {pending && (
              <div ref={heldRef} className="gate" data-status="pending" style={{ right: 0 }}>
                Held for Face ID · {mmss(now - pending.requestedAt)}
              </div>
            )}
            {!anyApproval && <span className="tl-hint">No writes in the last minute. Reads never wait.</span>}
          </div>

          <div className="playhead" data-held={pending ? "" : undefined} aria-hidden />
        </div>
      </div>
    </section>
  );
}
