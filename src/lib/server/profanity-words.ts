// Word lists for the lobby greeting filter (fix9). Edit here, no code change needed elsewhere.
// Matching happens on a normalised copy of the text (see greeting-text.ts): lower case, no spaces
// or punctuation, repeated letters squeezed, common look-alike digits/symbols mapped to letters.

// Thai has no spaces between words, so these are matched anywhere inside the text. Keep every entry
// long enough that it does not appear inside an ordinary word (e.g. "สาด" lives in "สาดน้ำ").
export const THAI_SUBSTRING: readonly string[] = [
  "ควย",
  "เหี้ย",
  "เย็ดแม่",
  "เย็ด",
  "สัส",
  "ชิบหาย",
  "ฉิบหาย",
  "ส้นตีน",
  "ระยำ",
  "ไอ้ห่า",
  "ตายห่า",
  "อีดอก",
  "ดอกทอง",
  "ตอแหล",
  "ปัญญาอ่อน",
  "ไอ้ควาย",
  "ไอ้โง่",
  "ไอ้สัตว์",
  "อีสัตว์",
  "หน้าหี",
  "จิ๋ม",
  "เงี่ยน",
  "ขี้หมา",
  "พ่อมึงตาย",
  "แม่มึงตาย",
  "ไปตายซะ",
  "ไปตายเถอะ",
];

// Short Thai words that are only rude on their own: matched as a whole space-separated word
// ("เชี่ยวชาญ", "กะหรี่ปั๊บ", "เสือกระดาษ" are ordinary words that contain a rude one)
export const THAI_WHOLE_WORD: readonly string[] = [
  "หี",
  "ห่า",
  "สาด",
  "ตีน",
  "ควาย",
  "เชี่ย",
  "แม่ง",
  "เเม่ง",
  "กะหรี่",
  "กระหรี่",
  "เสือก",
];

// English: whole words (after look-alike mapping), so "peacock" or "class" are fine
export const ENGLISH_WORDS: readonly string[] = [
  "fuck",
  "fucker",
  "fucking",
  "motherfucker",
  "shit",
  "shitty",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "ass",
  "dick",
  "cock",
  "cunt",
  "pussy",
  "whore",
  "slut",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "porn",
  "sex",
  "wtf",
  "stfu",
];
