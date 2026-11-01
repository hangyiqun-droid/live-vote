// What the "เริ่มงาน" press does. Everything that needs a user gesture —
// the AudioContext, full screen, the wake lock — starts synchronously inside the click.
import { SoundEngine } from "./engine";

type WakeLock = { release(): Promise<void>; addEventListener(t: "release", cb: () => void): void };
type WakeNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLock> } };

// Keep the projector laptop from dimming; the browser drops the lock whenever the tab is hidden,
// so take it again each time the stage comes back
export function holdWakeLock(): () => void {
  const nav = navigator as WakeNavigator;
  if (!nav.wakeLock) return () => undefined;
  let lock: WakeLock | null = null;
  let stopped = false;
  const take = () => {
    if (stopped || document.visibilityState !== "visible" || lock) return;
    nav
      .wakeLock!.request("screen")
      .then((l) => {
        lock = l;
        l.addEventListener("release", () => (lock = null));
      })
      .catch(() => undefined); // battery saver or no permission: the show goes on
  };
  take();
  document.addEventListener("visibilitychange", take);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", take);
    void lock?.release().catch(() => undefined);
  };
}

export function startShow({ fullscreen = true } = {}): SoundEngine {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  // One silent sample unlocks output on browsers that want a sound played inside the gesture
  const silent = ctx.createBufferSource();
  silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silent.connect(ctx.destination);
  silent.start();
  void ctx.resume().catch(() => undefined);
  if (fullscreen && !document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
  const engine = new SoundEngine(ctx);
  void engine.load();
  return engine;
}
