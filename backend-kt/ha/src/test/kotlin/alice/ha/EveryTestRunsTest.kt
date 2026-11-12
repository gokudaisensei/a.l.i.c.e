package alice.ha

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * JUnit silently skips a test method that returns anything other than Unit/void, which is easy to cause by ending a
 * `= runBlocking { ... }` test with an expression that has a value (`assertThrows`, `create(...)`). Four tests in this
 * code base went unrun for that reason. This test fails if any @Test method in this module returns a value.
 */
class EveryTestRunsTest {
    @Test
    fun `no test method returns a value`() {
        val root = File("build/classes/kotlin/test")
        assertTrue(root.isDirectory, "compiled tests not found at ${root.absolutePath}")
        val loader = Thread.currentThread().contextClassLoader
        val offenders = root.walkTopDown().filter { it.isFile && it.extension == "class" }.flatMap { file ->
            val name = file.relativeTo(root).path.removeSuffix(".class").replace(File.separatorChar, '.')
            val cls = runCatching { Class.forName(name, false, loader) }.getOrNull() ?: return@flatMap emptySequence()
            runCatching { cls.declaredMethods.toList() }.getOrDefault(emptyList())
                .filter { m -> m.annotations.any { it.annotationClass.qualifiedName == "org.junit.jupiter.api.Test" } && m.returnType != Void.TYPE }
                .map { "${cls.name}.${m(it)}" }.asSequence()
        }.toList()
        assertTrue(offenders.isEmpty(), "These tests return a value, so JUnit never runs them (end the body with Unit or use runBlocking<Unit>): $offenders")
    }

    private fun m(method: java.lang.reflect.Method) = method.name
}
