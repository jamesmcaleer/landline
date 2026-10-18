"use client";

import type { SiteState } from "@/lib/live";

/** "AS22773 Cox Communications Inc." -> ["Cox Communications Inc.", "AS22773"] */
function splitAsn(asn: string): [string, string] {
  const m = asn.match(/^(AS\d+)\s+(.*)$/);
  return m ? [m[2], m[1]] : [asn, ""];
}

export function Identity({ site }: { site: SiteState }) {
  const id = site.identity;
  const [network, asNumber] = splitAsn(id?.asn ?? "");
  const known = (v: string | undefined) => (v ? v : <span className="dim">unknown</span>);

  return (
    <section className="panel ident" aria-label="Browser identity">
      <div className="panel-head">
        <strong>Identity</strong>
        <span>what the site sees</span>
      </div>
      <dl className="ident-grid">
        <dt>Exit IP</dt>
        <dd className="mono">{known(id?.ip)}</dd>
        <dt>Network</dt>
        <dd className="clip">
          {known(network)} {asNumber && <span className="dim mono">{asNumber}</span>}
        </dd>
        <dt>Location</dt>
        <dd>{known(id?.city)}</dd>
        <dt>Route</dt>
        <dd>{id ? (id.proxy === "residential" ? "Residential proxy" : "Direct") : <span className="dim">unknown</span>}</dd>
        <dt>Browser</dt>
        <dd>{known(id?.browser)}</dd>
        <dt>Fingerprint</dt>
        <dd>
          {id ? (
            <>
              <span className={id.chMatch ? "good" : "bad"}>{id.chMatch ? "Client Hints match" : "Client Hints mismatch"}</span>
              <span className="dim"> · </span>
              <span className={id.webdriver ? "bad" : "good"}>webdriver {String(id.webdriver)}</span>
            </>
          ) : (
            <span className="dim">unknown</span>
          )}
        </dd>
      </dl>
    </section>
  );
}
