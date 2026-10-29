"use client";

// Realtime for the stage and the MC page (SPEC 1.2). Kept apart from ./index (phones) so the
// presence plugin and the tally channel never ship in the phone vote page bundle.
import type { ConnectionStateChange, InboundMessage, TokenParams } from "ably";
import { withBase } from "@/lib/base-path";
import { CHANNEL_EVENT, CHANNEL_TALLY, type EventState, type TallySnapshot } from "@/lib/types";
import { mapState, type LiveStatus } from "./index";

export type { LiveStatus } from "./index";

export interface StaffFeed {
  onEvent(cb: (s: EventState) => void): void;
  onTally(cb: (s: TallySnapshot) => void): void;
  onStatus(cb: (s: LiveStatus) => void): void;
  /** Number of stage screens connected right now (admin only) */
  onScreens(cb: (n: number) => void): void;
  close(): void;
}

type Options = { role: "stage"; stageKey: string } | { role: "admin" };

export function createStaffFeed(opts: Options): StaffFeed {
  const qs = opts.role === "stage" ? `?role=stage&k=${encodeURIComponent(opts.stageKey)}` : "?role=admin";
  const eventCbs: ((s: EventState) => void)[] = [];
  const tallyCbs: ((s: TallySnapshot) => void)[] = [];
  const statusCbs: ((s: LiveStatus) => void)[] = [];
  const screenCbs: ((n: number) => void)[] = [];

  let closed = false;
  let close = () => {};

  void import("ably/modular").then(({ BaseRealtime, FetchRequest, WebSocketTransport, RealtimePresence }) => {
    if (closed) return;
    const client = new BaseRealtime({
      authCallback: (_params: TokenParams, callback) => {
        fetch(withBase(`/api/realtime/token${qs}`), { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))))
          .then((tr) => callback(null, tr))
          .catch((e: unknown) => callback(e instanceof Error ? e.message : "token error", null));
      },
      plugins: { WebSocketTransport, FetchRequest, RealtimePresence },
    });
    close = () => client.close();

    client.connection.on((change: ConnectionStateChange) => {
      const s = mapState(change.current);
      statusCbs.forEach((cb) => cb(s));
    });

    client.channels.get(CHANNEL_EVENT).subscribe("state", (m: InboundMessage) => {
      eventCbs.forEach((cb) => cb(m.data as EventState));
    });
    const tally = client.channels.get(CHANNEL_TALLY);
    void tally.subscribe("tally", (m: InboundMessage) => {
      tallyCbs.forEach((cb) => cb(m.data as TallySnapshot));
    });

    if (opts.role === "stage") {
      // Ably re-enters presence by itself after a reconnect
      void tally.presence.enter({ screen: "stage" }).catch(() => undefined);
    } else {
      const count = () =>
        tally.presence
          .get()
          .then((members) => {
            const n = members.filter((m) => m.clientId?.startsWith("stage-")).length;
            screenCbs.forEach((cb) => cb(n));
          })
          .catch(() => undefined);
      void tally.presence.subscribe(() => void count());
      void count();
    }
  });

  return {
    onEvent: (cb) => void eventCbs.push(cb),
    onTally: (cb) => void tallyCbs.push(cb),
    onStatus: (cb) => void statusCbs.push(cb),
    onScreens: (cb) => void screenCbs.push(cb),
    close: () => {
      closed = true;
      close();
    },
  };
}
