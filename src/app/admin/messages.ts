// Every server answer the MC can see, in Thai — never the raw code
export function actionError(code: string | undefined): string {
  switch (code) {
    case "another_open":
      return "มีรางวัลอื่นเปิดโหวตอยู่ ปิดรางวัลนั้นก่อนแล้วค่อยเปิดรางวัลนี้";
    case "bad_transition":
      return "ทำแบบนี้กับรางวัลในสถานะตอนนี้ไม่ได้ หน้านี้อัปเดตสถานะล่าสุดให้แล้ว";
    case "not_open":
      return "รางวัลนี้ไม่ได้เปิดโหวตอยู่แล้ว ต่อเวลาไม่ได้";
    case "confirm_mismatch":
      return "ชื่อรางวัลที่พิมพ์ไม่ตรง พิมพ์ให้ตรงกับชื่อรางวัลแล้วกดอีกครั้ง";
    case "bad_title":
      return "ชื่อรางวัลต้องมี 1–80 ตัวอักษร (คำอธิบายไม่เกิน 120)";
    case "not_found":
      return "ไม่พบรางวัลนี้ ลองรีเฟรชหน้าอีกครั้ง";
    case "unauthorized":
      return "หมดเวลาเข้าสู่ระบบ ใส่รหัสใหม่อีกครั้ง";
    default:
      return "สั่งไม่สำเร็จ ลองกดอีกครั้ง";
  }
}
