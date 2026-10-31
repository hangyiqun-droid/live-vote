"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, PaperAirplaneIcon } from "@heroicons/react/24/solid";
import { withBase } from "@/lib/base-path";
import { GREETING_GAP_SECONDS, GREETING_MAX_CHARS } from "@/lib/types";
import { fetchWithTimeout, uuid4 } from "@/lib/uuid";
import { loadDeviceId } from "./vote-store";

// fix9: send a short hello to the big screen while the lobby is up. Anonymous, nothing is kept.
// Validation is done in code (never the browser's own popup); the server re-checks all of it.

type Problem = { kind: "input" | "send"; text: string; retry?: boolean };

const SERVER_TEXT: Record<string, string> = {
  empty: "พิมพ์ข้อความก่อนส่งนะครับ",
  too_long: `ข้อความยาวเกิน ${GREETING_MAX_CHARS} ตัวอักษร ช่วยตัดให้สั้นลงหน่อยนะครับ`,
  blocked: "ข้อความนี้ขึ้นจอไม่ได้ ลองเปลี่ยนคำแล้วส่งใหม่นะครับ",
  closed: "ตอนนี้ปิดรับข้อความขึ้นจอแล้วครับ",
  busy: "ตอนนี้มีข้อความเข้ามาเยอะ รอสักครู่แล้วกดส่งอีกครั้งได้เลย",
  unavailable: "ส่งขึ้นจอไม่สำเร็จ กดลองใหม่ได้เลย",
};

const length = (t: string) => Array.from(t.trim()).length;

export function GreetingBox() {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [wait, setWait] = useState(0); // seconds until this phone may send again
  // A retry of the same text keeps its request id, so a lost reply never uses up the 10 s slot twice
  const attempt = useRef<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1_000);
    return () => clearTimeout(t);
  }, [wait]);

  const n = length(text);
  const over = n > GREETING_MAX_CHARS;

  const submit = async () => {
    if (sending || wait > 0) return;
    const body = text.trim();
    if (body.length === 0) {
      setProblem({ kind: "input", text: SERVER_TEXT.empty });
      return;
    }
    if (over) {
      setProblem({ kind: "input", text: SERVER_TEXT.too_long });
      return;
    }
    if (!attempt.current || attempt.current.text !== body) attempt.current = { id: uuid4(), text: body };
    setSending(true);
    setProblem(null);
    setSent(false);
    try {
      const r = await fetchWithTimeout(withBase("/api/greeting"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, request_id: attempt.current.id, device_id: loadDeviceId() ?? undefined }),
      });
      if (r.status >= 500 || r.status === 400) throw new Error(String(r.status));
      const j = (await r.json()) as { result: string; retry_after?: number };
      if (j.result === "sent") {
        setSent(true);
        setText("");
        attempt.current = null;
        setWait(GREETING_GAP_SECONDS);
      } else if (j.result === "too_soon") {
        const s = Math.max(1, Math.min(60, j.retry_after ?? GREETING_GAP_SECONDS));
        setWait(s);
        setProblem({ kind: "send", text: `ส่งถี่ไปนิดนึง รออีก ${s} วินาทีแล้วส่งใหม่ได้ครับ` });
      } else {
        setProblem({ kind: "send", text: SERVER_TEXT[j.result] ?? SERVER_TEXT.unavailable, retry: j.result === "unavailable" });
      }
    } catch {
      setProblem({ kind: "send", text: "ส่งไม่สำเร็จ สัญญาณอาจไม่ดี กดลองใหม่ได้เลย ระบบไม่ส่งซ้ำ", retry: true });
    } finally {
      setSending(false);
    }
  };

  const describedBy = problem ? "greet-problem" : "greet-help";
  return (
    <form
      className="mx-4 mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-greeting-box
    >
      <label htmlFor="greet-text" className="block text-lg font-extrabold">
        ฝากข้อความทักทายขึ้นจอใหญ่
      </label>
      <p id="greet-help" className="mt-1 text-sm text-slate-600">
        ไม่ต้องบอกชื่อ ข้อความจะขึ้นจอสักครู่แล้วหายไป
      </p>
      <input
        id="greet-text"
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (problem?.kind === "input") setProblem(null);
          setSent(false);
        }}
        autoComplete="off"
        enterKeyHint="send"
        placeholder="พิมพ์ข้อความสั้น ๆ"
        aria-invalid={problem?.kind === "input" || over || undefined}
        aria-describedby={describedBy}
        className={`mt-3 min-h-12 w-full rounded-xl border-2 px-3 text-lg ${
          over || problem?.kind === "input" ? "border-red-500" : "border-slate-300"
        }`}
      />
      <p className={`mt-1 text-right text-sm tabular-nums ${over ? "font-bold text-red-700" : "text-slate-500"}`} aria-live="off">
        {n.toLocaleString("th-TH")}/{GREETING_MAX_CHARS.toLocaleString("th-TH")}
      </p>

      <button
        type="submit"
        disabled={sending || wait > 0}
        aria-describedby={describedBy}
        className="mt-2 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-lg font-bold text-white disabled:opacity-60"
      >
        {sending ? (
          <>
            <ArrowPathIcon className="size-5 motion-safe:animate-spin" aria-hidden />
            กำลังส่ง…
          </>
        ) : problem?.retry ? (
          <>
            <ArrowPathIcon className="size-5" aria-hidden />
            ลองใหม่
          </>
        ) : wait > 0 ? (
          `ส่งได้อีกครั้งใน ${wait.toLocaleString("th-TH")} วินาที`
        ) : (
          <>
            <PaperAirplaneIcon className="size-5" aria-hidden />
            ส่งขึ้นจอ
          </>
        )}
      </button>

      {problem && (
        <p id="greet-problem" role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          {problem.text}
        </p>
      )}
      {sent && !problem && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          ส่งขึ้นจอแล้ว มองที่จอใหญ่ได้เลย
        </p>
      )}
    </form>
  );
}
