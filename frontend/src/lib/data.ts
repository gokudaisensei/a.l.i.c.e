export type DevType = "dim" | "light" | "plug" | "fan" | "climate" | "contact" | "lock" | "camera";
export type Role = "admin" | "member" | "guest";
export type Tod = "morning" | "day" | "evening" | "night";

export interface Dev {
  id: string; n: string; r: string; t: DevType; hw: string;
  on?: boolean; v?: number; w?: number; sp?: number; tgt?: number; cur?: number;
  open?: boolean; locked?: boolean; limit?: number;
  fav?: number; voice?: number; g?: number; by?: string; at?: string;
}
export interface Person { id: string; n: string; role: Role; home: boolean; c: number; until?: string }
export interface Activity { ic: string; t: string; time: string; nw?: boolean; tone?: string }

export const ROOMS = [
  { id: "living", n: "Living room" }, { id: "kitchen", n: "Kitchen" }, { id: "bedroom", n: "Bedroom" },
  { id: "kids", n: "Arjun's room" }, { id: "bath", n: "Bathroom" }, { id: "guest", n: "Guest room" },
  { id: "hall", n: "Hall" }, { id: "garden", n: "Garden" },
];

export const initialPeople = (): Person[] => [
  { id: "gokul", n: "Gokul", role: "admin", home: true, c: 1 },
  { id: "meera", n: "Meera", role: "admin", home: true, c: 2 },
  { id: "arjun", n: "Arjun", role: "member", home: true, c: 3 },
  { id: "lakshmi", n: "Lakshmi", role: "guest", home: true, c: 4, until: "Sun 9 Nov, 11:00" },
];

export const initialDevices = (): Dev[] => [
  { id: "floor", n: "Floor lamp", r: "living", t: "dim", on: true, v: 60, hw: "Hue Bridge", fav: 1, voice: 1, g: 1 },
  { id: "ceil", n: "Ceiling lights", r: "living", t: "dim", on: false, v: 80, hw: "Hue Bridge", voice: 1, g: 1 },
  { id: "tv", n: "TV and console", r: "living", t: "plug", on: true, w: 84, hw: "Tapo plugs" },
  { id: "fan", n: "Ceiling fan", r: "living", t: "fan", on: true, sp: 2, hw: "Atomberg", voice: 1, g: 1 },
  { id: "ac", n: "Living AC", r: "living", t: "climate", on: true, tgt: 24, cur: 25.6, hw: "Daikin", fav: 1, voice: 1, g: 1 },
  { id: "balc", n: "Balcony door", r: "living", t: "contact", open: false, hw: "Aqara hub" },
  { id: "pend", n: "Pendant lights", r: "kitchen", t: "dim", on: true, v: 80, hw: "Hue Bridge", fav: 1, voice: 1 },
  { id: "strip", n: "Under-cabinet strip", r: "kitchen", t: "light", on: true, hw: "Shelly relays", voice: 1 },
  { id: "kettle", n: "Kettle", r: "kitchen", t: "plug", on: false, w: 0, hw: "Tapo plugs" },
  { id: "fridge", n: "Fridge door", r: "kitchen", t: "contact", open: false, hw: "Aqara hub" },
  { id: "bed", n: "Bedside lamps", r: "bedroom", t: "dim", on: false, v: 40, hw: "Hue Bridge", fav: 1, voice: 1 },
  { id: "bedac", n: "Bedroom AC", r: "bedroom", t: "climate", on: false, tgt: 23, cur: 27.1, hw: "Daikin", voice: 1 },
  { id: "kid", n: "Night light", r: "kids", t: "dim", on: true, v: 15, hw: "Hue Bridge", voice: 1 },
  { id: "geyser", n: "Water heater", r: "bath", t: "plug", on: true, w: 1420, limit: 1500, hw: "Tapo plugs", fav: 1 },
  { id: "glamp", n: "Guest lamp", r: "guest", t: "dim", on: false, v: 50, hw: "Hue Bridge", voice: 1, g: 1 },
  { id: "gac", n: "Guest AC", r: "guest", t: "climate", on: false, tgt: 24, cur: 26.4, hw: "Daikin", voice: 1, g: 1 },
  { id: "hall", n: "Hall lights", r: "hall", t: "light", on: true, hw: "Shelly relays", voice: 1, g: 1 },
  { id: "front", n: "Front door", r: "hall", t: "lock", locked: true, hw: "Yale locks", g: 1, by: "Meera", at: "6:43 pm" },
  { id: "bell", n: "Doorbell camera", r: "hall", t: "camera", hw: "Reolink" },
  { id: "back", n: "Back door", r: "garden", t: "lock", locked: true, hw: "Yale locks", by: "Gokul", at: "7:05 am" },
  { id: "glt", n: "Garden lights", r: "garden", t: "light", on: false, hw: "Shelly relays", voice: 1 },
  { id: "gate", n: "Gate camera", r: "garden", t: "camera", hw: "Reolink" },
  { id: "garage", n: "Garage door", r: "garden", t: "contact", open: false, hw: "Aqara hub" },
];

export const initialActivity = (): Activity[] => [
  { ic: "lock", t: "<b>Front door</b> locked by Meera", time: "6:43 pm", nw: true },
  { ic: "user", t: "<b>Meera</b> got home", time: "6:42 pm", nw: true },
  { ic: "sun", t: "<b>Evening routine</b> ran: living lights to 60%", time: "6:30 pm", nw: true },
  { ic: "bolt", t: "<b>Water heater</b> reached 95% of its power limit", time: "5:55 pm", tone: "warn", nw: true },
  { ic: "unlock", t: "<b>Lakshmi</b> (guest) unlocked the front door", time: "4:20 pm", nw: true },
  { ic: "shieldcheck", t: "<b>Backup</b> passed its restore test", time: "2:41 am" },
  { ic: "layers", t: "<b>Gokul</b> saved the automation “Lock up at night”", time: "Mon 9:05 pm" },
];

export const ENERGY = [.34, .3, .28, .27, .3, .52, .95, 1.4, .8, .5, .42, .4, .46, .5, .44, .4, .55, .9, 1.5, 2.1, 2.4, 2.0, 1.6, 1.9];

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

export const initialBackups = () => [
  { id: "b5", when: "Today, 2:30 am", size: "41.8 MB", where: "NAS", verified: true, note: "Restore test passed at 2:41 am" },
  { id: "b4", when: "Wed 4 Nov, 2:30 am", size: "41.6 MB", where: "NAS", verified: true, note: "Passed at 2:41 am" },
  { id: "b3", when: "Tue 3 Nov, 2:30 am", size: "41.1 MB", where: "NAS", verified: true, note: "Passed at 2:42 am" },
  { id: "b2", when: "Mon 2 Nov, 2:30 am", size: "40.9 MB", where: "Local disk", verified: true, note: "Passed at 2:41 am" },
] as { id: string; when: string; size: string; where: string; verified: boolean; note?: string }[];

export const initialAutos = () => [
  { id: "a1", n: "Lights on when I get home", s: "When someone gets home, if it is dark, turn on Hall lights and set Floor lamp to 70%.", on: true, last: "Yesterday, 6:42 pm" },
  { id: "a2", n: "Lock up at night", s: "When it is 10:30 pm, lock Front door and Back door.", on: true, last: "Last night, 10:30 pm" },
  { id: "a3", n: "Water heater guard", s: "When Water heater goes over its limit, send Gokul a notification.", on: true, last: "Today, 5:55 pm" },
  { id: "a4", n: "Quiet kitchen", s: "When it is 11:00 pm, turn off Under-cabinet strip.", on: false, last: "Never run" },
];

export interface BAct { v: string; t: string; n?: number }
export interface Builder {
  name: string;
  trig: { k: string; p: string | null };
  conds: { dark: boolean; home: boolean; days: string; mode: string };
  acts: BAct[];
}
export const initialBuilder = (): Builder => ({
  name: "Hall lights when I get home",
  trig: { k: "arrive", p: "anyone" },
  conds: { dark: true, home: false, days: "any", mode: "any" },
  acts: [{ v: "on", t: "hall" }, { v: "dim", t: "floor", n: 70 }],
});

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
