import type { Lang } from "../config";

export type SpiritKind = "fox" | "wolf" | "serpent" | "stag" | "owl" | "lynx" | "panther" | "phoenix";
export type Rarity = 1 | 2 | 3 | 4;

/** Role colours for each spirit's art: body, far side, highlight, accent, eye, plate glow. */
export interface SpiritPalette {
  b: string;
  s: string;
  h: string;
  a: string;
  e: string;
  glow: string;
}

export interface Spirit {
  kind: SpiritKind;
  rarity: Rarity;
  palette: SpiritPalette;
  name: Record<Lang, string>;
  element: Record<Lang, string>;
}

export const RARITY: Record<Lang, Record<Rarity, string>> = {
  vi: { 1: "Thường", 2: "Hiếm", 3: "Sử thi", 4: "Huyền thoại" },
  en: { 1: "Common", 2: "Rare", 3: "Epic", 4: "Legendary" },
};

export const SPIRITS: Spirit[] = [
  {
    kind: "fox",
    rarity: 2,
    palette: { b: "#ff6a1a", s: "#a8320a", h: "#ff9a4d", a: "#ffc23d", e: "#fff3c4", glow: "#ff6900" },
    name: { vi: "Cửu vĩ hồ", en: "Flame fox" },
    element: { vi: "Hỏa", en: "Flame" },
  },
  {
    kind: "wolf",
    rarity: 3,
    palette: { b: "#5b3fe0", s: "#26176e", h: "#7f68ff", a: "#7ff7ff", e: "#7ff7ff", glow: "#6d4aff" },
    name: { vi: "Phong lang", en: "Storm wolf" },
    element: { vi: "Phong", en: "Storm" },
  },
  {
    kind: "serpent",
    rarity: 2,
    palette: { b: "#13a59c", s: "#0a5560", h: "#4fd2c4", a: "#d8f998", e: "#d8f998", glow: "#14a09b" },
    name: { vi: "Thủy xà", en: "Tide serpent" },
    element: { vi: "Thủy", en: "Tide" },
  },
  {
    kind: "stag",
    rarity: 1,
    palette: { b: "#5f9a22", s: "#2c4f10", h: "#86c23e", a: "#d8f998", e: "#ffd23f", glow: "#7cb82f" },
    name: { vi: "Mộc lộc", en: "Thorn stag" },
    element: { vi: "Mộc", en: "Thorn" },
  },
  {
    kind: "owl",
    rarity: 1,
    palette: { b: "#3d8fe0", s: "#173f73", h: "#8fd0ff", a: "#c8f1ff", e: "#e3fbff", glow: "#5bb8ff" },
    name: { vi: "Băng cú", en: "Frost owl" },
    element: { vi: "Băng", en: "Frost" },
  },
  {
    kind: "lynx",
    rarity: 2,
    palette: { b: "#f0b101", s: "#8a6200", h: "#ffd75a", a: "#3df5ff", e: "#3df5ff", glow: "#f0b101" },
    name: { vi: "Lôi miêu", en: "Volt lynx" },
    element: { vi: "Lôi", en: "Volt" },
  },
  {
    kind: "panther",
    rarity: 3,
    palette: { b: "#2b2140", s: "#120c1c", h: "#4a3a66", a: "#ff2e63", e: "#ff2e63", glow: "#8a2b6b" },
    name: { vi: "Ảnh báo", en: "Umbra panther" },
    element: { vi: "Ảnh", en: "Shadow" },
  },
  {
    kind: "phoenix",
    rarity: 4,
    palette: { b: "#ff8a00", s: "#b03a00", h: "#ffb84d", a: "#ffd23f", e: "#fff6c4", glow: "#ffb020" },
    name: { vi: "Nhật phượng", en: "Sunrise phoenix" },
    element: { vi: "Nhật", en: "Sun" },
  },
];
