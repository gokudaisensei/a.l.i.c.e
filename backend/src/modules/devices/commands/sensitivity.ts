/** Which device operations need a fresh passkey step-up. */
export interface SensitivityPolicy {
  isSensitive(q: { householdId: string; domain: string; action: string; deviceClass: string | null }): boolean | Promise<boolean>;
}

export interface SensitivityRule {
  domain: string;
  action: string;
  /** Empty string matches any device class. */
  deviceClass: string;
  sensitive: boolean;
}

/** Code defaults; an admin can add rules on top, including turning these off. */
export const DEFAULT_SENSITIVITY_RULES: readonly SensitivityRule[] = [
  { domain: "lock", action: "unlock", deviceClass: "", sensitive: true },
  { domain: "lock", action: "open", deviceClass: "", sensitive: true },
];

/** The most specific matching rule wins (a device_class match beats "any"); household rules beat defaults. */
export function resolveSensitivity(custom: readonly SensitivityRule[], domain: string, action: string, deviceClass: string | null): boolean {
  const pick = (rules: readonly SensitivityRule[]) => {
    const hits = rules.filter((r) => r.domain === domain && r.action === action && (r.deviceClass === "" || r.deviceClass === (deviceClass ?? "")));
    return hits.find((r) => r.deviceClass !== "") ?? hits[0];
  };
  return (pick(custom) ?? pick(DEFAULT_SENSITIVITY_RULES))?.sensitive ?? false;
}

export const defaultSensitivity: SensitivityPolicy = {
  isSensitive: ({ domain, action, deviceClass }) => resolveSensitivity([], domain, action, deviceClass),
};
