export type DevType = "dim" | "light" | "plug" | "fan" | "climate" | "contact" | "cover" | "lock" | "camera" | "other";
export type Role = "admin" | "member" | "guest";
/** The backend sends the role as plain text; only the three roles Alice knows are accepted. */
export const asRole = (r: string): Role => (r === "admin" || r === "member" || r === "guest" ? r : "guest");
export type Tod = "morning" | "day" | "evening" | "night";

export interface Dev {
  id: string; n: string; r: string; t: DevType; hw: string;
  on?: boolean; v?: number; w?: number; sp?: number; tgt?: number; cur?: number;
  /** Covers: position 0 closed – 100 open, and whether it is moving. */
  /** Fan: speed %, oscillation, preset and the presets on offer, speed step. */
  pct?: number; osc?: boolean; fp?: string; fpresets?: string[]; fstep?: number;
  /** Climate: mode, modes on offer, target range and step. */
  hm?: string; hmodes?: string[]; tmin?: number; tmax?: number; tstep?: number;
  pos?: number; mv?: "opening" | "closing";
  open?: boolean; locked?: boolean; limit?: number;
  /** Lamp colour (RGB), colour temperature (K) and its range, and which of the two is showing. */
  rgb?: number[]; k?: number; kmin?: number; kmax?: number; cm?: "color" | "white";
  /** For `other`: icon and plain-language kind ("Media player"). */
  ic?: string; kind?: string;
  /** The Home Assistant entity id behind this device (automations are written in terms of it). */
  ent?: string;
  /** What the device can be told to do (operation names). Unset for sample devices. */
  ops?: string[];
  fav?: number; voice?: number; g?: number; by?: string; at?: string;
}
export interface Person { id: string; n: string; role: Role; home: boolean; c: number; until?: string; /** Tied to a Home Assistant person, so Alice can tell when they are home. */ linked?: boolean }
export interface Activity { ic: string; t: string; time: string; nw?: boolean; tone?: string }

export const ROOMS: { id: string; n: string }[] = [];




export const ENERGY: number[] = [];

export const MODES = [
  { k: "Home", ic: "home", d: "Everyone is in" },
  { k: "Away", ic: "exit", d: "Nobody home, doors locked" },
  { k: "Night", ic: "moon", d: "Quiet hours, dim lights" },
  { k: "Vacation", ic: "bag", d: "Away for days, extra watchful" },
];

export const NAV = [
  { k: "home", n: "Home", ic: "home", href: "/" },
  { k: "rooms", n: "Rooms", ic: "grid", href: "/rooms" },
  { k: "build", n: "Automate", ic: "flow", href: "/automate", roles: ["admin", "member"] },
  { k: "admin", n: "Admin", ic: "shield", href: "/admin", roles: ["admin"] },
] as const;

export const PRIMARY: Record<Tod, string> = { morning: "morning", day: "leaving", evening: "movie", night: "night" };
export const CLOCK: Record<Tod, string> = { morning: "7:10 am", day: "2:20 pm", evening: "7:45 pm", night: "10:40 pm" };
export const W = ["No", "One", "Two", "Three", "Four", "Five"];


export interface BAct { v: string; t: string; n?: number }
export interface Builder {
  /** What is being built. Scenes and routines have no trigger or conditions. */
  kind?: "automation" | "scene" | "routine";
  /** Set when editing something already saved. */
  editId?: string;
  name: string;
  trig: { k: string; p: string | null };
  conds: { dark: boolean; home: boolean; days: string; mode: string };
  acts: BAct[];
}

export const TRIG = [
  { k: "arrive", n: "Someone gets home", ic: "home", p: "person" },
  { k: "leave", n: "Everyone leaves", ic: "exit" },
  { k: "time", n: "At a set time", ic: "clock", p: "time" },
  { k: "sunset", n: "At sunset", ic: "sun" },
  { k: "door", n: "A door opens", ic: "door", p: "contact" },
  { k: "motion", n: "Motion is seen", ic: "pulse", p: "room" },
  { k: "power", n: "A plug goes over its limit", ic: "bolt", p: "plug" },
] as { k: string; n: string; ic: string; p?: string }[];

export const TDEF: Record<string, string | null> = {
  arrive: "anyone", leave: null, time: "18:30", sunset: null, door: "garage", motion: "hall", power: "geyser",
};

export interface Auto { id: string; n: string; s: string; on: boolean; last: string; sync?: string }
