package alice.ha

import java.security.MessageDigest

object ThingBuilder {
    private fun deviceRef(id: String) = "device:$id"
    private fun entityRef(id: String) = "entity:$id"
    private fun thingId(connectionId: String, ref: String): String {
        val md = MessageDigest.getInstance("SHA-1")
        val bytes = md.digest("$connectionId:$ref".toByteArray())
        return "thing_" + bytes.joinToString("") { "%02x".format(it) }.take(16)
    }

    private class UnionFind {
        private val parent = mutableMapOf<String, String>()
        fun find(x: String): String {
            if (!parent.containsKey(x)) { parent[x] = x; return x }
            var root = x
            while (true) {
                val p = parent[root] ?: root
                if (p == root) break
                root = p
            }
            var current = x
            while (true) {
                val next = parent[current] ?: root
                if (next == root) break
                parent[current] = root
                current = next
            }
            return root
        }
        fun union(a: String, b: String) {
            val ra = find(a); val rb = find(b)
            if (ra != rb) parent[rb] = ra
        }
    }

    data class ThingOverrides(
        val things: Map<String, ThingOverride> = emptyMap(),
        val entities: Map<String, EntityOverride> = emptyMap(),
        val merges: List<List<String>> = emptyList(),
        val splits: List<String> = emptyList(),
    )
    data class ThingOverride(val displayName: String? = null, val hidden: Boolean? = null, val areaId: String? = null)
    data class EntityOverride(val role: EntityRole? = null, val displayName: String? = null, val attachTo: String? = null, val hidden: Boolean? = null, val onMeans: String? = null)

    fun buildThings(inv: Inventory, connectionId: String, ov: ThingOverrides = ThingOverrides()): List<Thing> {
        val areaName = inv.areas.associate { it.areaId to it.name }
        val deviceById = inv.devices.associateBy { it.deviceId }
        val parentDeviceIds = inv.devices.mapNotNull { it.viaDeviceId }.toSet()
        val split = ov.splits.toSet()

        fun refOf(e: InventoryEntity): String =
            if (e.deviceId != null && deviceById.containsKey(e.deviceId) && !split.contains(e.entityId)) deviceRef(e.deviceId) else entityRef(e.entityId)

        val uf = UnionFind()
        val byHardwareId = mutableMapOf<String, String>()
        for (d in inv.devices) {
            uf.find(deviceRef(d.deviceId))
            for (t in d.identifiers + d.connections) {
                val key = t.joinToString("\u0000")
                val seen = byHardwareId[key]
                if (seen != null) uf.union(seen, deviceRef(d.deviceId)) else byHardwareId[key] = deviceRef(d.deviceId)
            }
        }
        for (group in ov.merges) for (ref in group.drop(1)) uf.union(group[0], ref)

        val preferred = mutableMapOf<String, String>()
        for (group in ov.merges) preferred[uf.find(group[0])] = group[0]

        val buckets = linkedMapOf<String, MutableList<InventoryEntity>>()
        for (e in inv.entities) {
            val root = uf.find(refOf(e))
            buckets.getOrPut(root) { mutableListOf() }.add(e)
        }
        val devicesByRoot = linkedMapOf<String, MutableList<InventoryDevice>>()
        for (d in inv.devices) {
            val root = uf.find(deviceRef(d.deviceId))
            devicesByRoot.getOrPut(root) { mutableListOf() }.add(d)
            if (!buckets.containsKey(root)) buckets[root] = mutableListOf()
        }
        val canonical: (String) -> String = { root -> preferred[root] ?: root }
        val rootOfDevice = mutableMapOf<String, String>()
        val things = mutableListOf<Thing>()

        for ((root, ents) in buckets) {
            val devices = devicesByRoot[root] ?: emptyList()
            // Entity-less hub Things: create a Thing for a hub device even if it
            // has no direct entities, as long as other devices hang off it (L19).
            val hasChildren = devices.any { it.deviceId in parentDeviceIds }
            if (ents.isEmpty() && !hasChildren) continue
            if (ents.isEmpty()) {
                // Create a minimal Thing for the hub
                val mainDevice = devices.firstOrNull() ?: continue
                val thingOv = ov.things[canonical(root)] ?: ov.things[root]
                things.add(
                    Thing(
                        id = thingId(connectionId, canonical(root)),
                        ref = canonical(root),
                        kind = if (devices.all { it.entryType == "service" }) ThingKind.service else ThingKind.device,
                        name = thingOv?.displayName ?: NameCleaner.cleanThingName(mainDevice.name, null),
                        nameSource = if (thingOv?.displayName != null) "override" else "computed",
                        sourceName = mainDevice.name,
                        areaId = mainDevice.areaId,
                        hidden = thingOv?.hidden ?: true,
                        primary = null,
                        others = emptyList(),
                        controls = emptyList(),
                        facets = emptyList(),
                        sensors = emptyList(),
                        diagnostics = emptyList(),
                        entityIds = emptyList(),
                        hubThingId = null,
                        deviceIds = devices.map { it.deviceId },
                        aliases = NameCleaner.buildAliases(mainDevice.name, null, ""),
                        manufacturer = mainDevice.manufacturer,
                        model = mainDevice.model,
                    ),
                )
                continue
            }
            for (d in devices) rootOfDevice[d.deviceId] = root
            val ref = canonical(root)
            val mainDevice = devices.firstOrNull()
            val thingOv = ov.things[ref] ?: ov.things[root]

            val areaCounts = mutableMapOf<String, Int>()
            for (e in ents) if (e.areaId != null) areaCounts[e.areaId] = (areaCounts[e.areaId] ?: 0) + 1
            val commonArea = areaCounts.entries.sortedByDescending { it.value }.firstOrNull()?.key
            val areaId = if (thingOv?.areaId != null) thingOv.areaId else (mainDevice?.areaId ?: commonArea)
            val aName = areaId?.let { areaName[it] }

            val deviceHasPrimaryDomain = ents.any { RoleClassifier.PRIMARY_DOMAINS.contains(it.domain) && it.entityCategory == null }
            val sourceName: String
            val computedName: String
            if (mainDevice != null) {
                sourceName = mainDevice.name
                computedName = NameCleaner.cleanThingName(mainDevice.name, aName)
            } else {
                val looseEntity = ents.first()
                sourceName = looseEntity.sourceName
                computedName = NameCleaner.cleanThingName(looseEntity.sourceName, aName)
            }

            data class Row(val e: InventoryEntity, var name: String?, var role: EntityRole, var reason: String)
            val rows = ents.map { e ->
                val eo = ov.entities[e.entityId]
                val cleaned = NameCleaner.cleanEntityName(e.sourceName, e.ownName, e.hasEntityName, mainDevice?.name, aName)
                var name = eo?.displayName ?: cleaned
                val auto = RoleClassifier.classifyRole(e, RoleClassifier.RoleContext(name ?: computedName, deviceHasPrimaryDomain, mainDevice != null))
                if (eo?.hidden == true) Row(e, name, EntityRole.diagnostic, "hidden by user")
                else if (eo?.role != null) Row(e, name, eo.role, "set by user")
                else Row(e, name, auto.role, auto.reason)
            }.toMutableList()

            val primaries = rows.filter { it.role == EntityRole.primary }.sortedWith(compareBy({ RoleClassifier.primaryRank(it.e) }, { it.e.entityId }))
            var primaryRow = primaries.firstOrNull()
            if (primaryRow == null) {
                val candidates = rows.filter { it.role == EntityRole.control || it.role == EntityRole.sensor || it.role == EntityRole.facet }
                    .sortedWith(compareBy({ RoleClassifier.promotionRank(it.e) }, { it.e.entityId }))
                primaryRow = candidates.firstOrNull()
                if (primaryRow != null) { primaryRow.role = EntityRole.primary; primaryRow.reason = "promoted: best entity on a device with no primary-class entity" }
            }

            fun toEntity(r: Row): ThingEntity = ThingEntity(
                entityId = r.e.entityId, domain = r.e.domain, name = r.name ?: computedName, role = r.role,
                deviceClass = r.e.deviceClass, roleReason = r.reason, capabilities = r.e.capabilities,
            )

            val nameOverride = thingOv?.displayName
            val name = nameOverride ?: computedName
            val kind = if (devices.isEmpty()) ThingKind.virtual else if (devices.all { it.entryType == "service" }) ThingKind.service else ThingKind.device
            val primary = primaryRow?.let { toEntity(it) }
            val facets = rows.filter { it.role == EntityRole.facet }.map { r ->
                val fe = toEntity(r)
                ThingEntity(
                    entityId = fe.entityId, domain = fe.domain, name = fe.name, role = fe.role,
                    deviceClass = fe.deviceClass, roleReason = fe.roleReason, capabilities = fe.capabilities,
                    key = RoleClassifier.facetKey(r.name ?: ""),
                    attachedTo = ov.entities[r.e.entityId]?.attachTo ?: primary?.entityId,
                )
            }

            things.add(
                Thing(
                    id = thingId(connectionId, ref),
                    ref = ref,
                    kind = kind,
                    name = name,
                    nameSource = if (nameOverride != null) "override" else if (computedName == sourceName) "source" else "computed",
                    sourceName = sourceName,
                    areaId = areaId,
                    hidden = thingOv?.hidden ?: (primary == null),
                    primary = primary,
                    others = rows.filter { it.role == EntityRole.primary && it !== primaryRow }.map { toEntity(it) },
                    controls = rows.filter { it.role == EntityRole.control }.map { toEntity(it) },
                    facets = facets,
                    sensors = rows.filter { it.role == EntityRole.sensor }.map { toEntity(it) },
                    diagnostics = rows.filter { it.role == EntityRole.diagnostic || it.role == EntityRole.config }.map { toEntity(it) },
                    entityIds = ents.map { it.entityId },
                    hubThingId = null,
                    deviceIds = devices.map { it.deviceId },
                    aliases = NameCleaner.buildAliases(name, aName, primaryRow?.e?.domain ?: ""),
                    manufacturer = mainDevice?.manufacturer,
                    model = mainDevice?.model,
                ),
            )
        }

        // Hub/child links
        val idOfRoot = things.associate { t ->
            val root = if (t.deviceIds.isNotEmpty()) uf.find(deviceRef(t.deviceIds[0])) else ""
            root to t.id
        }
        val linked = things.map { t ->
            val via = t.deviceIds.mapNotNull { deviceById[it]?.viaDeviceId }.firstOrNull()
            val hubRoot = via?.let { rootOfDevice[it] }
            val hubId = hubRoot?.let { idOfRoot[it] }
            if (hubId != null && hubId != t.id) t.copy(hubThingId = hubId) else t
        }

        return linked.sortedBy { it.name }
    }
}