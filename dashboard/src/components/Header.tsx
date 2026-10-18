"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { pendingApproval, type LiveState } from "@/lib/live";
import { clock } from "@/lib/utils";

function Mark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
      </svg>
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState<number | null>(null);
  useLayoutEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">{now === null ? "" : clock(now)}</span>;
}

export function Header({ live, focus, onFocus }: { live: LiveState; focus: string | null; onFocus: (id: string) => void }) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  // Slides one fixed-width bar under the selected tab with translate + scaleX, never width.
  useLayoutEffect(() => {
    const tab = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const bar = indicatorRef.current;
    if (!bar) return;
    if (!tab) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.opacity = "1";
    bar.style.transform = `translateX(${tab.offsetLeft + 10}px) scaleX(${(tab.offsetWidth - 20) / 100})`;
  }, [focus, live.order]);

  return (
    <header className="top">
      <div className="brand">
        <Mark />
        Landline
      </div>

      <div className="tabs" role="tablist" aria-label="Connected sites" ref={tabsRef}>
        {live.order.map((id) => {
          const s = live.sites.get(id);
          if (!s?.site) return null;
          const held = pendingApproval(s) !== null;
          const name = s.site.domain.replace(/^www\./, "");
          return (
            <button key={id} role="tab" className="tab" aria-selected={id === focus} onClick={() => onFocus(id)}>
              {s.site.favIconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="tab-icon" src={s.site.favIconUrl} alt="" />
              ) : (
                <span className="tab-icon tab-letter">{name[0]?.toUpperCase()}</span>
              )}
              {name}
              {held ? (
                <span className="tab-dot" style={{ background: "var(--amber)" }} title="Held for approval" />
              ) : s.busy ? (
                <span className="tab-dot pulse" style={{ background: "var(--blue)" }} title="Working" />
              ) : null}
            </button>
          );
        })}
        <span className="tab-indicator" ref={indicatorRef} aria-hidden />
      </div>

      <div className="status">
        <span className="dot" style={{ background: live.online ? "var(--green)" : "var(--red)", width: 7, height: 7 }} />
        {live.online ? "Live" : "Reconnecting"}
        <Clock />
      </div>
    </header>
  );
}
