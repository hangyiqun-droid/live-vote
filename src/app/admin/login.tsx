"use client";

import { useState } from "react";
import { ArrowPathIcon, LockClosedIcon } from "@heroicons/react/24/solid";
import { withBase } from "@/lib/base-path";
import { fetchWithTimeout } from "@/lib/uuid";
import a from "./admin.module.css";

// SPEC 4.3: no browser `required` popup — checked here, message under the field
export function Login({ version, onDone }: { version: string; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError("ใส่รหัสพิธีกรก่อนกดเข้าสู่ระบบ");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await fetchWithTimeout(
        withBase("/api/admin/login"),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: code }) },
        10_000,
      );
      if (r.ok) {
        setCode("");
        onDone();
        return;
      }
      if (r.status === 429) setError(lockedMessage((await r.json().catch(() => null))?.retry_after));
      else if (r.status === 401) setError("รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง");
      else throw new Error(String(r.status));
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ สัญญาณอาจไม่ดี กดเข้าสู่ระบบอีกครั้ง");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={a.page}>
      <form className={a.login} onSubmit={(e) => void submit(e)}>
        <LockClosedIcon className={a.loginIcon} aria-hidden />
        <h1 className={a.h1}>หน้าพิธีกร</h1>
        <label htmlFor="passcode" className={a.label}>
          รหัสพิธีกร
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          className={a.input}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "passcode-error" : undefined}
        />
        {error && (
          <p id="passcode-error" className={a.fieldError} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={`${a.btn} ${a.btnPrimary} ${a.wide}`} disabled={sending}>
          {sending ? (
            <>
              <ArrowPathIcon className={a.spin} aria-hidden /> กำลังตรวจรหัส…
            </>
          ) : (
            "เข้าสู่ระบบ"
          )}
        </button>
      </form>
      <footer className={a.footer}>{version}</footer>
    </main>
  );
}

function lockedMessage(retryAfter: unknown): string {
  const s = typeof retryAfter === "number" && retryAfter > 0 ? Math.ceil(retryAfter) : 60;
  const wait = s < 60 ? `${s.toLocaleString("th-TH")} วินาที` : `${Math.ceil(s / 60).toLocaleString("th-TH")} นาที`;
  return `ใส่รหัสผิดหลายครั้ง เครื่องนี้ต้องรอ ${wait} แล้วค่อยลองใหม่`;
}
