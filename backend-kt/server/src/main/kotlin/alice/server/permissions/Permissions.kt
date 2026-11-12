package alice.server.permissions

import alice.server.households.Role

/** Application permissions. Roles map to a fixed set; device-level policies refine device access. */
enum class Permission(val wire: String) {
    DEVICE_VIEW("device.view"),
    DEVICE_CONTROL("device.control"),
    DEVICE_RENAME("device.rename"),
    DEVICE_MANAGE("device.manage"),
    SCENE_RUN("scene.run"),
    SCENE_WRITE("scene.write"),
    GROUP_WRITE("group.write"),
    ROUTINE_RUN("routine.run"),
    ROUTINE_WRITE("routine.write"),
    AUTOMATION_WRITE("automation.write"),
    MODE_CHANGE("mode.change"),
    ACTIVITY_VIEW("activity.view"),
    ENERGY_VIEW("energy.view"),
    HISTORY_VIEW("history.view"),
    NOTIFICATION_RECEIVE("notification.receive"),
    MEMBERS_VIEW("members.view"),
    MEMBERS_MANAGE("members.manage"),
    HA_MANAGE("ha.manage"),
    BACKUP_MANAGE("backup.manage"),
    UPDATE_MANAGE("update.manage"),
    ADMIN_VIEW("admin.view"),
    SECURITY_MANAGE("security.manage"),
    ;

    companion object {
        fun fromWire(value: String): Permission? = entries.firstOrNull { it.wire == value }
    }
}

val MEMBER_PERMISSIONS: Set<Permission> = setOf(
    Permission.DEVICE_VIEW, Permission.DEVICE_CONTROL, Permission.DEVICE_RENAME,
    Permission.SCENE_RUN, Permission.SCENE_WRITE, Permission.GROUP_WRITE,
    Permission.ROUTINE_RUN, Permission.ROUTINE_WRITE, Permission.AUTOMATION_WRITE,
    Permission.MODE_CHANGE, Permission.ACTIVITY_VIEW, Permission.ENERGY_VIEW,
    Permission.HISTORY_VIEW, Permission.NOTIFICATION_RECEIVE, Permission.MEMBERS_VIEW,
)

val GUEST_PERMISSIONS: Set<Permission> = setOf(
    Permission.DEVICE_VIEW, Permission.DEVICE_CONTROL, Permission.SCENE_RUN,
)

fun permissionsFor(role: Role): Set<Permission> = when (role) {
    Role.ADMIN -> Permission.entries.toSet()
    Role.MEMBER -> MEMBER_PERMISSIONS
    Role.GUEST -> GUEST_PERMISSIONS
}

fun can(role: Role, permission: Permission): Boolean = permission in permissionsFor(role)

fun can(role: Role, permissionWire: String): Boolean {
    val p = Permission.fromWire(permissionWire) ?: return false
    return can(role, p)
}
