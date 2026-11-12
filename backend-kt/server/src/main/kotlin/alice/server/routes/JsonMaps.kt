package alice.server.routes

import alice.server.commands.anyToJsonElement
import kotlinx.serialization.json.JsonObject

/** One conversion for the services that still answer with a plain map: keys keep their order, nulls stay null. */
internal fun Map<String, Any?>.toJsonObject(): JsonObject = JsonObject(mapValues { (_, v) -> anyToJsonElement(v) })
