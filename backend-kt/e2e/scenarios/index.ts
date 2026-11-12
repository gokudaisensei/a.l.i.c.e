// Card registry for the M2 areas. Add a new `<area>.ts` here as each milestone lands.
import { matchesCardFilter } from "../lib/ids.ts";
import type { CardDef } from "../lib/scenario.ts";
import { authCards } from "./auth.ts";
import { hhCards } from "./hh.ts";
import { xCards } from "./x.ts";
import { haCards } from "./ha.ts";
import { devCards } from "./dev.ts";
import { favCards } from "./fav.ts";
import { cmdCards } from "./cmd.ts";
import { wsCards } from "./ws.ts";
import { noteCards } from "./note.ts";
import { histCards } from "./hist.ts";
import { autCards } from "./aut.ts";
import { aiCards } from "./ai.ts";
import { admCards } from "./adm.ts";
import { chCards } from "./ch.ts";

export const allCards: CardDef[] = [...authCards, ...hhCards, ...xCards, ...haCards, ...devCards, ...favCards, ...cmdCards, ...wsCards, ...noteCards, ...histCards, ...autCards, ...aiCards, ...admCards, ...chCards];

/** `--area AUTH` plus `--only E2E-AUTH-01,E2E-HH-*` selection. */
export function selectCards(area: string | null | undefined, only: string[] | null | undefined): CardDef[] {
  const wantedArea = (area ?? "").toUpperCase();
  return allCards.filter((card) => {
    if (wantedArea && card.area !== wantedArea) return false;
    if (only && only.length && !matchesCardFilter(card.id, only)) return false;
    return true;
  });
}
