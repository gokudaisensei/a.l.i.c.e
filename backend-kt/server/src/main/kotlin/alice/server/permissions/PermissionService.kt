package alice.server.permissions

import kotlinx.serialization.Serializable
import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.households.HouseholdService
import alice.server.households.Role
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

data class NewDevicePolicy(
    val connectionId: String,
    val entityId: String,
    val subjectType: String,
    val subjectId: String,
    val effect: String,
    val operations: List<String>? = null,
)

data class SensitiveRule(
    val domain: String,
    val action: String,
    val deviceClass: String = "",
    val sensitive: Boolean,
)

@Serializable
data class EffectiveSensitivityRule(
    val domain: String,
    val action: String,
    val deviceClass: String,
    val sensitive: Boolean,
    val source: String,
)

class PermissionService(
    private val database: Database,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val json: Json,
) {
    private val ENTITY_TARGET = Regex("^[A-Za-z0-9_.:-]+$")
    private val OPERATION = Regex("^[a-z_]+$")

    fun listPolicies(householdId: String): List<DevicePolicyRow> =
        database.read { identityQueries.selectDevicePoliciesByHousehold(householdId).executeAsList() }
            .map { row ->
                DevicePolicyRow(
                    id = row.id,
                    householdId = row.household_id,
                    connectionId = row.connection_id,
                    entityId = row.entity_id,
                    subjectType = row.subject_type,
                    subjectId = row.subject_id,
                    effect = row.effect,
                    operations = row.operations?.let { json.decodeFromString(ListSerializer(String.serializer()), it) },
                )
            }

    fun createPolicy(householdId: String, actorId: String, p: NewDevicePolicy): DevicePolicyRow {
        if (p.connectionId != alice.ha.Connections.DEFAULT_ID) throw validationError("Unknown connection")
        if (p.subjectType == "role" && Role.entries.none { it.wire == p.subjectId }) {
            throw AppException(ErrorCode.VALIDATION_ERROR, "Unknown role", 400)
        }
        if (p.effect !in listOf("allow", "deny")) throw validationError("effect must be allow or deny")
        if (p.subjectType !in listOf("role", "member")) throw validationError("subjectType must be role or member")
        if (p.subjectType == "member" && households.listMembers(householdId).none { it.userId == p.subjectId && !it.expired }) {
            throw validationError("That person is not in this home")
        }
        if (p.entityId.isBlank() || p.entityId.length > 200 || !ENTITY_TARGET.matches(p.entityId)) {
            throw validationError("Choose a valid device or entity id")
        }
        val operations = p.operations?.takeIf { it.isNotEmpty() }
        if (operations != null) {
            if (operations.size > 50) throw validationError("At most 50 operations per policy")
            if (operations.any { it.isBlank() || it.length > 64 || !OPERATION.matches(it) }) {
                throw validationError("Operations must be lower-case names of at most 64 characters")
            }
            if (operations.toSet().size != operations.size) throw validationError("An operation is listed twice")
        }
        val id = Ids.next("pol")
        val now = time.now()
        val operationsJson = operations?.let { json.encodeToString(ListSerializer(String.serializer()), it) }
        database.write {
            identityQueries.insertDevicePolicy(
                id = id,
                household_id = householdId,
                connection_id = p.connectionId,
                entity_id = p.entityId,
                subject_type = p.subjectType,
                subject_id = p.subjectId,
                effect = p.effect,
                operations = operationsJson,
                created_by = actorId,
                created_at = now,
            )
            Audit.write(this, action = "permissions.policy_created", householdId = householdId, actorId = actorId, resource = id, now = now)
        }
        return listPolicies(householdId).first { it.id == id }
    }

    fun deletePolicy(householdId: String, actorId: String, id: String) {
        database.write {
            val c = identityQueries.deleteDevicePolicy(id, householdId).value
            if (c == 0L) throw notFound("Policy")
            Audit.write(this, action = "permissions.policy_deleted", householdId = householdId, actorId = actorId, resource = id, now = time.now())
        }
    }

    // ---- sensitive operations ----

    private fun customRules(householdId: String): List<alice.core.db.Sensitive_operation_rules> =
        database.read { identityQueries.selectSensitiveRulesByHousehold(householdId).executeAsList() }

    fun effectiveSensitivity(householdId: String): List<EffectiveSensitivityRule> {
        val custom = customRules(householdId)
        val overridden = custom.map { "${it.domain}|${it.action}|${it.device_class}" }.toSet()
        val defaults = defaultSensitivityRules().filter { d ->
            "${d.domain}|${d.action}|${d.deviceClass}" !in overridden
        }.map { EffectiveSensitivityRule(it.domain, it.action, it.deviceClass, it.sensitive, "default") }
        val customs = custom.map { EffectiveSensitivityRule(it.domain, it.action, it.device_class, it.sensitive == 1L, "custom") }
        return defaults + customs
    }

    fun replaceSensitivityRules(householdId: String, actorId: String, rules: List<SensitiveRule>): ReplaceResult {
        val clean = rules.map { SensitiveRule(it.domain.trim().lowercase(), it.action.trim().lowercase(), it.deviceClass.trim().lowercase(), it.sensitive) }
        if (clean.any { it.domain.isBlank() || it.action.isBlank() }) {
            throw validationError("Each rule needs a domain and an action")
        }
        val seen = mutableSetOf<String>()
        for (r in clean) {
            val k = "${r.domain}|${r.action}|${r.deviceClass}"
            if (k in seen) throw validationError("Duplicate rule for ${r.domain}.${r.action}")
            seen.add(k)
        }
        val now = time.now()
        database.write {
            identityQueries.deleteSensitiveRulesByHousehold(householdId)
            for (r in clean) {
                identityQueries.insertSensitiveRule(
                    id = Ids.next("sen"),
                    household_id = householdId,
                    domain = r.domain,
                    action = r.action,
                    device_class = r.deviceClass,
                    sensitive = if (r.sensitive) 1 else 0,
                    updated_by = actorId,
                    updated_at = now,
                )
            }
            Audit.write(this, action = "security.sensitive_operations_changed", householdId = householdId, actorId = actorId, now = now)
        }
        // Every default rule is sensitive; report the defaults a household rule has switched off.
        val defaultsSwitchedOff = defaultSensitivityRules()
            .filter { d -> clean.find { it.domain == d.domain && it.action == d.action && it.deviceClass == d.deviceClass }?.sensitive != true }
            .map { "${it.domain}.${it.action}" }
        return ReplaceResult(effectiveSensitivity(householdId), defaultsSwitchedOff.distinct())
    }

    fun deleteSensitivityRule(householdId: String, actorId: String, id: String) {
        database.write {
            val c = identityQueries.deleteSensitiveRule(id, householdId).value
            if (c == 0L) throw notFound("Rule")
            Audit.write(this, action = "security.sensitive_rule_removed", householdId = householdId, actorId = actorId, resource = id, now = time.now())
        }
    }

    /** Whether an operation needs a fresh passkey for this household: its own rules first, then the defaults. */
    fun sensitivityPolicy(): SensitivityCheck = { householdId, domain, action, deviceClass ->
        val rules = customRules(householdId).map { SensitiveRule(it.domain, it.action, it.device_class, it.sensitive == 1L) }
        resolveSensitivity(rules, domain, action, deviceClass)
    }
}

/** Decides whether `domain.action` (optionally for a device class) needs a fresh passkey in a household. */
typealias SensitivityCheck = (householdId: String, domain: String, action: String, deviceClass: String?) -> Boolean

/** The code defaults only, with no household rules; used where no [PermissionService] is wired. */
val defaultSensitivityCheck: SensitivityCheck = { _, domain, action, deviceClass ->
    resolveSensitivity(emptyList(), domain, action, deviceClass)
}

// ---- default sensitivity rules (mirrors backend/src/modules/devices/commands/sensitivity.ts) ----

data class DefaultSensitivityRule(val domain: String, val action: String, val deviceClass: String, val sensitive: Boolean)

/** Same as the TypeScript backend: only unlocking and opening a lock need a fresh passkey. Locking never does. */
fun defaultSensitivityRules(): List<DefaultSensitivityRule> = listOf(
    DefaultSensitivityRule("lock", "unlock", "", true),
    DefaultSensitivityRule("lock", "open", "", true),
)

/** The most specific matching rule wins (a device-class match beats "any"); household rules beat the defaults. */
fun resolveSensitivity(rules: List<SensitiveRule>, domain: String, action: String, deviceClass: String?): Boolean {
    val d = domain.lowercase()
    val a = action.lowercase()
    val dc = (deviceClass ?: "").lowercase()
    fun pick(list: List<SensitiveRule>): SensitiveRule? {
        val hits = list.filter { it.domain == d && it.action == a && (it.deviceClass == "" || it.deviceClass == dc) }
        return hits.firstOrNull { it.deviceClass != "" } ?: hits.firstOrNull()
    }
    val defaults = defaultSensitivityRules().map { SensitiveRule(it.domain, it.action, it.deviceClass, it.sensitive) }
    return (pick(rules) ?: pick(defaults))?.sensitive ?: false
}

@Serializable
data class ReplaceResult(val rules: List<EffectiveSensitivityRule>, val defaultsSwitchedOff: List<String>)
