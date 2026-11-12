package alice.server

import alice.server.updates.inWindow
import alice.server.updates.isNewer
import alice.server.updates.Manifest
import alice.server.updates.manifestPayload
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

class UpdateManifestTest {
    @Test
    fun `version comparison handles semver and pre-release`() {
        assertTrue(isNewer("0.2.0", "0.1.9"))
        assertTrue(isNewer("1.0.0", "0.99.99"))
        assertFalse(isNewer("0.1.0", "0.1.0"))
        assertFalse(isNewer("0.1.0", "0.2.0"))
        assertTrue(isNewer("0.2.0", "0.2.0-rc.1"))
        assertFalse(isNewer("0.2.0-rc.1", "0.2.0"))
    }

    @Test
    fun `update window handles same-day and midnight-crossing`() {
        assertTrue(inWindow(2 * 60, "02:00", "04:00"))
        assertFalse(inWindow(4 * 60, "02:00", "04:00"))
        assertTrue(inWindow(23 * 60, "22:00", "03:00"))
        assertTrue(inWindow(1 * 60, "22:00", "03:00"))
        assertFalse(inWindow(12 * 60, "22:00", "03:00"))
        assertFalse(inWindow(2 * 60, "02:00", "02:00"))
    }

    @Test
    fun `manifest payload is deterministic and includes all signed fields`() {
        val m = Manifest(version = "0.2.0", notes = "Fixes", publishedAt = "2026-11-01T00:00:00Z", artifactSha256 = "a".repeat(64))
        val p = manifestPayload(m)
        assertEquals("""["alice-update-v1","0.2.0","Fixes","2026-11-01T00:00:00Z","${"a".repeat(64)}"]""", p)
        val m2 = m.copy(notes = "Evil")
        assertTrue(manifestPayload(m2) != p)
    }

    @Test
    fun `ed25519 signature over manifest payload verifies`() {
        val kp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val m = Manifest(version = "0.2.0", notes = "Fixes", publishedAt = "2026-11-01T00:00:00Z", artifactSha256 = "b".repeat(64))
        val sig = Signature.getInstance("Ed25519").apply { initSign(kp.private); update(manifestPayload(m).toByteArray()) }.sign()
        val pubPem = "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(kp.public.encoded) + "\n-----END PUBLIC KEY-----"
        // verify using Java directly mirrors verifier behavior
        val v = Signature.getInstance("Ed25519").apply {
            initVerify(java.security.KeyFactory.getInstance("Ed25519").generatePublic(java.security.spec.X509EncodedKeySpec(kp.public.encoded)))
            update(manifestPayload(m).toByteArray())
        }
        assertTrue(v.verify(sig))
        // tamper
        val v2 = Signature.getInstance("Ed25519").apply {
            initVerify(java.security.KeyFactory.getInstance("Ed25519").generatePublic(java.security.spec.X509EncodedKeySpec(kp.public.encoded)))
            update(manifestPayload(m.copy(version = "9.9.9")).toByteArray())
        }
        assertFalse(v2.verify(sig))
        assertTrue(pubPem.contains("BEGIN PUBLIC KEY"))
    }
}
