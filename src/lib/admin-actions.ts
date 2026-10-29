// MC buttons (SPEC 4.3), shared by the admin page and /api/admin/action
export const TIMER_CHOICES = [0, 60, 90, 120] as const;
export const EXTEND_SECONDS = 30;

export type AdminAction =
  | { action: "show"; award_id: number }
  | { action: "lobby" }
  | { action: "open"; award_id: number; seconds: number }
  | { action: "close"; award_id: number }
  | { action: "reopen"; award_id: number }
  | { action: "reveal"; award_id: number }
  | { action: "unreveal"; award_id: number }
  | { action: "extend"; award_id: number }
  | { action: "reset"; award_id: number; confirm: string }
  | { action: "hide"; on: boolean }
  | { action: "hall"; on: boolean }
  | { action: "qr_fallback"; on: boolean }
  | { action: "rename"; award_id: number; title: string; subtitle: string };
