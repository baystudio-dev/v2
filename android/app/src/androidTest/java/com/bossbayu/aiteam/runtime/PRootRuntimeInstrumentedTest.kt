package com.bossbayu.aiteam.runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bossbayu.aiteam.terminal.TerminalSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Runs under the APK UID on a real emulator, using production PRootManager and TerminalSession.
 * Fixed read-only commands only. Does not write workspace data or expose HTTP execution.
 */
@RunWith(AndroidJUnit4::class)
class PRootRuntimeInstrumentedTest {
    @Test
    fun productionLauncherExecutesAlpineGuestCommand() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val workstations = WorkstationManager(context)
        workstations.ensureWorkstationsReady()
        val proot = PRootManager(context)
        assertTrue("PRoot native executable and loader missing", proot.isPRootInstalled())
        val result = proot.execute(
            rootfsDir = workstations.alpineDir,
            command = listOf("/bin/sh", "-c", "printf CP18_PROOT_MANAGER_PASS"),
            budiWorkspace = workstations.budiWorkspace,
            rianWorkspace = workstations.rianWorkspace
        )
        assertEquals("PRoot failed: ${result.stderr.take(500)}", 0, result.exitCode)
        assertTrue("No guest marker: ${result.stdout.take(500)}", result.stdout.contains("CP18_PROOT_MANAGER_PASS"))
    }

    @Test
    fun terminalSessionReceivesCommandAndCloses() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val workstations = WorkstationManager(context)
        workstations.ensureWorkstationsReady()
        val marker = "CP18_TERMINAL_INPUT_PASS"
        val ready = CountDownLatch(1)
        val latch = CountDownLatch(1)
        val output = StringBuilder()
        val session = TerminalSession(workstations, PRootManager(context), null) { text ->
            synchronized(output) {
                output.append(text.take(2048))
                if (output.contains("CP16_TERMINAL_SHELL_STARTED")) ready.countDown()
                if (output.contains(marker)) latch.countDown()
            }
        }
        try {
            session.start()
            // Fixed command is queued by the same IO coroutine scope as startup.
            assertTrue("Guest shell never produced startup marker", ready.await(25, TimeUnit.SECONDS))
            session.sendCommand("printf $marker")
            assertTrue("No terminal output: ${synchronized(output) { output.toString().takeLast(700) }}",
                latch.await(25, TimeUnit.SECONDS))
        } finally {
            session.close()
        }
    }

    @Test
    fun multipleCommandsInOrderAndExitAreObserved() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val workstation = WorkstationManager(context)
        workstation.ensureWorkstationsReady()
        val ready = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val transcript = StringBuilder()
        val terminal = TerminalSession(workstation, PRootManager(context), null) { chunk ->
            synchronized(transcript) {
                transcript.append(chunk.take(2048))
                if (transcript.contains("CP16_TERMINAL_SHELL_STARTED")) ready.countDown()
                if (transcript.contains("Terminal selesai (exit=0)")) finished.countDown()
            }
        }
        try {
            terminal.start()
            assertTrue("Startup timeout", ready.await(25, TimeUnit.SECONDS))
            for (index in 1..8) {
                terminal.sendCommand("printf 'CP19_STEP_${index}\n'")
            }
            terminal.sendCommand("exit 0")
            assertTrue("Shell did not exit", finished.await(25, TimeUnit.SECONDS))
            val result = synchronized(transcript) { transcript.toString() }
            var offset = 0
            for (index in 1..8) {
                val marker = "CP19_STEP_$index"
                val next = result.indexOf(marker, offset)
                assertTrue("Missing/out-of-order command: $marker", next >= offset)
                offset = next + marker.length
            }
        } finally {
            terminal.close()
        }
    }

    @Test
    fun immediateCloseDoesNotResurrectSessionAndNewSessionWorks() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val workstation = WorkstationManager(context)
        workstation.ensureWorkstationsReady()
        val oldSession = TerminalSession(workstation, PRootManager(context), null) {}
        oldSession.start()
        oldSession.close()
        oldSession.sendCommand("printf CP19_CLOSED_MUST_NOT_RUN")
        oldSession.start()

        val ready = CountDownLatch(1)
        val observed = CountDownLatch(1)
        val reopened = TerminalSession(workstation, PRootManager(context), null) { chunk ->
            if (chunk.contains("CP16_TERMINAL_SHELL_STARTED")) ready.countDown()
            if (chunk.contains("CP19_REOPENED_PASS")) observed.countDown()
        }
        try {
            reopened.start()
            assertTrue("Reopened shell startup timed out", ready.await(25, TimeUnit.SECONDS))
            reopened.sendCommand("printf CP19_REOPENED_PASS")
            assertTrue("Reopened shell did not execute", observed.await(25, TimeUnit.SECONDS))
        } finally {
            reopened.close()
        }
    }

}
