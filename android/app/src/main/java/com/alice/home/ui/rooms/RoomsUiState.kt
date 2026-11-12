package com.alice.home.ui.rooms

import com.alice.home.data.HouseholdState
import com.alice.home.domain.model.Device

/** How the catalogue is grouped: by the room a device is in, or by what kind of device it is. */
enum class GroupBy { Room, Type }

/** A brand's devices inside a type group (only when "then by brand" is on). */
data class RoomSection(val title: String, val devices: List<Device>)

data class RoomGroup(
    val title: String,
    val subtitle: String,
    val devices: List<Device>,
    /** Set when the group is split by brand; [devices] still holds all of them. */
    val sections: List<RoomSection>? = null,
)

data class RoomsUiState(
    val household: HouseholdState = HouseholdState(),
    val query: String = "",
    val groupBy: GroupBy = GroupBy.Room,
    /** Within a type group, split the devices by company. Only meaningful for [GroupBy.Type]. */
    val nestByBrand: Boolean = false,
    val voiceOnly: Boolean = false,
    /** The search field is open (it is an icon in the hero until tapped). */
    val searchOpen: Boolean = false,
    /** The view panel (group by, brand, voice filter) is open. */
    val viewOpen: Boolean = false,
    /** The group the list has settled on (open), by [groupKey]; null means the first. */
    val focus: String? = null,
    val toast: String? = null,
    val groups: List<RoomGroup> = emptyList(),
    val hidden: List<Device> = emptyList(),
    val roomCount: Int = 0,
    val totalCount: Int = 0,
    val voiceCount: Int = 0,
) {
    /** Anything narrowing the list: a search or the voice filter. */
    val filtering: Boolean get() = query.isNotBlank() || voiceOnly

    /** The view panel is hiding a non-default choice, so its icon shows a dot. */
    val viewChanged: Boolean get() = groupBy != GroupBy.Room || voiceOnly
}

/** Groups are keyed by the grouping plus the title, so room folds and type folds never mix. */
fun groupKey(groupBy: GroupBy, title: String) = "${groupBy.name}:$title"
