package alice.server.sync

import alice.core.db.Database
import alice.ha.ConfigJobService
import alice.server.automations.AutomationsService
import alice.server.routines.RoutinesService
import alice.server.scenes.ScenesService
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory

open class ConfigSyncService(
    private val db: Database,
    private val jobs: ConfigJobService,
    private val scenes: ScenesService,
    private val routines: RoutinesService,
    private val automations: AutomationsService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun driftedCount(householdId: String): Int =
        scenes.driftedCount(householdId) + routines.driftedCount(householdId) + automations.driftedCount(householdId)

    fun ready(householdId: String): Pair<Boolean, String?> {
        val s = jobs.status(householdId)
        if (!s.connected) return false to "Home Assistant is not connected"
        if (!s.adminTokenSet) return false to "Add a Home Assistant admin token so this can also run from Home Assistant"
        return true to null
    }

    open fun verify(householdId: String): Boolean {
        val (ok, _) = ready(householdId)
        if (!ok) return false
        val scripts = mutableListOf<kotlinx.serialization.json.JsonObject>()
        for ((objectId, cfg) in scenes.verificationScripts(householdId)) {
            scripts += buildJsonObject { put("objectId", objectId); put("config", cfg) }
        }
        for ((objectId, cfg) in routines.verificationScripts(householdId)) {
            scripts += buildJsonObject { put("objectId", objectId); put("config", cfg) }
        }
        val autos = buildJsonArray {
            for ((id, cfg, enabled) in automations.verificationAutomations(householdId)) {
                add(buildJsonObject { put("id", id); put("config", cfg); put("enabled", enabled) })
            }
        }
        if (scripts.isEmpty() && autos.isEmpty()) return false
        val payload = buildJsonObject {
            put("scripts", JsonArray(scripts))
            put("automations", autos)
        }.toString()
        jobs.enqueue(householdId, "config.verify", payload, "verify", null)
        return true
    }

    suspend fun reconcileScenes(c: alice.server.things.Caller): Int = scenes.reconcile(c)
    fun reconcileRoutines(c: alice.server.routines.Caller): Int = routines.reconcile(c)
    fun reconcileAutomations(c: alice.server.automations.Caller): Int = automations.reconcile(c)

    fun verifyAll() {
        val households = db.read { identityQueries.selectAllHouseholds().executeAsList() }
        for (h in households) {
            alice.core.concurrent.runCatchingNonCancellation { verify(h.id) }
                .onFailure { log.warn("config verification failed for household {}: {}", h.id, it.message) }
        }
    }
}
