package com.alice.home.di

import com.alice.home.data.AliceRepository
import com.alice.home.data.mock.MockAliceRepository

/**
 * The app's object graph, in one place.
 *
 * Deliberately hand-rolled: there is exactly one dependency today, and the data layer is still a
 * mock. Replace with Hilt (or Koin) when there are enough bindings to justify it — see
 * `android/docs/architecture.md` §11.
 */
object AppGraph {
    val repository: AliceRepository by lazy { MockAliceRepository() }
}
