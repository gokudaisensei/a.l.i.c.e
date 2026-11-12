package com.alice.home.ui.rooms

sealed interface RoomsEvent {
    data class SetQuery(val query: String) : RoomsEvent
    data class SetGroupBy(val groupBy: GroupBy) : RoomsEvent
    data object ToggleNestByBrand : RoomsEvent
    data object ToggleVoiceOnly : RoomsEvent
    data object ToggleSearch : RoomsEvent
    data object ToggleView : RoomsEvent
    data object ClearFilters : RoomsEvent

    /** The list settled on this group (see [groupKey]); kept so a rotation or a tab change returns to it. */
    data class Focus(val key: String) : RoomsEvent


    data class ToggleDevice(val id: String) : RoomsEvent
    data class CommitLevel(val id: String, val level: Int) : RoomsEvent
    data class ToggleFavourite(val id: String) : RoomsEvent
    data class ToggleVoice(val id: String) : RoomsEvent
    data class SetHidden(val id: String, val hidden: Boolean) : RoomsEvent

    // What the device popup can set (the same set Home offers)
    data class SetHvacMode(val id: String, val mode: String) : RoomsEvent
    data class SetOscillation(val id: String, val on: Boolean) : RoomsEvent
    data class SetColorTemp(val id: String, val kelvin: Int) : RoomsEvent
    data class SetColor(val id: String, val rgb: List<Int>) : RoomsEvent
    data class SetFanPreset(val id: String, val preset: String) : RoomsEvent

    data object Refresh : RoomsEvent
    data object DismissToast : RoomsEvent
}
