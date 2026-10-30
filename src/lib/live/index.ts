"use client";

// The only place that knows about the realtime provider (SPEC 1.2). Screens use LiveFeed,
// so swapping Ably for Neon Realtime later does not touch any page. This file is the phone side
// (statuses only); the stage and the MC page use ./staff.
import type { ConnectionStateChange, InboundMessage, TokenParams } from "ably";
import { withBase } from "@/lib/base-path";
import { CHANNEL_EVENT, type EventState } from "@/lib/types";

export type LiveStatus = "connecting" | "connected" | "disconnected" | "failed";

export interface LiveFeed {
  onEvent(cb: (s: EventState) => void): void;
  onStatus(cb: (s: LiveStatus) => void): void;
  close(): void;
}

export function mapState(state: string): LiveStatus {
  if (state === "connected") return "connected";
  if (state === "disconnected" || state === "suspended") return "disconnected";
  if (state === "failed" || state === "closed") return "failed";
  return "connecting";
}

export function createLiveFeed(): LiveFeed {
  const eventCbs: ((s: EventState) => void)[] = [];
  const statusCbs: ((s: LiveStatus) => void)[] = [];

  let closed = false;
  let close = () => {};

  // Loaded lazily: keeps the SDK out of the first paint on phones and out of server prerender
  void import("ably/modular").then(({ BaseRealtime, FetchRequest, WebSocketTransport }) => {
    if (closed) return;
    const client = new BaseRealtime({
      authCallback: (_params: TokenParams, callback) => {
        fetch(withBase("/api/realtime/token"), { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))))
          .then((tr) => callback(null, tr))
          .catch((e: unknown) => callback(e instanceof Error ? e.message : "token error", null));
      },
      plugins: { WebSocketTransport, FetchRequest },
    });
    close = () => client.close();

    client.connection.on((change: ConnectionStateChange) => {
      const s = mapState(change.current);
      statusCbs.forEach((cb) => cb(s));
    });

    // subscribe() also attaches; offline the attach times out and rejects. Ably re-attaches by
    // itself once the connection is back, so the rejection is expected — never an uncaught error.
    client.channels
      .get(CHANNEL_EVENT)
      .subscribe("state", (m: InboundMessage) => {
        eventCbs.forEach((cb) => cb(m.data as EventState));
      })
      .catch(() => undefined);
  });

  return {
    onEvent: (cb) => void eventCbs.push(cb),
    onStatus: (cb) => void statusCbs.push(cb),
    close: () => {
      closed = true;
      close();
    },
  };
}
