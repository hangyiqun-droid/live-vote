// Lobby greetings waiting for a free bubble slot. Module-level so the realtime feed (which
// lives in the stage shell) can hand messages to the bubbles (which only exist on the lobby scene).
import type { Greeting } from "@/lib/types";

export const MAX_WAITING = 12; // beyond this the oldest waiting greeting is dropped
const MAX_SEEN = 200;

let waiting: Greeting[] = [];
let mounted = 0; // bubble layers currently on screen; with none, greetings are not kept
const seen = new Set<string>(); // Ably may deliver a message twice
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((cb) => cb());

export function pushGreetings(items: Greeting[] | undefined) {
  if (!mounted || !Array.isArray(items)) return;
  for (const g of items) {
    if (!g || typeof g.id !== "string" || typeof g.text !== "string" || seen.has(g.id)) continue;
    seen.add(g.id);
    if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value as string);
    waiting.push({ id: g.id, text: g.text });
    if (waiting.length > MAX_WAITING) waiting.shift();
  }
  notify();
}

export const takeGreeting = (): Greeting | undefined => waiting.shift();
export const waitingCount = () => waiting.length;

export function clearGreetings() {
  waiting = [];
  notify();
}

// The bubble layer registers while it is on screen; the switch going off or the scene changing
// unmounts it, which empties the queue.
export function attachBubbles(onPush: () => void): () => void {
  mounted += 1;
  listeners.add(onPush);
  return () => {
    mounted -= 1;
    listeners.delete(onPush);
    if (mounted <= 0) {
      mounted = 0;
      waiting = [];
    }
  };
}
