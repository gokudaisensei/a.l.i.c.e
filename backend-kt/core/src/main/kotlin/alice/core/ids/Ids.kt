package alice.core.ids

import com.github.f4b6a3.ulid.UlidCreator

/**
 * ULIDs, prefixed by type in code (`usr_...`, `cmd_...`) exactly like the
 * existing backend.
 *
 * The generator is monotonic within a process, which removes the
 * same-millisecond ordering caveat (L36) that needed rowid tie-breaks on every
 * ordered table in the TypeScript backend.
 */
object Ids {
    fun next(type: String? = null): String {
        val ulid = UlidCreator.getMonotonicUlid().toString()
        return if (type.isNullOrBlank()) ulid else "${type}_$ulid"
    }
}
