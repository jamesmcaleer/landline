"use client";

import { useState } from "react";
import { useLive } from "@/lib/live";
import { Header } from "@/components/Header";
import { Browser } from "@/components/Browser";
import { Call } from "@/components/Call";
import { Requests } from "@/components/Requests";
import { Identity } from "@/components/Identity";
import { Timeline } from "@/components/Timeline";

export default function Dashboard() {
  const live = useLive();
  const [picked, setPicked] = useState<string | null>(null);
  const focus = picked && live.order.includes(picked) ? picked : (live.order[0] ?? null);
  const site = focus ? live.sites.get(focus) : undefined;

  return (
    <div className="app">
      <Header live={live} focus={focus} onFocus={setPicked} />
      <main className="main">
        {site ? (
          <>
            <Browser site={site} />
            <div className="side">
              <Call site={site} />
              <Requests site={site} />
              <Identity site={site} />
            </div>
            <Timeline key={site.id} site={site} />
          </>
        ) : (
          <div className="nothing">
            <div>
              <h2>No sites connected</h2>
              <p>{live.online ? "Open a site you're signed in to and add it with the Landline extension." : "Connecting to Landline…"}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
