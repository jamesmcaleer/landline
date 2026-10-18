"use client";

import { useEffect, useRef } from "react";
import type { SiteState } from "@/lib/live";

const WHO = { caller: "Caller", landline: "Landline", caretaker: "Caretaker" } as const;

export function Call({ site }: { site: SiteState }) {
  const listRef = useRef<HTMLDivElement>(null);
  const count = site.lines.length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, site.id]);

  return (
    <section className="panel call" aria-label="Call transcript">
      <div className="panel-head">
        <strong>Call</strong>
        <span>what was asked and answered</span>
      </div>
      <div className="call-list" ref={listRef}>
        {count === 0 && <div className="empty">Nothing asked yet.</div>}
        {site.lines.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="call-line" data-tone={l.tone}>
            <span className="call-who">{WHO[l.who]}</span>
            <span className="call-text">{l.tone === "held" ? `Asked to approve: ${l.text}` : l.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
