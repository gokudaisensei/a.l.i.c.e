package com.alice.home.ui.home

import com.alice.home.data.HouseholdState

/**
 * Everything the home screen draws. The shared household snapshot plus only the state this screen
 * owns — the split is deliberate: household data is never copied per screen, screen state never
 * leaks into the repository.
 */
data class HomeUiState(
    val household: HouseholdState = HouseholdState(),
    val activityOpen: Boolean = false,
    /** Arranging the favourites: cards show outlines, and the selected one has dots to drag. */
    val editMode: Boolean = false,
    val selectedId: String? = null,
    /** The size each favourite has been given; absent means 1×1. Kept with the screen, so it survives rotation. */
    /** The order of the favourites after cards were moved aside to make room; ids missing here keep their natural place at the end. */
    val order: List<String> = emptyList(),
    val sizes: Map<String, com.alice.home.ui.components.DeviceCardSize> = emptyMap(),
    val toast: String? = null,
)
