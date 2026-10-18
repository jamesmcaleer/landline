"use client";

import { useEffect, useState } from "react";
import { pendingApproval, type SiteState } from "@/lib/live";
import { describeStep } from "@/lib/describe";
import { mmss } from "@/lib/utils";

const RESOLVED_SHOWN_MS = 8000; // how long "approved" / "declined" stays in the footer

/** Re-renders every second while `on`, for running timers. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return on ? now : Date.now();
}

function Footer({ site }: { site: SiteState }) {
  const pending = pendingApproval(site);
  const last = site.approvals[site.approvals.length - 1];
  const recent = last && last.status !== "pending" && Date.now() - (last.resolvedAt ?? 0) < RESOLVED_SHOWN_MS ? last : null;
  const now = useNow(pending !== null || recent !== null);

  if (site.loggedIn === false) {
    return (
      <div key="out" className="foot-state">
        <span className="dot" style={{ background: "var(--red)" }} />
        <span className="foot-text">Signed out. Add this site again from the Landline extension.</span>
      </div>
    );
  }
  if (pending) {
    return (
      <div key="held" className="foot-state" role="status">
        <span className="dot dot-ping" style={{ background: "var(--amber)", color: "var(--amber)" }} />
        <span className="foot-label" style={{ color: "var(--amber)" }}>Held</span>
        <span className="foot-text clip">{pending.summary}</span>
        <span className="foot-meta mono" style={{ color: "var(--amber)" }}>Texted to caretaker · {mmss(now - pending.requestedAt)}</span>
      </div>
    );
  }
  if (recent) {
    const ok = recent.status === "approved";
    return (
      <div key={`r-${recent.id}`} className="foot-state" role="status">
        <span className="dot" style={{ background: ok ? "var(--green)" : "var(--red)" }} />
        <span className="foot-label" style={{ color: ok ? "var(--green)" : "var(--red)" }}>{ok ? "Approved with Face ID" : "Declined"}</span>
        <span className="foot-text clip">{ok ? recent.summary : "Nothing was changed."}</span>
      </div>
    );
  }
  if (site.busy) {
    let step: string | null = null;
    for (let i = site.steps.length - 1; i >= 0 && !step; i--) step = describeStep(site.steps[i].text);
    return (
      <div key="busy" className="foot-state">
        <span className="dot pulse" style={{ background: "var(--blue)" }} />
        <span className="foot-label" style={{ color: "var(--blue-soft)" }}>Droid</span>
        <span className="foot-text clip">
          {step ?? "Thinking"}
          <span className="caret" />
        </span>
      </div>
    );
  }
  return (
    <div key="idle" className="foot-state">
      <span className="dot" style={{ background: "var(--muted-3)" }} />
      <span className="foot-text" style={{ color: "var(--muted-2)" }}>Idle. Waiting for the next call.</span>
    </div>
  );
}

export function Browser({ site }: { site: SiteState }) {
  const held = pendingApproval(site) !== null;
  const url = site.pageUrl ?? site.site?.url ?? "";
  const id = site.identity;
  const via = `${id?.browser || "Chrome"}${id?.ip ? " on Chalk" : ""}`;

  return (
    <section className="panel browser" aria-label="Live browser">
      <div className="browser-bar">
        <span className="url mono clip">{url}</span>
        <span className="via">{via}</span>
      </div>
      <div className="viewport" data-held={held ? "" : undefined}>
        {site.frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/jpeg;base64,${site.frame}`} alt={`Live view of ${site.site?.domain ?? "the site"}`} />
        ) : (
          <span className="viewport-empty">{site.loggedIn === null ? "Starting the browser…" : "Waiting for the first frame…"}</span>
        )}
      </div>
      <div className="browser-foot">
        <Footer site={site} />
      </div>
    </section>
  );
}
