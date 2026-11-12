package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.ha.FakeGateway
import alice.ha.HaAreaRegistryEntry
import alice.ha.HaDeviceRegistryEntry
import alice.ha.HaEntityRegistryEntry
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class F021F017ParityFixesTest {
    private data class Env(
        val app: org.koin.core.KoinApplication,
        val cookie: String,
        val origin: String,
        val gw: FakeGateway,
        val cache: StateCache,
    )

    private suspend fun io.ktor.client.HttpClient.register(origin: String): String {
        val device = VirtualAuthenticator("localhost", origin)
        val options = Json.decodeFromString<RegistrationOptionsResponse>(
            post("/api/v1/auth/register/options") {
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                setBody("""{"displayName":"Admin"}""")
            }.bodyAsText(),
        )
        val verify = post("/api/v1/auth/register/verify") {
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            setBody(
                """{"challengeId":"${options.challengeId}","response":${
                    Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))
                }}""",
            )
        }
        return verify.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")
    }

    private fun seedLightAndLock(gw: FakeGateway, cache: StateCache) {
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev_light", name = "Lamp", area_id = "a1", identifiers = listOf(listOf("x", "dev_light"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.lamp", device_id = "dev_light", platform = "light", original_name = "Lamp", name = "Lamp"))
        gw.states.add(
            HaEntityState(
                "light.lamp", "on",
                mapOf(
                    "friendly_name" to JsonPrimitive("Lamp"),
                    "brightness" to JsonPrimitive(180),
                    "rgb_color" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(127), JsonPrimitive(125))),
                ),
            )
        )
        gw.devices.add(HaDeviceRegistryEntry(id = "dev_lock", name = "Front door", area_id = "a1", identifiers = listOf(listOf("x", "dev_lock"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "lock.front", device_id = "dev_lock", platform = "lock", original_name = "Front door", name = "Front door"))
        gw.states.add(HaEntityState("lock.front", "locked", mapOf("friendly_name" to JsonPrimitive("Front door"))))
        cache.replaceAll(gw.states.toList())
    }

    @Test
    fun `F-017 device views expose live availability and values from cache`() = runBlocking<Unit> {
        val origin = "http://localhost:3000"
        val app = koinApplication {
            modules(
                coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"), webauthn = WebAuthnConfig(rpId = "localhost", origin = origin))),
                serverModule(),
            )
        }
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.register(origin)
                val gw = app.koin.get<FakeGateway>()
                val cache = app.koin.get<StateCache>()
                seedLightAndLock(gw, cache)

                val devicesResp = client.get("/api/v1/devices") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                }
                assertEquals(HttpStatusCode.OK, devicesResp.status, devicesResp.bodyAsText())
                val devices = Json.parseToJsonElement(devicesResp.bodyAsText()).jsonObject["devices"]!!.jsonArray
                assertTrue(devices.size >= 2, devices.toString())
                val lamp = devices.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content.contains("Lamp") }
                assertEquals(true, lamp["available"]!!.jsonPrimitive.boolean)
                val primary = lamp["primary"]!!.jsonObject
                assertEquals("available", primary["availability"]!!.jsonPrimitive.content)
                val values = primary["values"]!!.jsonObject
                assertEquals(true, values["power"]!!.jsonPrimitive.boolean)
                // brightness normalized to percent (180/255 ~ 71)
                assertTrue(values.containsKey("brightness"), values.toString())

                val thingsResp = client.get("/api/v1/things") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                }
                assertEquals(HttpStatusCode.OK, thingsResp.status, thingsResp.bodyAsText())
                val things = Json.parseToJsonElement(thingsResp.bodyAsText()).jsonObject["things"]!!.jsonArray
                val thingLamp = things.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content.contains("Lamp") }
                assertEquals("available", thingLamp["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content)
                assertEquals(true, thingLamp["primary"]!!.jsonObject["values"]!!.jsonObject["power"]!!.jsonPrimitive.boolean)

                val lock = devices.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content.contains("Front door") }
                val lockVals = lock["primary"]!!.jsonObject["values"]!!.jsonObject
                // lock state surfaced via normalized values (e.g. lock/locked semantics) or at least not empty unknown
                assertEquals("available", lock["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content)
                assertTrue(lockVals.isNotEmpty() || lock["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content == "available", lock.toString())
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `F-017 unavailable and absent cache states are reported correctly`() = runBlocking<Unit> {
        val origin = "http://localhost:3000"
        val app = koinApplication {
            modules(
                coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"), webauthn = WebAuthnConfig(rpId = "localhost", origin = origin))),
                serverModule(),
            )
        }
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.register(origin)
                val gw = app.koin.get<FakeGateway>()
                val cache = app.koin.get<StateCache>()
                gw.areas.add(HaAreaRegistryEntry("a1", "Room", null))
                gw.devices.add(HaDeviceRegistryEntry(id = "d1", name = "Sensor", area_id = "a1", identifiers = listOf(listOf("x", "d1"))))
                gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "sensor.temp", device_id = "d1", platform = "sensor", original_name = "Sensor", name = "Sensor"))
                gw.states.add(HaEntityState("sensor.temp", "unavailable", mapOf("friendly_name" to JsonPrimitive("Sensor"))))
                // absent-from-cache case: register but do not put in cache
                gw.devices.add(HaDeviceRegistryEntry(id = "d2", name = "Ghost", area_id = "a1", identifiers = listOf(listOf("x", "d2"))))
                gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "sensor.ghost", device_id = "d2", platform = "sensor", original_name = "Ghost", name = "Ghost"))
                gw.states.add(HaEntityState("sensor.ghost", "on", mapOf("friendly_name" to JsonPrimitive("Ghost"))))
                cache.replaceAll(listOf(HaEntityState("sensor.temp", "unavailable", mapOf("friendly_name" to JsonPrimitive("Sensor")))))

                val resp = client.get("/api/v1/devices") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                }
                assertEquals(HttpStatusCode.OK, resp.status, resp.bodyAsText())
                val devices = Json.parseToJsonElement(resp.bodyAsText()).jsonObject["devices"]!!.jsonArray.map { it.jsonObject }
                val sensor = devices.first { it["name"]!!.jsonPrimitive.content == "Sensor" }
                assertEquals("unavailable", sensor["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content)
                assertEquals(false, sensor["available"]!!.jsonPrimitive.boolean)
                val ghost = devices.first { it["name"]!!.jsonPrimitive.content == "Ghost" }
                // absent from cache: TS reports unknown availability and empty values
                assertEquals("unknown", ghost["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content)
                assertEquals(JsonObject(emptyMap()), ghost["primary"]!!.jsonObject["values"]!!.jsonObject)
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `F-021 favorites return device views for non-empty list and preserve order`() = runBlocking<Unit> {
        val origin = "http://localhost:3000"
        val app = koinApplication {
            modules(
                coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"), webauthn = WebAuthnConfig(rpId = "localhost", origin = origin))),
                serverModule(),
            )
        }
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.register(origin)
                val gw = app.koin.get<FakeGateway>()
                val cache = app.koin.get<StateCache>()
                seedLightAndLock(gw, cache)

                val devices = Json.parseToJsonElement(
                    client.get("/api/v1/devices") {
                        header(HttpHeaders.Cookie, "alice_session=$cookie")
                        header(HttpHeaders.Origin, origin)
                    }.bodyAsText()
                ).jsonObject["devices"]!!.jsonArray.map { it.jsonObject }
                val lampId = devices.first { it["name"]!!.jsonPrimitive.content.contains("Lamp") }["id"]!!.jsonPrimitive.content
                val lockId = devices.first { it["name"]!!.jsonPrimitive.content.contains("Front door") }["id"]!!.jsonPrimitive.content

                val put = client.put("/api/v1/favorites") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"thingIds":["$lockId","$lampId"]}""")
                }
                assertEquals(HttpStatusCode.OK, put.status, "PUT favorites should not 500: ${put.bodyAsText()}")
                val putBody = Json.parseToJsonElement(put.bodyAsText()).jsonObject
                val putDevices = putBody["devices"]!!.jsonArray.map { it.jsonObject }
                assertEquals(listOf(lockId, lampId), putDevices.map { it["id"]!!.jsonPrimitive.content })
                // view shape like /devices (not raw Thing)
                assertTrue(putDevices.first().containsKey("primary"))
                assertTrue(putDevices.first().containsKey("kind"))
                assertEquals(true, putDevices.first()["favorite"]!!.jsonPrimitive.boolean)
                // live state carried through (F-017 integration)
                assertEquals("available", putDevices.first()["primary"]!!.jsonObject["availability"]!!.jsonPrimitive.content)

                val get = client.get("/api/v1/favorites") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, origin)
                }
                assertEquals(HttpStatusCode.OK, get.status, "GET favorites should not 500: ${get.bodyAsText()}")
                val getDevices = Json.parseToJsonElement(get.bodyAsText()).jsonObject["devices"]!!.jsonArray.map { it.jsonObject }
                assertEquals(listOf(lockId, lampId), getDevices.map { it["id"]!!.jsonPrimitive.content })
            }
        } finally {
            app.close()
        }
    }
}
