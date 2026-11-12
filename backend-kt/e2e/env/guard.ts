// R10 guard: before any command that starts, stops or removes a container, print it and prove it names
// only alice-parity-* resources. Never touches the user's containers (alice-ha, alice-ha-mock, ...).
import { PROJECT } from "./constants.ts";

export function guardContainerNames(description: string, names: string[]): void {
  const bad = names.filter((n) => !n.startsWith(`${PROJECT}-`));
  if (bad.length > 0) {
    throw new Error(`R10 guard: refusing "${description}" because it names non-parity containers: ${bad.join(", ")}`);
  }
  console.log(`[R10] ${description} -> ${names.join(", ")}`);
}

/** Guard a docker compose invocation: project must be alice-parity. */
export function guardCompose(description: string, args: string[]): void {
  const p = args.indexOf("-p");
  const project = p >= 0 ? args[p + 1] : undefined;
  if (project !== PROJECT) {
    throw new Error(`R10 guard: compose command "${description}" is not project ${PROJECT}`);
  }
  console.log(`[R10] ${description}: docker compose ${args.join(" ")}`);
}

/** Guard a direct container action (stop/start/rm) for one exact parity name. */
export function guardSingleContainer(action: string, name: string): void {
  guardContainerNames(`${action} ${name}`, [name]);
}
