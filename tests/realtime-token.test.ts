// SPEC 1.1 #6: a phone token must not be able to read the tally channel. Uses the Ably dev app.
import * as Ably from "ably";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityFor, createTokenRequest, type Role } from "@/lib/server/ably";
import { CHANNEL_EVENT, CHANNEL_TALLY } from "@/lib/types";

const clients: Ably.Realtime[] = [];

function connect(role: Role) {
  const client = new Ably.Realtime({
    authCallback: (_p, cb) => {
      createTokenRequest(role, role === "stage" ? "stage-test" : undefined)
        .then((tr) => cb(null, tr))
        .catch((e) => cb(String(e), null));
    },
  });
  clients.push(client);
  return client;
}

async function attachError(client: Ably.Realtime, channel: string): Promise<number | null> {
  try {
    await client.channels.get(channel).attach();
    return null;
  } catch (e) {
    return (e as Ably.ErrorInfo).code;
  }
}

afterEach(() => {
  while (clients.length) clients.pop()!.close();
});

describe("Ably capabilities by role", () => {
  it("phone capability lists only event:event subscribe", () => {
    expect(capabilityFor("mobile")).toEqual({ [CHANNEL_EVENT]: ["subscribe"] });
  });

  it("phone token can subscribe to event:event", async () => {
    expect(await attachError(connect("mobile"), CHANNEL_EVENT)).toBeNull();
  });

  it("phone token is refused on event:tally (40160 not permitted)", async () => {
    expect(await attachError(connect("mobile"), CHANNEL_TALLY)).toBe(40160);
  });

  it("phone token cannot publish fake events", async () => {
    const client = connect("mobile");
    await expect(client.channels.get(CHANNEL_EVENT).publish("state", { fake: true })).rejects.toMatchObject({
      code: 40160,
    });
  });

  it("stage token can subscribe to event:tally", async () => {
    expect(await attachError(connect("stage"), CHANNEL_TALLY)).toBeNull();
  });
});
