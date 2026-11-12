package alice.ha

import org.junit.jupiter.api.Test

class GoldenNamesTest {
    private fun r(v: String?) = v ?: "<null>"

    @Test
    fun `name cleaner output is pinned`() {
        val out = StringBuilder()
        val things = listOf(
            "" to null,
            "" to "Kitchen",
            "None" to null,
            "Kitchen None" to "Kitchen",
            "Kitchen Floor lamp" to "Kitchen",
            "Kitchenette lamp" to "Kitchen",
            "Living room TV" to "Living room",
            "living room floor lamp" to "Living room",
            "outdoor_temp_2" to null,
            "Bedroom 2" to null,
            "Bedroom 3" to null,
            "Bedroom 4" to null,
            "Bedroom 5" to null,
            "Bedroom 6" to null,
            "Bedroom 7" to null,
            "Bedroom 8" to null,
            "Bedroom 9" to null,
            "Bedroom 10" to null,
            "Bedroom 12" to null,
            "Kitchen - Light" to "Kitchen",
            "Kitchen _ Light" to "Kitchen",
            "Kitchen: Light" to "Kitchen",
            "Kitchen · Light" to "Kitchen",
            "Kitchen/Light" to "Kitchen",
            "  spaced   name  " to null,
            "ALL CAPS NAME" to null,
            "lower case" to null,
            "MiXeD Case" to null,
            "TV" to null,
            "living room tv" to "Living room",
            "Kitchen TV" to "Kitchen",
            "Kitchen" to "Kitchen",
            "Hall Front Door" to "Hall",
            "Front Door" to "Hall",
            "Floor lamp 2" to null,
            "Floor lamp 10" to null,
            "none" to null,
            "Light None" to null,
            "Kitchen Light None" to "Kitchen",
            "Kitchen - " to "Kitchen",
        )
        for ((name, area) in things) out.append("thing|").append(name).append('|').append(r(area)).append(" -> ").append(r(NameCleaner.cleanThingName(name, area))).append('\n')

        val entities = listOf(
            listOf("Echo Show Microphone mute", "Microphone mute", "true", "Echo Show", "Kitchen"),
            listOf("Echo Show", null, "true", "Echo Show", "Kitchen"),
            listOf("Living room Floor lamp", null, "false", null, "Living room"),
            listOf("Kitchen Floor lamp", "Floor lamp", "false", "Kitchen", "Kitchen"),
            listOf("Kitchen - Floor lamp", "Floor lamp", "false", "Kitchen", "Kitchen"),
            listOf("Kitchen_Light", "Light", "false", "Kitchen", "Kitchen"),
            listOf("Kitchen: Light", "Light", "false", "Kitchen", "Kitchen"),
            listOf("Kitchen · Light", "Light", "false", "Kitchen", "Kitchen"),
            listOf("", null, "false", null, null),
            listOf("None", null, "false", null, null),
            listOf("Device 2", null, "false", "Device", null),
            listOf("Device 10", null, "false", "Device", null),
            listOf("Device 12", null, "false", "Device", null),
            listOf("Area Device", "Device", "true", "Area", "Area"),
            listOf("Area Device", "Device", "true", null, "Area"),
            listOf("Area Device", "Device", "true", "Area", null),
            listOf("device name", "ENTITY NAME", "true", "Device Name", "Area"),
            listOf("Device Name", "Device Name", "true", "Device Name", null),
            listOf("  Device   Name  ", null, "false", null, null),
            listOf("all lower", "all lower", "true", "other", null),
            listOf("TV", null, "false", null, null),
            listOf("Living Room TV", null, "false", null, "Living Room"),
            listOf("Kitchen", "Kitchen", "true", "Kitchen", "Kitchen"),
            listOf("Kitchen - ", null, "false", null, null),
            listOf("Bedroom 2", null, "false", null, "Bedroom"),
        )
        for (e in entities) {
            val source = e[0]!!; val own = e[1]; val has = e[2]!!.toBoolean(); val device = e[3]; val area = e[4]
            out.append("entity|").append(source).append('|').append(r(own)).append('|').append(has).append('|').append(r(device)).append('|').append(r(area))
                .append(" -> ").append(r(NameCleaner.cleanEntityName(source, own, has, device, area))).append('\n')
        }
        GoldenSupport.assertGolden("names.txt", out.toString())
    }
}
