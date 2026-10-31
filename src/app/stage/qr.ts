import "server-only";
import QRCode from "qrcode";

export type QrPath = { size: number; d: string };

// QR as one SVG path, built at prerender time so the `qrcode` package never reaches a browser
// (SPEC 5.4). Quiet zone of 2 modules; the white card around it adds the rest.
export function qrPath(text: string): QrPath {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const quiet = 2;
  let d = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: modules.size + quiet * 2, d };
}
