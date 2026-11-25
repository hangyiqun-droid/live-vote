// The 29 demo nominees. Every one is nominated in every award. All names are made up.
// Two nominees share a nickname (ids 15 and 22): the stage tells them apart by group.
// There are no photos: the app draws a coloured circle with the first letter of the nickname.

export type Group = "AMBER" | "AZURE" | "JADE" | "RUBY";

export type Nominee = {
  id: number;
  nickname: string;
  firstName: string;
  group: Group;
};

export const GROUPS: Group[] = ["AMBER", "AZURE", "JADE", "RUBY"];

export const nominees: Nominee[] = [
  { id: 1, nickname: "ปุ้ย", firstName: "ปรียานุช", group: "RUBY" },
  { id: 2, nickname: "เจมส์", firstName: "เจษฎา", group: "JADE" },
  { id: 3, nickname: "บีม", firstName: "ภีมพัฒน์", group: "RUBY" },
  { id: 4, nickname: "แจน", firstName: "จันทร์จิรา", group: "AMBER" },
  { id: 5, nickname: "ชาลี", firstName: "กมลชนก", group: "RUBY" },
  { id: 6, nickname: "มิว", firstName: "มิวสิกา", group: "AMBER" },
  { id: 7, nickname: "ฟ้า", firstName: "ฟ้าลดา", group: "JADE" },
  { id: 8, nickname: "เจน", firstName: "เจนจิรา", group: "AZURE" },
  { id: 9, nickname: "โอ๊ต", firstName: "ปวริศ", group: "AMBER" },
  { id: 10, nickname: "น้ำ", firstName: "น้ำทิพย์", group: "AZURE" },
  { id: 11, nickname: "ตูน", firstName: "อภิสิทธิ์", group: "JADE" },
  { id: 12, nickname: "นุ่น", firstName: "พิมพ์ชนก", group: "JADE" },
  { id: 13, nickname: "มะลิ", firstName: "ชญานี", group: "JADE" },
  { id: 14, nickname: "ภูมิ", firstName: "ภูริช", group: "AZURE" },
  { id: 15, nickname: "ฝ้าย", firstName: "วรรณพร", group: "AMBER" },
  { id: 16, nickname: "หนุ่ม", firstName: "สิทธิชัย", group: "JADE" },
  { id: 17, nickname: "ผึ้ง", firstName: "ผกายมาศ", group: "RUBY" },
  { id: 18, nickname: "ดิว", firstName: "ดวงใจ", group: "AMBER" },
  { id: 19, nickname: "พลอย", firstName: "พลอยไพลิน", group: "AZURE" },
  { id: 20, nickname: "หมวย", firstName: "ศิริพร", group: "RUBY" },
  { id: 21, nickname: "ภัทร", firstName: "ภัทรพล", group: "AMBER" },
  { id: 22, nickname: "ฝ้าย", firstName: "ฐิติมา", group: "JADE" },
  { id: 23, nickname: "ใหม่", firstName: "ไอยรา", group: "AMBER" },
  { id: 24, nickname: "กุ้ง", firstName: "ธีรเดช", group: "JADE" },
  { id: 25, nickname: "ต้น", firstName: "ต้นกล้า", group: "AZURE" },
  { id: 26, nickname: "อาร์ม", firstName: "อรรถพล", group: "RUBY" },
  { id: 27, nickname: "แก้ม", firstName: "กัญญาณัฐ", group: "AZURE" },
  { id: 28, nickname: "ซี", firstName: "ซีรีน", group: "AMBER" },
  { id: 29, nickname: "นิว", firstName: "นวพล", group: "AMBER" },
];

export const nomineeById = new Map(nominees.map((n) => [n.id, n]));

export const EVENT_TITLE = "辩论赛";
