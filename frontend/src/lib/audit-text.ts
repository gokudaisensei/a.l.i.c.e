/** The audit log in plain sentences. Unknown actions fall back to the action name with spaces. */
const TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  "auth.first_user_registered": () => "set up this home",
  "auth.user_joined": () => "joined the home",
  "auth.passkey_added": () => "added a passkey",
  "auth.passkey_removed": () => "removed a passkey",
  "auth.recovery_codes_regenerated": () => "made new recovery codes",
  "auth.recovery_used": () => "signed in with a recovery code",
  "auth.step_up": () => "confirmed with a passkey",
  "automations.created": () => "saved an automation",
  "automations.updated": (d) => (d.enabled === false ? "paused an automation" : d.enabled === true ? "turned an automation on" : "changed an automation"),
  "automations.deleted": () => "removed an automation",
  "scenes.created": () => "saved a scene", "scenes.updated": () => "changed a scene", "scenes.deleted": () => "removed a scene", "scenes.activated": () => "ran a scene",
  "routines.created": () => "saved a routine", "routines.updated": () => "changed a routine", "routines.deleted": () => "removed a routine", "routines.executed": () => "ran a routine",
  "groups.created": () => "made a group", "groups.updated": () => "changed a group", "groups.deleted": () => "removed a group",
  "backup.created": (d) => `made a ${d.kind === "ha" ? "Home Assistant " : ""}backup`,
  "backup.deleted": () => "deleted a backup",
  "backup.downloaded": () => "downloaded a backup",
  "backup.restore_staged": () => "set up a restore of Alice's data for the next start",
  "backup.ha_restore_requested": () => "asked Home Assistant to restore a backup",
  "backup.ha_restore_done": () => "restored Home Assistant from a backup",
  "backup.settings": () => "changed the backup settings",
  "devices.merged": () => "merged devices", "devices.split": () => "split a device", "devices.hidden": () => "hid a device", "devices.unhidden": () => "showed a device again",
  "devices.entity_overridden": () => "changed what a device part is for", "devices.settings_changed": () => "changed a device's settings",
  "ha.admin_token_set": () => "gave Alice an administrator token for Home Assistant",
  "ha.connection_saved": () => "connected Home Assistant", "ha.connection_removed": () => "disconnected Home Assistant",
  "household.invitation_created": (d) => `invited a ${d.role === "guest" ? "guest" : "member"}`,
  "household.invitation_revoked": () => "cancelled an invitation",
  "household.member_removed": () => "removed a member",
  "household.member_updated": (d) => (d.role ? `made someone ${d.role === "admin" ? "an admin" : "a " + d.role}` : "changed a member"),
  "household.mode_changed": (d) => `switched from ${String(d.from ?? "one")} to ${String(d.to ?? "another")} mode`,
  "household.person_linked": () => "linked a member to a phone",
  "household.updated": () => "changed the household's details",
  "permissions.policy_created": () => "changed who can use a device", "permissions.policy_deleted": () => "removed a device rule",
  "security.sensitive_operations_changed": () => "changed which actions need a passkey", "security.sensitive_rule_removed": () => "removed a passkey rule",
  "support.granted": (d) => `let support in for ${d.hours} hour${d.hours === 1 ? "" : "s"}`,
  "support.extended": () => "gave support another hour", "support.ended": () => "ended support access", "support.expired": () => "support access ended on its own",
  "support.operator_action": () => "support looked at something that was allowed",
  "update.requested": () => "asked for an update", "update.auto_scheduled": () => "scheduled an update", "update.emergency": () => "started an emergency update",
  "update.installing": () => "started installing an update", "update.done": () => "finished an update", "update.failed": () => "an update failed",
  "update.cancelled": () => "cancelled an update", "update.rolled_back": () => "rolled back an update", "update.settings": () => "changed the update settings",
};

export function auditSentence(action: string, detail: Record<string, unknown> | null): string {
  const f = TEXT[action];
  if (f) return f(detail ?? {});
  return action.replace(/[._]/g, " ");
}
