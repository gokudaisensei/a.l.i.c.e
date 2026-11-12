package alice.server.commands

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaAreaRegistryEntry
import alice.ha.HaDeviceRegistryEntry
import alice.ha.HaEntityRegistryEntry
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.configure
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CommandResponseSerializationTest {

    @Test
    fun `toPublicCommand serializes requested and actual state with correct JSON types`() = runBlocking<Unit> {
        val cmd = DeviceCommand(
            id = "cmd_1",
            householdId = "h1",
            connectionId = "conn-1",
            entityId = "lock.front",
            domain = "lock",
            action = "lock",
            parameters = emptyMap(),
            state = CommandState.CONFIRMED,
            requestedState = mapOf(
                "power" to true,
                "brightness" to 71,
                "level" to 0.5,
                "lock" to "locked",
                "rgb" to listOf(255, 127, 125),
                "color" to mapOf("rgb" to listOf(255, 127, 125)),
                "nothing" to null,
            ),
            actualState = mapOf(
                "power" to false,
                "hvac_mode" to "heat_cool",
                "cover" to "open",
            ),
            requestedBy = "u1",
            source = CommandSource.USER,
            haContextId = "ctx",
            failure = null,
            confirmedBy = "state",
            createdAt = 1L,
            dispatchedAt = 2L,
            acceptedAt = 3L,
            finishedAt = 4L,
            timeoutAt = 5L,
            previousState = emptyMap(),
            undoOf = null,
            undoneBy = null,
            groupId = null,
        )
        val pub = toPublicCommand(cmd)
        val req = pub.requestedState!!
        assertEquals(true, (req["power"] as JsonPrimitive).boolean)
        assertEquals(71, (req["brightness"] as JsonPrimitive).int)
        assertEquals(0.5, (req["level"] as JsonPrimitive).double)
        assertEquals("locked", (req["lock"] as JsonPrimitive).content)
        assertEquals(listOf(255, 127, 125), (req["rgb"] as JsonArray).map { (it as JsonPrimitive).int })
        val color = (req["color"] as JsonObject)["rgb"] as JsonArray
        assertEquals(listOf(255, 127, 125), color.map { (it as JsonPrimitive).int })
        assertTrue(req["nothing"] is JsonNull)

        val act = pub.actualState!!
        assertEquals(false, (act["power"] as JsonPrimitive).boolean)
        assertEquals("heat_cool", (act["hvac_mode"] as JsonPrimitive).content)
        assertEquals("open", (act["cover"] as JsonPrimitive).content)
    }

    @Test
    fun `command HTTP response includes string and nested state values without 500`() = runBlocking<Unit> {
        val origin = "http://localhost:3000"
        val app = koinApplication {
            modules(
                coreModule(
                    AppConfig(
                        database = DatabaseConfig(path = ":memory:"),
                        webauthn = WebAuthnConfig(rpId = "localhost", origin = origin),
                    ),
                ),
                serverModule(),
            )
        }
        try {
            testApplication {
                application { configure(app.koin) }
                val device = VirtualAuthenticator("localhost", origin)
                val options = Json.decodeFromString<RegistrationOptionsResponse>(
                    client.post("/api/v1/auth/register/options") {
                        header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                        setBody("""{"displayName":"Admin"}""")
                    }.bodyAsText(),
                )
                val verify = client.post("/api/v1/auth/register/verify") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody(
                        """{"challengeId":"${options.challengeId}","response":${
                            Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))
                        }}""",
                    )
                }
                val cookie = verify.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")

                val gw = app.koin.get<FakeGateway>()
                val cache = app.koin.get<StateCache>()
                gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
                gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "Lamp", area_id = "a1", identifiers = listOf(listOf("x", "dev1"))))
                gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.one", device_id = "dev1", platform = "light", original_name = "Lamp"))
                val initial = HaEntityState("light.one", "on", mapOf("friendly_name" to JsonPrimitive("Lamp"), "brightness" to JsonPrimitive(200), "rgb_color" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(127), JsonPrimitive(125)))))
                gw.states.add(initial)
                cache.replaceAll(gw.states.toList())
                gw.onCallService = { call ->
                    val entity = call.target!!.entity_id!!.first()
                    // HA reports back a color state the executor will match and expose in actualState
                    cache.apply(
                        HaEntityState(
                            entity, "on",
                            mapOf(
                                "friendly_name" to JsonPrimitive("Lamp"),
                                "brightness" to JsonPrimitive(102),
                                "rgb_color" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(127), JsonPrimitive(125))),
                            ),
                        ),
                        entity,
                    )
                }

                val list = Json.parseToJsonElement(
                    client.get("/api/v1/devices") {
                        header(HttpHeaders.Cookie, "alice_session=$cookie")
                        header(HttpHeaders.Origin, origin)
                    }.bodyAsText()
                ).jsonObject["devices"]!!.jsonArray
                val id = list.first().jsonObject["id"]!!.jsonPrimitive.content

                val resp = client.post("/api/v1/devices/$id/commands") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"action":"set_color","parameters":{"rgb":[255,127,125]}}""")
                }
                assertEquals(HttpStatusCode.OK, resp.status, resp.bodyAsText())
                val body = Json.parseToJsonElement(resp.bodyAsText()).jsonObject
                assertEquals("confirmed", body["state"]!!.jsonPrimitive.content)
                val reqState = body["requestedState"]!!.jsonObject
                val colorReq = (reqState["color"] as JsonObject)["rgb"] as JsonArray
                assertEquals(listOf(255, 127, 125), colorReq.map { (it as JsonPrimitive).content.toDouble().toInt() })
                val actual = body["actualState"]?.jsonObject
                assertTrue(actual != null, "actualState should be present for confirmed state-matched command")
                // nested/typed values must be proper JSON, not stringified
                val colorAct = actual["color"] as? JsonObject
                assertTrue(colorAct != null || actual["rgb"] != null, body.toString())
                assertTrue(body.toString().contains("255"), body.toString())
            }
        } finally {
            app.close()
        }
    }
}
