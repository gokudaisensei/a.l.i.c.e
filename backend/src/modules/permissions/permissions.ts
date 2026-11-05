import type { Role } from "@/core/database/schema";

/** Application permissions. Roles map to a fixed set; device-level policies refine device access. */
export const PERMISSIONS = [
  "device.view", "device.control", "device.rename", "device.manage",
  "scene.run", "scene.write", "routine.write", "automation.write",
  "mode.change",
  "activity.view", "energy.view", "history.view", "notification.receive",
  "members.view", "members.manage",
  "ha.manage", "backup.manage", "update.manage", "admin.view", "security.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MEMBER: Permission[] = [
  "device.view", "device.control", "device.rename", "scene.run", "scene.write", "routine.write", "automation.write", "mode.change",
  "activity.view", "energy.view", "history.view", "notification.receive", "members.view",
];

/** Guests get little by default; what they can see and control is an explicit allow-list (device policies). */
const GUEST: Permission[] = ["device.view", "device.control", "scene.run"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: MEMBER,
  guest: GUEST,
};

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);
