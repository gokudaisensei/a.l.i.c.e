package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

fun homeRaw(): RawDiscovery {
    val MAC = listOf(listOf("mac", "aa:bb:cc:dd:ee:01"))
    return RawDiscovery(
        areas = listOf(
            HaAreaRegistryEntry("kitchen", "Kitchen"),
            HaAreaRegistryEntry("living", "Living room"),
            HaAreaRegistryEntry("hall", "Hall"),
        ),
        devices = listOf(
            HaDeviceRegistryEntry("echo", "Echo Show", area_id = "kitchen", manufacturer = "Amazon", model = "Echo Show 8", identifiers = listOf(listOf("esphome", "echo01")), connections = MAC),
            HaDeviceRegistryEntry("echo_alexa", "Kitchen display (Alexa)", area_id = "kitchen", identifiers = listOf(listOf("alexa_media", "G090")), connections = MAC),
            HaDeviceRegistryEntry("hue_bridge", "Hue Bridge", manufacturer = "Signify", identifiers = listOf(listOf("hue", "bridge"))),
            HaDeviceRegistryEntry("floor", "Living room Floor lamp", area_id = "living", via_device_id = "hue_bridge", identifiers = listOf(listOf("hue", "b1"))),
            HaDeviceRegistryEntry("ceiling", "Ceiling lights", area_id = "living", via_device_id = "hue_bridge", identifiers = listOf(listOf("hue", "b2"))),
            HaDeviceRegistryEntry("kettle", "Kettle plug", area_id = "kitchen", manufacturer = "Tapo", identifiers = listOf(listOf("tapo", "k1"))),
            HaDeviceRegistryEntry("front_contact", "Front door sensor", area_id = "hall", identifiers = listOf(listOf("zha", "c1"))),
            HaDeviceRegistryEntry("sun", "Sun", entry_type = "service", identifiers = listOf(listOf("sun", "x"))),
        ),
        entityRegistry = listOf(
            HaEntityRegistryEntry("media_player.echo_show", "echo", "esphome", has_entity_name = false),
            HaEntityRegistryEntry("camera.echo_show_camera", "echo", "esphome", original_name = "Camera"),
            HaEntityRegistryEntry("switch.echo_show_microphone_mute", "echo", "esphome", original_name = "Microphone mute"),
            HaEntityRegistryEntry("number.echo_show_volume", "echo", "esphome", original_name = "Volume"),
            HaEntityRegistryEntry("binary_sensor.echo_show_camera_shutter", "echo", "esphome", original_name = "Camera shutter"),
            HaEntityRegistryEntry("sensor.echo_show_wifi_signal", "echo", "esphome", original_name = "WiFi signal", entity_category = "diagnostic"),
            HaEntityRegistryEntry("sensor.echo_show_uptime", "echo", "esphome", original_name = "Uptime", entity_category = "diagnostic"),
            HaEntityRegistryEntry("button.echo_show_restart", "echo", "esphome", original_name = "Restart", entity_category = "config"),
            HaEntityRegistryEntry("sensor.kitchen_display_next_alarm", "echo_alexa", "alexa_media", original_name = "Next alarm"),
            HaEntityRegistryEntry("button.hue_bridge_identify", "hue_bridge", "hue", original_name = "Identify", entity_category = "config"),
            HaEntityRegistryEntry("light.floor_lamp", "floor", "hue", name = null, original_name = null, has_entity_name = false),
            HaEntityRegistryEntry("light.ceiling_lights", "ceiling", "hue", name = null, original_name = null),
            HaEntityRegistryEntry("switch.kettle_plug", "kettle", "tapo", name = null, original_name = null),
            HaEntityRegistryEntry("sensor.kettle_plug_power", "kettle", "tapo", original_name = "Power"),
            HaEntityRegistryEntry("binary_sensor.front_door_sensor_door", "front_contact", "zha", original_name = "Door"),
            HaEntityRegistryEntry("sensor.front_door_sensor_battery", "front_contact", "zha", original_name = "Battery"),
            HaEntityRegistryEntry("sensor.sun_next_dawn", "sun", "sun", original_name = "Next dawn"),
            HaEntityRegistryEntry("input_boolean.movie_mode", null, "input_boolean", original_name = "Movie mode", has_entity_name = true),
            HaEntityRegistryEntry("sensor.outdoor_temp_2", null, "template", original_name = "outdoor_temp_2", has_entity_name = true),
        ),
        states = listOf(
            HaEntityState("media_player.echo_show", "idle", mapOf("friendly_name" to JsonPrimitive("Echo Show"))),
            HaEntityState("camera.echo_show_camera", "idle", mapOf("friendly_name" to JsonPrimitive("Echo Show Camera"))),
            HaEntityState("switch.echo_show_microphone_mute", "off", mapOf("friendly_name" to JsonPrimitive("Echo Show Microphone mute"))),
            HaEntityState("number.echo_show_volume", "40", mapOf("friendly_name" to JsonPrimitive("Echo Show Volume"), "min" to JsonPrimitive(0), "max" to JsonPrimitive(100))),
            HaEntityState("binary_sensor.echo_show_camera_shutter", "off", mapOf("friendly_name" to JsonPrimitive("Echo Show Camera shutter"))),
            HaEntityState("sensor.echo_show_wifi_signal", "-61", mapOf("friendly_name" to JsonPrimitive("Echo Show WiFi signal"), "device_class" to JsonPrimitive("signal_strength"), "unit_of_measurement" to JsonPrimitive("dBm"))),
            HaEntityState("sensor.echo_show_uptime", "12345", mapOf("friendly_name" to JsonPrimitive("Echo Show Uptime"))),
            HaEntityState("button.echo_show_restart", "unknown", mapOf("friendly_name" to JsonPrimitive("Echo Show Restart"))),
            HaEntityState("sensor.kitchen_display_next_alarm", "unknown", mapOf("friendly_name" to JsonPrimitive("Kitchen display (Alexa) Next alarm"))),
            HaEntityState("button.hue_bridge_identify", "unknown", mapOf("friendly_name" to JsonPrimitive("Hue Bridge Identify"))),
            HaEntityState("light.floor_lamp", "on", mapOf("friendly_name" to JsonPrimitive("Living room Floor lamp"), "supported_color_modes" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("brightness"))))),
            HaEntityState("light.ceiling_lights", "off", mapOf("friendly_name" to JsonPrimitive("Ceiling lights"), "supported_color_modes" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("brightness"))))),
            HaEntityState("switch.kettle_plug", "off", mapOf("friendly_name" to JsonPrimitive("Kettle plug"))),
            HaEntityState("sensor.kettle_plug_power", "0", mapOf("friendly_name" to JsonPrimitive("Kettle plug Power"), "device_class" to JsonPrimitive("power"), "unit_of_measurement" to JsonPrimitive("W"))),
            HaEntityState("binary_sensor.front_door_sensor_door", "off", mapOf("friendly_name" to JsonPrimitive("Front door sensor Door"), "device_class" to JsonPrimitive("door"))),
            HaEntityState("sensor.front_door_sensor_battery", "88", mapOf("friendly_name" to JsonPrimitive("Front door sensor Battery"), "device_class" to JsonPrimitive("battery"), "unit_of_measurement" to JsonPrimitive("%"))),
            HaEntityState("sensor.sun_next_dawn", "2026-11-06T00:00:00Z", mapOf("friendly_name" to JsonPrimitive("Sun Next dawn"), "device_class" to JsonPrimitive("timestamp"))),
            HaEntityState("input_boolean.movie_mode", "off", mapOf("friendly_name" to JsonPrimitive("Movie mode"))),
            HaEntityState("sensor.outdoor_temp_2", "21.5", mapOf("friendly_name" to JsonPrimitive("outdoor_temp_2"), "device_class" to JsonPrimitive("temperature"), "unit_of_measurement" to JsonPrimitive("°C"))),
        ),
    )
}

fun homeInventory() = buildInventory(homeRaw())
