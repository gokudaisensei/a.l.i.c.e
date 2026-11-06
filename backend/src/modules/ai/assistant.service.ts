import type { Caller, DevicesService } from "../devices/devices.service";
import type { RoutinesService } from "../routines/routines.service";
import type { ScenesService } from "../scenes/scenes.service";
import { type AssistantContext, interpret, type Suggestion } from "./assistant";
import type { Interpreter } from "./llm";

/** At most this many sentences per person per minute go to the model; beyond that only the rules answer. */
export const MODEL_CALLS_PER_MINUTE = 6;

/** Reads a sentence against what this person may see and control. */
export class AssistantService {
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly devices: DevicesService, private readonly scenes: ScenesService, private readonly routines: RoutinesService, private readonly model: Interpreter | null = null, private readonly onModelError: (e: unknown) => void = () => {}, private readonly now: () => number = Date.now) {}

  private allowModel(userId: string): boolean {
    const t = this.now();
    const hits = (this.recent.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (hits.length >= MODEL_CALLS_PER_MINUTE) { this.recent.set(userId, hits); return false; }
    hits.push(t); this.recent.set(userId, hits);
    return true;
  }

  context(c: Caller): AssistantContext {
    const list = this.devices.list(c).filter((d) => d.primary && !d.hidden && d.available);
    return {
      devices: list.map((d) => ({ id: d.id, name: d.name, areaId: d.areaId, domain: d.primary!.domain, manufacturer: d.manufacturer, ops: d.primary!.capabilities.flatMap((x) => x.operations ?? []) })),
      areas: this.devices.areas(c).map((a) => ({ id: a.id, name: a.name })),
      scenes: this.scenes.list(c).map((s) => ({ id: s.id, name: s.name, description: s.description })),
      routines: c.role === "guest" ? [] : this.routines.list(c).map((r) => ({ id: r.id, name: r.name })),
      modes: c.role === "guest" ? [] : ["home", "away", "night", "vacation"],
    };
  }

  /** The rules first (fast, private). Only when they find nothing, and a model is configured, the model is asked. */
  async interpret(c: Caller, text: string): Promise<Suggestion[]> {
    const ctx = this.context(c);
    const found = interpret(text.slice(0, 200), ctx).slice(0, 8);
    if (found.length || !this.model || !text.trim() || text.trim().length < 4 || !this.allowModel(c.userId)) return found;
    try { return (await this.model.interpret(text.slice(0, 200), ctx)).slice(0, 3); } catch (e) { this.onModelError(e); return found; }
  }
}
