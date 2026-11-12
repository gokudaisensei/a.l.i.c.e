package alice.server.modes

import alice.core.db.Database
import alice.ha.ConfigJobService
import alice.ha.HaServiceCallInput
import alice.ha.HaServiceTarget
import alice.ha.HomeAssistantGateway
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.ConcurrentHashMap

const val MODE_HELPER_ENTITY = "input_select.alice_household_mode"

@Serializable
data class MirrorStatus(val status: String, val reason: String? = null)

class ModeMirrorService(
    private val database: Database,
    private val gateway: HomeAssistantGateway,
    private val configJobs: ConfigJobService? = null,
) {
    private val lastPushed = ConcurrentHashMap<String, String>()

    suspend fun push(householdId: String, mode: String) {
        lastPushed[householdId] = mode
        val states = alice.core.concurrent.runCatchingNonCancellation { gateway.getStates() }.getOrDefault(emptyList())
        val helper = states.firstOrNull { it.entity_id == MODE_HELPER_ENTITY } ?: return
        if (helper.state == mode) return
        alice.core.concurrent.runCatchingNonCancellation {
            gateway.callService(
                HaServiceCallInput(
                    domain = "input_select",
                    service = "select_option",
                    data = mapOf("option" to JsonPrimitive(mode)),
                    target = HaServiceTarget(entity_id = listOf(MODE_HELPER_ENTITY)),
                )
            )
        }
    }

    fun ensureHelper(householdId: String) {
        val jobs = configJobs ?: return
        val st = jobs.status(householdId)
        if (st.connected && st.adminTokenSet) {
            jobs.enqueue(
                householdId,
                "helper.ensure_mode_select",
                """{"options":["home","away","night","vacation"]}""",
                "helper:mode",
                null,
            )
        }
    }

    suspend fun status(householdId: String): MirrorStatus {
        val states = alice.core.concurrent.runCatchingNonCancellation { gateway.getStates() }.getOrDefault(emptyList())
        if (states.any { it.entity_id == MODE_HELPER_ENTITY }) return MirrorStatus("active", null)
        val conn = database.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
        if (conn == null) return MirrorStatus("unavailable", "Home Assistant is not connected")
        val jobs = configJobs?.status(householdId)
        if (jobs != null && !jobs.adminTokenSet) return MirrorStatus("unavailable", "Add a Home Assistant admin token so Home Assistant can use the household mode")
        return MirrorStatus("waiting", "Waiting for the mode helper in Home Assistant")
    }

    /** Read current helper state from HA (best-effort sync hook for two-way mirroring). */
    suspend fun helperState(): String? {
        val states = alice.core.concurrent.runCatchingNonCancellation { gateway.getStates() }.getOrDefault(emptyList())
        return states.firstOrNull { it.entity_id == MODE_HELPER_ENTITY }?.state
    }

    fun consumePushEcho(householdId: String, mode: String): Boolean {
        return if (lastPushed[householdId] == mode) { lastPushed.remove(householdId); true } else false
    }
}
