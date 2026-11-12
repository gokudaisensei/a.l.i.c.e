package alice.server.permissions

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.time.SystemTimeProvider
import alice.server.households.HouseholdService
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class PolicyValidationTest {
    private fun env(): Pair<PermissionService, Database> {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "One", 1)
            identityQueries.insertUser("u2", "Two", 1)
            identityQueries.insertHousehold("h1", "One home", 1)
            identityQueries.insertHousehold("h2", "Two home", 1)
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
            identityQueries.insertHouseholdMember("m2", "h2", "u2", "admin", null, 1)
        }
        return PermissionService(db, HouseholdService(db, SystemTimeProvider), SystemTimeProvider, Json) to db
    }

    private fun policy(
        connection: String = alice.ha.Connections.DEFAULT_ID,
        entity: String = "light.kitchen",
        type: String = "member",
        subject: String = "u1",
        operations: List<String>? = null,
    ) = NewDevicePolicy(connection, entity, type, subject, "allow", operations)

    @Test
    fun `member policies are checked against this household`() {
        val (svc, _) = env()
        assertEquals("u1", svc.createPolicy("h1", "u1", policy()).subjectId)
        assertEquals("guest", svc.createPolicy("h1", "u1", policy(type = "role", subject = "guest")).subjectId)
        val other = assertFailsWith<AppException> { svc.createPolicy("h1", "u1", policy(subject = "u2")) }
        assertEquals(400, other.status)
        val missing = assertFailsWith<AppException> { svc.createPolicy("h1", "u1", policy(subject = "made-up")) }
        assertEquals(400, missing.status)
    }

    @Test
    fun `connection entity and operation shapes are validated`() {
        val (svc, _) = env()
        for (bad in listOf(policy(connection = "conn-2"), policy(entity = "bad id!"), policy(entity = "x".repeat(201)))) {
            assertEquals(400, assertFailsWith<AppException> { svc.createPolicy("h1", "u1", bad) }.status)
        }
        for (badOps in listOf(
            listOf("Turn_On"),
            listOf("turn_on", "turn_on"),
            (1..51).map { "op_$it" },
            listOf("a".repeat(65)),
        )) {
            assertEquals(400, assertFailsWith<AppException> { svc.createPolicy("h1", "u1", policy(operations = badOps)) }.status)
        }
        val empty = svc.createPolicy("h1", "u1", policy(operations = emptyList()))
        assertNull(empty.operations)
        val ops = svc.createPolicy("h1", "u1", policy(operations = listOf("turn_on", "set_brightness")))
        assertEquals(listOf("turn_on", "set_brightness"), ops.operations)
    }
}
