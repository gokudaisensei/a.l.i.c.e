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
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.koin.core.Koin
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Route behavior that used to be wrong: 500s from untyped maps, role and expiry handling, entity ownership. */
class RouteFixesTest {
    private val origin = "http://localhost:3000"

    private fun newApp() = koinApplication {
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

    private fun run(block: suspend ApplicationTestBuilder.(cookie: String, koin: Koin) -> Unit) {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerCookie(client)
                block(cookie, app.koin)
            }
        } finally {
            app.close()
        }
    }

    private suspend fun registerCookie(client: HttpClient): String {
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
        return verify.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")
    }

    private suspend fun HttpClient.getJson(path: String, cookie: String): HttpResponse =
        get(path) { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, origin) }

    private suspend fun HttpClient.send(method: String, path: String, cookie: String, body: String?): HttpResponse {
        val setup: io.ktor.client.request.HttpRequestBuilder.() -> Unit = {
            header(HttpHeaders.Cookie, "alice_session=$cookie")
            header(HttpHeaders.Origin, origin)
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            if (body != null) setBody(body)
        }
        return when (method) {
            "PATCH" -> patch(path, setup)
            "PUT" -> put(path, setup)
            "DELETE" -> delete(path, setup)
            else -> post(path, setup)
        }
    }

    @Test
    fun `the notifications list answers instead of failing`() = run { cookie, _ ->
        val r = client.getJson("/api/v1/notifications", cookie)
        assertEquals(HttpStatusCode.OK, r.status)
        val body = Json.parseToJsonElement(r.bodyAsText()).jsonObject
        assertEquals(0, body["notifications"]!!.jsonArray.size)
        assertEquals("0", body["unread"]!!.jsonPrimitive.content)
    }

    @Test
    fun `renaming the household returns its real mode and rejects an unknown timezone`() = run { cookie, _ ->
        assertEquals(HttpStatusCode.OK, client.send("PUT", "/api/v1/household/mode", cookie, """{"mode":"away"}""").status)
        val renamed = client.send("PATCH", "/api/v1/household", cookie, """{"name":"Flat","timezone":"Asia/Kolkata"}""")
        assertEquals(HttpStatusCode.OK, renamed.status)
        val body = Json.parseToJsonElement(renamed.bodyAsText()).jsonObject
        assertEquals("away", body["mode"]!!.jsonPrimitive.content)
        assertEquals("Asia/Kolkata", body["timezone"]!!.jsonPrimitive.content)
        val bad = client.send("PATCH", "/api/v1/household", cookie, """{"timezone":"Mars/Olympus"}""")
        assertEquals(HttpStatusCode.BadRequest, bad.status)
    }

    @Test
    fun `an unknown role or a silly invitation length is a bad request, not a server error`() = run { cookie, _ ->
        assertEquals(HttpStatusCode.BadRequest, client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"boss"}""").status)
        assertEquals(HttpStatusCode.BadRequest, client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"guest","expiresInHours":0}""").status)
        assertEquals(HttpStatusCode.BadRequest, client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"guest","expiresInHours":-5}""").status)
        assertEquals(HttpStatusCode.BadRequest, client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"guest","guestAccessHours":100000}""").status)
        val ok = client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"guest","expiresInHours":2}""")
        assertEquals(HttpStatusCode.OK, ok.status)
    }

    @Test
    fun `changing only a member's role keeps their expiry, and null clears it`() = run { cookie, koin ->
        val household = Json.parseToJsonElement(client.getJson("/api/v1/household", cookie).bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
        val expiresAt = System.currentTimeMillis() + 86_400_000L
        koin.get<Database>().write {
            identityQueries.insertUser("u2", "Guest", 1000)
            identityQueries.insertUserPreferences("u2")
            identityQueries.insertHouseholdMember("m2", household, "u2", "guest", expiresAt, 1000)
        }
        val roleOnly = client.send("PATCH", "/api/v1/household/members/m2", cookie, """{"role":"member"}""")
        assertEquals(HttpStatusCode.OK, roleOnly.status)
        val kept = Json.parseToJsonElement(roleOnly.bodyAsText()).jsonObject
        assertEquals("member", kept["role"]!!.jsonPrimitive.content)
        assertEquals(expiresAt.toString(), kept["expiresAt"]!!.jsonPrimitive.content)

        val cleared = client.send("PATCH", "/api/v1/household/members/m2", cookie, """{"expiresAt":null}""")
        assertEquals(HttpStatusCode.OK, cleared.status)
        assertTrue(Json.parseToJsonElement(cleared.bodyAsText()).jsonObject["expiresAt"] is kotlinx.serialization.json.JsonNull)

        assertEquals(HttpStatusCode.BadRequest, client.send("PATCH", "/api/v1/household/members/m2", cookie, """{"role":"boss"}""").status)
    }

    @Test
    fun `a command cannot name an entity that belongs to another device`() = run { cookie, koin ->
        val gw = koin.get<FakeGateway>()
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        for ((dev, entity) in listOf("dev1" to "light.one", "dev2" to "light.two")) {
            gw.devices.add(HaDeviceRegistryEntry(id = dev, name = dev, area_id = "a1", identifiers = listOf(listOf("x", dev))))
            gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = entity, device_id = dev, platform = "light", original_name = entity))
            gw.states.add(HaEntityState(entity, "off", mapOf("friendly_name" to JsonPrimitive(entity), "supported_color_modes" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("brightness"))))))
        }
        val devices = Json.parseToJsonElement(client.getJson("/api/v1/devices", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray
        val byEntity = devices.associate { it.jsonObject["primary"]!!.jsonObject["entityId"]!!.jsonPrimitive.content to it.jsonObject["id"]!!.jsonPrimitive.content }
        val one = byEntity.getValue("light.one")

        val foreign = client.send("POST", "/api/v1/devices/$one/commands", cookie, """{"entityId":"light.two","action":"turn_on"}""")
        assertEquals(HttpStatusCode.NotFound, foreign.status)
        assertTrue(gw.calls.isEmpty(), "nothing may reach Home Assistant")

        val own = client.send("POST", "/api/v1/devices/$one/commands", cookie, """{"action":"turn_on"}""")
        assertEquals(HttpStatusCode.OK, own.status)
        assertEquals(listOf("light.one"), gw.calls.single().target?.entity_id)
        assertNull(gw.calls.single().data?.get("entity_id"))
    }

    @Test
    fun `renaming and hiding a device through the API takes effect`() = run { cookie, koin ->
        val gw = koin.get<FakeGateway>()
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "dev1", area_id = "a1", identifiers = listOf(listOf("x", "dev1"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.one", device_id = "dev1", platform = "light", original_name = "light.one"))
        gw.states.add(HaEntityState("light.one", "off", mapOf("friendly_name" to JsonPrimitive("light.one"))))
        fun names(path: String) = runBlocking {
            Json.parseToJsonElement(client.getJson(path, cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray
                .associate { it.jsonObject["id"]!!.jsonPrimitive.content to it.jsonObject["name"]!!.jsonPrimitive.content }
        }
        val id = names("/api/v1/devices").keys.single()

        assertEquals(HttpStatusCode.OK, client.send("PATCH", "/api/v1/devices/$id/name", cookie, """{"name":"Reading lamp"}""").status)
        assertEquals("Reading lamp", names("/api/v1/devices")[id])

        assertEquals(HttpStatusCode.OK, client.send("POST", "/api/v1/devices/$id/hide", cookie, "{}").status)
        val listed = Json.parseToJsonElement(client.getJson("/api/v1/devices", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray
        assertEquals("true", listed.single().jsonObject["hidden"]!!.jsonPrimitive.content, "admins still see it, marked hidden")
    }

    @Test
    fun `no read endpoint fails with a server error for a signed-in admin`() = run { cookie, koin ->
        val gw = koin.get<FakeGateway>()
        gw.setStatus(alice.ha.HaConnectionState.CONNECTED) // history answers 503 on purpose when Home Assistant is down
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "dev1", area_id = "a1", identifiers = listOf(listOf("x", "dev1"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.one", device_id = "dev1", platform = "light", original_name = "light.one"))
        gw.states.add(HaEntityState("light.one", "on", mapOf("friendly_name" to JsonPrimitive("light.one"))))
        val deviceId = Json.parseToJsonElement(client.getJson("/api/v1/devices", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray.first().jsonObject["id"]!!.jsonPrimitive.content
        val paths = listOf(
            "/api/v1/activity", "/api/v1/admin/audit", "/api/v1/admin/config-sync", "/api/v1/admin/diagnostics", "/api/v1/admin/health",
            "/api/v1/admin/metrics", "/api/v1/admin/security/sensitive-operations", "/api/v1/admin/support", "/api/v1/ai/settings",
            "/api/v1/alerts", "/api/v1/areas", "/api/v1/areas/a1/devices", "/api/v1/auth/passkeys", "/api/v1/auth/session", "/api/v1/auth/sessions",
            "/api/v1/auth/setup", "/api/v1/automations", "/api/v1/backups", "/api/v1/backups/settings", "/api/v1/commands", "/api/v1/devices",
            "/api/v1/devices/$deviceId", "/api/v1/devices/$deviceId/activity", "/api/v1/devices/$deviceId/capabilities", "/api/v1/energy/devices",
            "/api/v1/energy/history", "/api/v1/energy/pattern", "/api/v1/energy/summary", "/api/v1/favorites", "/api/v1/groups", "/api/v1/ha/connection",
            "/api/v1/history/devices/$deviceId", "/api/v1/home", "/api/v1/home/why", "/api/v1/household", "/api/v1/household/invitations",
            "/api/v1/household/members", "/api/v1/household/mode", "/api/v1/household/people", "/api/v1/insights", "/api/v1/notifications",
            "/api/v1/permissions/me", "/api/v1/permissions/policies", "/api/v1/routines", "/api/v1/routines/runs", "/api/v1/scenes",
            "/api/v1/search?q=light", "/api/v1/things", "/api/v1/things/areas", "/api/v1/updates", "/api/v1/updates/history",
            "/api/v1/users/me", "/api/v1/users/me/preferences", "/api/v1/users/me/push-subscriptions",
        )
        val failures = paths.mapNotNull { path ->
            val r = client.getJson(path, cookie)
            if (r.status.value >= 500) "$path -> ${r.status.value} ${r.bodyAsText().take(200)}" else null
        }
        assertTrue(failures.isEmpty(), "server errors:\n" + failures.joinToString("\n"))
    }

    private suspend fun ApplicationTestBuilder.invite(cookie: String): Pair<String, String> {
        val r = client.send("POST", "/api/v1/household/invitations", cookie, """{"role":"member"}""")
        assertEquals(HttpStatusCode.OK, r.status)
        val body = Json.parseToJsonElement(r.bodyAsText()).jsonObject
        return body["id"]!!.jsonPrimitive.content to body["code"]!!.jsonPrimitive.content
    }

    private suspend fun ApplicationTestBuilder.registerOptions(code: String): RegistrationOptionsResponse {
        val r = client.post("/api/v1/auth/register/options") {
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            setBody("""{"displayName":"Guest","inviteCode":"$code"}""")
        }
        assertEquals(HttpStatusCode.OK, r.status, r.bodyAsText())
        return Json.decodeFromString(r.bodyAsText())
    }

    private suspend fun ApplicationTestBuilder.registerVerify(options: RegistrationOptionsResponse): HttpResponse {
        val device = VirtualAuthenticator("localhost", origin)
        return client.post("/api/v1/auth/register/verify") {
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            setBody("""{"challengeId":"${options.challengeId}","response":${Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))}}""")
        }
    }

    @Test
    fun `the invitation code is not kept in the stored challenge, and the invitation still works`() = run { cookie, koin ->
        val (_, code) = invite(cookie)
        val options = registerOptions(code)
        val stored = koin.get<Database>().write {
            identityQueries.takeChallenge(System.currentTimeMillis(), options.challengeId, "register", 0L).executeAsOne().data_
        }
        assertTrue(stored != null && !stored.contains(code), "stored challenge data: $stored")
        // peeking consumed that challenge; start another and complete it
        val again = registerOptions(code)
        assertEquals(HttpStatusCode.OK, registerVerify(again).status)
    }

    @Test
    fun `an invitation revoked after the options step cannot be used to finish registering`() = run { cookie, _ ->
        val (id, code) = invite(cookie)
        val options = registerOptions(code)
        assertEquals(HttpStatusCode.OK, client.send("DELETE", "/api/v1/household/invitations/$id", cookie, null).status)
        assertEquals(HttpStatusCode.BadRequest, registerVerify(options).status)
    }

    @Test
    fun `support access that has run out is ignored without any write on read`() = run { _, koin ->
        val db = koin.get<Database>()
        val svc = koin.get<alice.server.support.SupportService>()
        val household = db.read { identityQueries.selectAllHouseholds().executeAsList().first().id }
        val admin = db.read { identityQueries.selectHouseholdMembersWithUsers(household).executeAsList().first().user_id }
        val granted = svc.grant(household, admin, 1, mapOf("devices" to true))
        assertNotNull(svc.active(household))
        db.write { coreQueries.updateSupportSessionExtend(System.currentTimeMillis() - 1000, granted.id) }
        assertNull(svc.active(household))
        val row = db.read { coreQueries.selectSupportSessionById(granted.id, household).executeAsOne() }
        assertNull(row.ended_at, "reading must not mark the session ended")
        val shown = svc.history(household).first()
        assertEquals("expiry", shown.endedBy)
        assertEquals(false, shown.active)
    }

    @Test
    fun `changing the mode shows up in the activity feed`() = run { cookie, _ ->
        assertEquals(HttpStatusCode.OK, client.send("PUT", "/api/v1/household/mode", cookie, """{"mode":"away"}""").status)
        val feed = client.getJson("/api/v1/activity", cookie).bodyAsText()
        assertTrue(feed.contains("switched to Away mode"), feed)
    }

    @Test
    fun `a confirmed command is recorded in the activity feed`() = run { cookie, koin ->
        val gw = koin.get<FakeGateway>()
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "dev1", area_id = "a1", identifiers = listOf(listOf("x", "dev1"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.one", device_id = "dev1", platform = "light", original_name = "Lamp"))
        gw.states.add(HaEntityState("light.one", "off", mapOf("friendly_name" to JsonPrimitive("Lamp"))))
        koin.get<alice.ha.StateCache>().replaceAll(gw.states.toList())
        // Home Assistant would report the new state; the cache is what the executor watches for confirmation.
        gw.onCallService = { call ->
            val entity = call.target!!.entity_id!!.first()
            koin.get<alice.ha.StateCache>().apply(HaEntityState(entity, "on", mapOf("friendly_name" to JsonPrimitive("Lamp"))), entity)
        }
        val id = Json.parseToJsonElement(client.getJson("/api/v1/devices", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray.first().jsonObject["id"]!!.jsonPrimitive.content
        assertEquals(HttpStatusCode.OK, client.send("POST", "/api/v1/devices/$id/commands", cookie, """{"action":"turn_on"}""").status)
        // the executor confirms asynchronously; wait for the feed rather than assuming a delay
        var feed = ""
        for (n in 1..60) {
            feed = client.getJson("/api/v1/activity", cookie).bodyAsText()
            if (feed.contains("turned on")) break
            kotlinx.coroutines.delay(50)
        }
        assertTrue(feed.contains("turned on"), feed)
    }

    @Test
    fun `the Home Assistant connection endpoints answer with their documented keys`() = run { cookie, _ ->
        fun body(r: HttpResponse) = runBlocking { Json.parseToJsonElement(r.bodyAsText()).jsonObject }
        val saved = client.send("PUT", "/api/v1/ha/connection", cookie, """{"name":"Home","baseUrl":"http://127.0.0.1:1","token":"abc"}""")
        assertEquals(HttpStatusCode.OK, saved.status)
        assertEquals("false", body(client.getJson("/api/v1/ha/connection", cookie))["adminTokenSet"]?.jsonPrimitive?.content)

        val test = body(client.send("POST", "/api/v1/ha/connection/test", cookie, "{}"))
        assertEquals("false", test["ok"]!!.jsonPrimitive.content)
        assertTrue(test["error"]!!.jsonPrimitive.content.isNotBlank())
        assertEquals(JsonNull, test["status"], "an unreachable server has no status")

        val resync = body(client.send("POST", "/api/v1/ha/connection/resync", cookie, "{}"))
        // With no admin token the verification cannot be queued, so ok is false (SYN-6).
        assertEquals("false", resync["ok"]!!.jsonPrimitive.content)
        assertTrue(resync.containsKey("triggered"))
        assertTrue(resync["error"]!!.jsonPrimitive.content.isNotBlank())

        val deleted = body(client.send("DELETE", "/api/v1/ha/connection", cookie, null))
        assertEquals("true", deleted["deleted"]!!.jsonPrimitive.content)
        assertEquals(HttpStatusCode.NotFound, client.send("DELETE", "/api/v1/ha/connection", cookie, null).status)
    }

    @Test
    fun `deleting a backup that does not exist is a 404, and a restore of one is too`() = run { cookie, _ ->
        assertEquals(HttpStatusCode.NotFound, client.send("DELETE", "/api/v1/backups/bkp_missing", cookie, null).status)
        assertEquals(HttpStatusCode.NotFound, client.send("POST", "/api/v1/backups/bkp_missing/restore", cookie, "{}").status)
    }

    // ---- favorites and live state, populated (the empty-home smoke test cannot see these) ----

    private fun seedLampAndLock(koin: Koin) {
        val gw = koin.get<FakeGateway>()
        gw.areas.add(HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev_lamp", name = "Lamp", area_id = "a1", identifiers = listOf(listOf("x", "dev_lamp"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.lamp", device_id = "dev_lamp", platform = "light", original_name = "Lamp", name = "Lamp"))
        gw.states.add(HaEntityState("light.lamp", "on", mapOf("friendly_name" to JsonPrimitive("Lamp"), "brightness" to JsonPrimitive(180))))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev_lock", name = "Front door", area_id = "a1", identifiers = listOf(listOf("x", "dev_lock"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "lock.front", device_id = "dev_lock", platform = "lock", original_name = "Front door", name = "Front door"))
        gw.states.add(HaEntityState("lock.front", "locked", mapOf("friendly_name" to JsonPrimitive("Front door"))))
        koin.get<alice.ha.StateCache>().replaceAll(gw.states.toList())
    }

    private suspend fun ApplicationTestBuilder.deviceIdsByName(cookie: String): Map<String, String> =
        Json.parseToJsonElement(client.getJson("/api/v1/devices", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray
            .associate { it.jsonObject["name"]!!.jsonPrimitive.content to it.jsonObject["id"]!!.jsonPrimitive.content }

    private suspend fun ApplicationTestBuilder.favoriteNames(cookie: String): List<String> =
        Json.parseToJsonElement(client.getJson("/api/v1/favorites", cookie).bodyAsText()).jsonObject["devices"]!!.jsonArray.map { it.jsonObject["name"]!!.jsonPrimitive.content }

    @Test
    fun `a hidden device drops out of favorites and comes back when shown again`() = run { cookie, koin ->
        seedLampAndLock(koin)
        val ids = deviceIdsByName(cookie)
        assertEquals(HttpStatusCode.OK, client.send("PUT", "/api/v1/favorites", cookie, """{"thingIds":["${ids.getValue("Lamp")}","${ids.getValue("Front door")}"]}""").status)
        assertEquals(listOf("Lamp", "Front door"), favoriteNames(cookie), "the order given is the order kept")
        assertEquals(HttpStatusCode.OK, client.send("POST", "/api/v1/devices/${ids.getValue("Lamp")}/hide", cookie, "{}").status)
        assertEquals(listOf("Front door"), favoriteNames(cookie))
        assertEquals(HttpStatusCode.OK, client.send("POST", "/api/v1/devices/${ids.getValue("Lamp")}/unhide", cookie, "{}").status)
        assertEquals(listOf("Lamp", "Front door"), favoriteNames(cookie))
    }

    @Test
    fun `favorites carry live values, and a guest only sees the favorites a rule lets them see`() = run { _, koin ->
        seedLampAndLock(koin)
        val db = koin.get<Database>()
        val household = db.read { identityQueries.selectAllHouseholds().executeAsList().first().id }
        val token = "guest-session-token-for-the-test"
        db.write {
            identityQueries.insertUser("guest1", "Guest", 1000); identityQueries.insertUserPreferences("guest1")
            identityQueries.insertHouseholdMember("m-guest", household, "guest1", "guest", null, 1000)
            identityQueries.insertSession("s-guest", "guest1", alice.core.security.Tokens.sha256(token), 1000, Long.MAX_VALUE / 2, 1000, null, null, 0)
        }
        // Saved straight into the table: the PUT route would already have dropped what the guest cannot see.
        koin.get<alice.server.favorites.FavoritesService>().save("guest1", listOf(alice.ha.Connections.DEFAULT_ID to "device:dev_lamp", alice.ha.Connections.DEFAULT_ID to "device:dev_lock"))
        testApplication {
            application { configure(koin) }
            assertEquals(emptyList(), favoriteNames(token), "with no allow rule a guest sees none of them")
            db.write { identityQueries.insertDevicePolicy("p1", household, alice.ha.Connections.DEFAULT_ID, "light.lamp", "role", "guest", "allow", null, null, 1) }
            val shown = Json.parseToJsonElement(client.getJson("/api/v1/favorites", token).bodyAsText()).jsonObject["devices"]!!.jsonArray
            assertEquals(listOf("Lamp"), shown.map { it.jsonObject["name"]!!.jsonPrimitive.content }, "only the lamp the rule allows")
            val primary = shown.single().jsonObject["primary"]!!.jsonObject
            assertEquals("available", primary["availability"]!!.jsonPrimitive.content)
            // 180 of 255 is shown as a percentage
            assertEquals("71", primary["values"]!!.jsonObject["brightness"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun `the things list carries live availability and values too`() = run { cookie, koin ->
        seedLampAndLock(koin)
        val lamp = Json.parseToJsonElement(client.getJson("/api/v1/things", cookie).bodyAsText()).jsonObject["things"]!!.jsonArray
            .first { it.jsonObject["name"]!!.jsonPrimitive.content == "Lamp" }.jsonObject["primary"]!!.jsonObject
        assertEquals("available", lamp["availability"]!!.jsonPrimitive.content)
        // 180 of 255 is shown as a percentage
        assertEquals("71", lamp["values"]!!.jsonObject["brightness"]!!.jsonPrimitive.content)
    }
}
