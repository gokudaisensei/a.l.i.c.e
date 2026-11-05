/** "turned off", "set to 70%": how an operation reads in the timeline, in the past tense. */
export function describeDoneAction(action: string, parameters: Record<string, unknown> = {}, device: string): string {
  const p = parameters;
  const simple: Record<string, string> = {
    turn_on: `turned on ${device}`, turn_off: `turned off ${device}`, toggle: `toggled ${device}`, lock: `locked ${device}`, unlock: `unlocked ${device}`,
    open: `opened ${device}`, close: `closed ${device}`, stop: `stopped ${device}`, activate: `activated ${device}`, run: `ran ${device}`,
  };
  if (simple[action]) return simple[action]!;
  switch (action) {
    case "set_brightness": return `set ${device} to ${p.brightness_pct}%`;
    case "set_temperature": return `set ${device} to ${p.temperature}°`;
    case "set_position": return `set ${device} to ${p.position}%`;
    case "set_speed": return `set ${device} speed to ${p.percentage}%`;
    case "set_hvac_mode": return `set ${device} to ${p.hvac_mode}`;
    case "set_value": return `set ${device} to ${p.value}`;
    default: return `${action.replace(/_/g, " ")} ${device}`;
  }
}
