"use client";

// The only place that knows about the realtime provider (SPEC 1.2). Screens use LiveFeed,
// so swapping Ably for Neon Realtime later does not touch any page.
import type { ConnectionStateChange, InboundMessage, TokenParams } from "ably";
import { withBase } from "@/lib/base-path";
import { CHANNEL_EVENT, CHANNEL_TALLY, type EventState, type TallySnapshot } from "@/lib/types";

export type LiveStatus = "connecting" | "connected" | "disconnected" | "failed";

export interface LiveFeed {
  onEvent(cb: (s: EventState) => void): void;
  onTally(cb: (s: TallySnapshot) => void): void;
  onStatus(cb: (s: LiveStatus) => void): void;
  close(): void;
}

type Options = { role: "mobile" } | { role: "stage"; stageKey: string };

function mapState(state: string): LiveStatus {
  if (state === "connected") return "connected";
  if (state === "disconnected" || state === "suspended") return "disconnected";
  if (state === "failed" || state === "closed") return "failed";
  return "connecting";
}

export function createLiveFeed(opts: Options): LiveFeed {
  const qs = opts.role === "stage" ? `?role=stage&k=${encodeURIComponent(opts.stageKey)}` : "";
  const eventCbs: ((s: EventState) => void)[] = [];
  const tallyCbs: ((s: TallySnapshot) => void)[] = [];
  const statusCbs: ((s: LiveStatus) => void)[] = [];

  let closed = false;
  let close = () => {};

  // Loaded lazily: keeps the SDK out of the first paint on phones and out of server prerender
  void import("ably/modular").then(({ BaseRealtime, FetchRequest, WebSocketTransport }) => {
    if (closed) return;
    const client = new BaseRealtime({
      authCallback: (_params: TokenParams, callback) => {
        fetch(withBase(`/api/realtime/token${qs}`), { cache: "no-store" })
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

    client.channels.get(CHANNEL_EVENT).subscribe("state", (m: InboundMessage) => {
      eventCbs.forEach((cb) => cb(m.data as EventState));
    });
    if (opts.role === "stage") {
      client.channels.get(CHANNEL_TALLY).subscribe("tally", (m: InboundMessage) => {
        tallyCbs.forEach((cb) => cb(m.data as TallySnapshot));
      });
    }
  });

  return {
    onEvent: (cb) => void eventCbs.push(cb),
    onTally: (cb) => void tallyCbs.push(cb),
    onStatus: (cb) => void statusCbs.push(cb),
    close: () => {
      closed = true;
      close();
    },
  };
}
