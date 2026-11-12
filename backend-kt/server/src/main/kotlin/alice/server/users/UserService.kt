package alice.server.users

import alice.core.db.Database
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.time.TimeProvider
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

data class UserView(val id: String, val displayName: String, val avatarColor: Long, val locale: String)

@Serializable
data class QuietHours(val enabled: Boolean, val from: String? = null, val to: String? = null)

@Serializable
data class UserPreferencesView(val quietHours: QuietHours? = null, val pushEnabled: Boolean = true, val extra: JsonObject? = null)

class UserService(
    private val database: Database,
    private val time: TimeProvider? = null,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false },
) {
    fun get(userId: String): UserView {
        val u = database.read { identityQueries.selectUserById(userId).executeAsOneOrNull() } ?: throw notFound("User")
        return UserView(u.id, u.display_name, u.avatar_color, u.locale)
    }

    fun update(userId: String, displayName: String?, avatarColor: Long?, locale: String?): UserView {
        database.read { identityQueries.selectUserById(userId).executeAsOneOrNull() } ?: throw notFound("User")
        val name = displayName?.trim()
        if (name != null && (name.length < 1 || name.length > 60)) throw validationError("Name must be 1 to 60 characters")
        if (avatarColor != null && (avatarColor < 1 || avatarColor > 12)) throw validationError("avatarColor must be 1-12")
        database.write {
            if (name != null) identityQueries.updateUserDisplayName(name, userId)
            if (avatarColor != null) identityQueries.updateUserAvatarColor(avatarColor, userId)
            if (locale != null) identityQueries.updateUserLocale(locale, userId)
        }
        return get(userId)
    }

    fun getPreferences(userId: String): UserPreferencesView {
        database.read { identityQueries.selectUserById(userId).executeAsOneOrNull() } ?: throw notFound("User")
        val p = database.read { identityQueries.selectUserPreferences(userId).executeAsOneOrNull() }
        if (p == null) {
            database.write { identityQueries.insertUserPreferences(userId) }
            return UserPreferencesView()
        }
        val quiet = p.quiet_hours?.let { runCatching { json.decodeFromString<QuietHours>(it) }.getOrNull() }
        val extra = p.extra?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
        return UserPreferencesView(quiet, p.push_enabled != 0L, extra)
    }

    fun updatePreferences(userId: String, quietHours: QuietHours?, quietHoursProvided: Boolean, pushEnabled: Boolean?, extra: JsonObject?, extraProvided: Boolean): UserPreferencesView {
        val cur = getPreferences(userId)
        val q = if (quietHoursProvided) quietHours else cur.quietHours
        val pe = pushEnabled ?: cur.pushEnabled
        val ex = if (extraProvided) extra else cur.extra
        database.write {
            identityQueries.updateUserPreferences(userId, q?.let { json.encodeToString(it) }, if (pe) 1L else 0L, ex?.let { json.encodeToString(it) })
        }
        return getPreferences(userId)
    }
}
