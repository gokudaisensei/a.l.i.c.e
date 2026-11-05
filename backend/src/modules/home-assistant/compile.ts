import type { ActionSpec, RoutineStep } from "@/core/database/schema";
import { resolveOperation } from "./capabilities/capability-detector";
import { type HaAction, MODE_HELPER_ENTITY, type ScriptConfig } from "./config-ops";

/**
 * Turns Alice's saved scenes and routines into Home Assistant scripts, so they also run from HA (a dashboard button, an
 * automation, a voice command) while Alice is down. Pure functions: the config-worker applies the result.
 */
const suffix = (id: string) => id.slice(id.indexOf("_") + 1).toLowerCase();

export const sceneObjectId = (sceneId: string) => `alice_scene_${suffix(sceneId)}`;
export const routineObjectId = (routineId: string) => `alice_routine_${suffix(routineId)}`;
export const automationConfigId = (automationId: string) => `alice_auto_${suffix(automationId)}`;

/** The scene or routine id back from a script object id, for matching finished jobs to their owner. */
export function ownerOfScript(objectId: string): { kind: "scene" | "routine"; id: string } | null {
  const m = /^alice_(scene|routine)_([a-z0-9]+)$/.exec(objectId);
  return m ? { kind: m[1] as "scene" | "routine", id: `${m[1] === "scene" ? "scn" : "rtn"}_${m[2]!.toUpperCase()}` } : null;
}

export function compileDeviceAction(a: ActionSpec, continueOnError = false): HaAction {
  const domain = a.entityId.split(".")[0] ?? "";
  const call = resolveOperation(domain, a.action, a.parameters ?? {});
  if (!call) throw new Error(`No Home Assistant service for "${a.action}" on ${domain}`);
  return { service: `${call.domain}.${call.service}`, target: { entity_id: a.entityId }, ...(Object.keys(call.data).length ? { data: call.data } : {}), ...(continueOnError ? { continue_on_error: true } : {}) };
}

export function compileScene(scene: { id: string; name: string; description?: string | null; icon?: string | null; actions: ActionSpec[] }): { objectId: string; config: ScriptConfig } {
  return {
    objectId: sceneObjectId(scene.id),
    config: {
      alias: `Alice scene: ${scene.name}`, ...(scene.description ? { description: scene.description } : {}), ...(scene.icon ? { icon: `mdi:${scene.icon}` } : {}), mode: "single",
      // A scene changes everything at once; one failing device must not stop the rest.
      sequence: [{ parallel: scene.actions.map((a) => compileDeviceAction(a, true)) }],
    },
  };
}

export function compileRoutine(routine: { id: string; name: string; icon?: string | null; steps: RoutineStep[]; onFailure: "continue" | "stop" }): { objectId: string; config: ScriptConfig } {
  const keepGoing = routine.onFailure === "continue";
  const sequence: HaAction[] = routine.steps.map((s) => {
    switch (s.type) {
      case "device": return compileDeviceAction(s, keepGoing);
      case "scene": return { service: `script.${sceneObjectId(s.sceneId)}`, ...(keepGoing ? { continue_on_error: true } : {}) };
      case "mode": return { service: "input_select.select_option", target: { entity_id: MODE_HELPER_ENTITY }, data: { option: s.mode } };
      case "delay": return { delay: { seconds: s.seconds } };
    }
  });
  return { objectId: routineObjectId(routine.id), config: { alias: `Alice routine: ${routine.name}`, ...(routine.icon ? { icon: `mdi:${routine.icon}` } : {}), mode: "single", sequence } };
}
