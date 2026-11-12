package alice.ha

data class EntityView(
    val entityId: String,
    val name: String,
    val domain: String,
    val role: EntityRole,
    val availability: String,
    val values: NormalizedState,
    val capabilities: List<DeviceCapability>,
)

data class ThingView(
    val id: String,
    val name: String,
    val nameSource: String,
    val sourceName: String,
    val kind: ThingKind,
    val areaId: String?,
    val hidden: Boolean,
    val manufacturer: String?,
    val model: String?,
    val hubThingId: String?,
    val available: Boolean,
    val primary: EntityView?,
    val others: List<EntityView>,
    val controls: List<EntityView>,
    val facets: List<FacetValue>,
    val sensors: List<EntityView>,
    val diagnosticCount: Int,
    val diagnostics: List<EntityView>? = null,
)

object Presentation {
    fun presentThing(thing: Thing, lookup: (String) -> EntityProjection?, canSee: (String) -> Boolean, includeDiagnostics: Boolean = false): ThingView? {
        if (thing.primary != null && !canSee(thing.primary.entityId)) return null
        val primary = if (thing.primary != null && canSee(thing.primary.entityId)) thing.primary else null
        val others = thing.others.filter { canSee(it.entityId) }
        val controls = thing.controls.filter { canSee(it.entityId) }
        val sensors = thing.sensors.filter { canSee(it.entityId) }
        val facetEntities = thing.facets.filter { canSee(it.entityId) }
        val diagnostics = thing.diagnostics.filter { canSee(it.entityId) }
        val anyVisible = primary != null || others.isNotEmpty() || controls.isNotEmpty() || sensors.isNotEmpty() || facetEntities.isNotEmpty()
        if (!anyVisible) return null

        val entityView = { e: ThingEntity ->
            val p = lookup(e.entityId)
            EntityView(e.entityId, e.name, e.domain, e.role, p?.availability ?: "unknown", p?.normalized ?: emptyMap(), e.capabilities)
        }
        val facets = FacetValues.describeThingFacets(thing.copy(facets = facetEntities), lookup)
        val main = primary ?: others.firstOrNull() ?: controls.firstOrNull()
        val mainView = main?.let { entityView(it) }

        return ThingView(
            id = thing.id, name = thing.name, nameSource = thing.nameSource, sourceName = thing.sourceName,
            kind = thing.kind, areaId = thing.areaId, hidden = thing.hidden,
            manufacturer = thing.manufacturer, model = thing.model, hubThingId = thing.hubThingId,
            available = mainView?.availability != "unavailable",
            primary = primary?.let { entityView(it) },
            others = others.map { entityView(it) },
            controls = controls.map { entityView(it) },
            facets = facets,
            sensors = sensors.map { entityView(it) },
            diagnosticCount = diagnostics.size,
            diagnostics = if (includeDiagnostics) diagnostics.map { entityView(it) } else null,
        )
    }

    fun matchesQuery(thing: Thing, q: String): Boolean {
        val hay = "${thing.name} ${thing.aliases.joinToString(" ")}".lowercase()
        return q.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }.all { hay.contains(it) }
    }
}
