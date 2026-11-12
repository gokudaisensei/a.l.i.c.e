package alice.server.favorites

import alice.core.db.Database
import alice.core.ids.Ids

class FavoritesService(private val database: Database) {
    fun idsFor(userId: String, connectionId: String = alice.ha.Connections.DEFAULT_ID): List<String> =
        database.read { identityQueries.selectFavoritesByUser(userId).executeAsList() }
            .filter { it.connection_id == connectionId }
            .map { it.ref }

    fun save(userId: String, items: List<Pair<String, String>>) {
        database.write {
            identityQueries.deleteAllFavoritesByUser(userId)
            items.forEachIndexed { idx, (connectionId, ref) ->
                identityQueries.insertFavorite(userId, connectionId, ref, idx.toLong())
            }
        }
    }
}
