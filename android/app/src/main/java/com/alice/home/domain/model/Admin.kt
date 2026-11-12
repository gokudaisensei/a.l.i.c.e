package com.alice.home.domain.model

/** The household's plumbing: backups, health, updates, support access and this person's own alerts. Plain data, shown in Settings. */

enum class Health { Ok, Warn, Down }

data class Backup(val id: String, val kind: String, val when_: String, val size: String, val where_: String, val verified: Boolean?, val ok: Boolean = true)

data class BackupSettings(val nightly: Boolean = true, val keep: Int = 14, val includeHa: Boolean = true)

data class HealthCheck(val label: String, val status: Health, val detail: String)

data class UpdateInfo(
    val current: String,
    /** The newer version waiting, or null when up to date. */
    val available: String? = null,
    val notes: List<String> = emptyList(),
    val signed: Boolean = true,
    val autoUpdate: Boolean = true,
    val window: String = "02:00 to 04:00",
    val scheduled: Boolean = false,
)

data class PastUpdate(val from: String, val to: String, val how: String, val ok: Boolean, val when_: String)

/** Support can only come in for a set time, with a stated scope, and can never unlock a door. */
data class SupportAccess(val endsIn: String? = null, val scope: Set<String> = emptySet())

data class Prefs(val push: Boolean = true, val quiet: Boolean = false, val quietFrom: String = "22:00", val quietTo: String = "07:00")

data class AdminState(
    val backups: List<Backup> = emptyList(),
    val backupSettings: BackupSettings = BackupSettings(),
    val checks: List<HealthCheck> = emptyList(),
    val update: UpdateInfo = UpdateInfo("1.0.0"),
    val pastUpdates: List<PastUpdate> = emptyList(),
    val support: SupportAccess = SupportAccess(),
    val prefs: Prefs = Prefs(),
    val uptime: String = "up 3 days",
) {
    val latestBackup: Backup? get() = backups.firstOrNull { it.kind == "Alice" && it.ok }
    val backupVerified: Boolean get() = latestBackup?.verified == true
    val problems: Int get() = checks.count { it.status != Health.Ok } + (if (backupVerified) 0 else 1)
}
