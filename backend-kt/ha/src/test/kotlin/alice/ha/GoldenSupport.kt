package alice.ha

import java.io.File
import kotlin.test.assertEquals

internal object GoldenSupport {
    fun assertGolden(name: String, actual: String) {
        val file = File("src/test/resources/golden/$name")
        if (System.getenv("GOLDEN_WRITE") == "1") {
            file.parentFile.mkdirs()
            file.writeText(actual.trimEnd('\n') + "\n")
            // Never pass silently after rewriting a golden: someone has to look at the diff.
            error("golden $name was rewritten because GOLDEN_WRITE=1 is set; review the change and run again without it")
        }
        check(file.isFile) { "missing golden $file; run with GOLDEN_WRITE=1 once" }
        assertEquals(file.readText().trimEnd('\n'), actual.trimEnd('\n'), "golden $name changed")
    }
}
