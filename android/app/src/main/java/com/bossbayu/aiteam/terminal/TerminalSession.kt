package com.bossbayu.aiteam.terminal

import android.util.Log
import com.bossbayu.aiteam.runtime.PRootManager
import com.bossbayu.aiteam.runtime.WorkstationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import java.io.BufferedWriter
import java.io.File
import java.io.InputStream
import java.io.OutputStreamWriter

/**
 * A bounded, pipe-backed shell session, not a PTY. A closed session is never
 * restarted; create a new TerminalSession when reopening the terminal.
 */
class TerminalSession(
    private val workstationManager: WorkstationManager,
    private val prootManager: PRootManager,
    private val feedbackManager: TerminalFeedbackManager? = null,
    private val requestedRootfs: File? = null,
    private val onOutput: (String) -> Unit
) {
    private enum class State { NEW, STARTING, RUNNING, FINISHED, CLOSED }

    private val sessionScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val processLock = Any()
    private val pendingCommands = Channel<String>(capacity = 32)
    private var state = State.NEW
    private var process: Process? = null

    companion object {
        private const val TAG = "TerminalSession"
        private const val MAX_COMMAND_CHARS = 8192
        private const val STARTUP_MARKER = "CP16_TERMINAL_SHELL_STARTED"
    }

    fun start() {
        val shouldStart = synchronized(processLock) {
            if (state == State.NEW) {
                state = State.STARTING
                true
            } else {
                false
            }
        }
        if (!shouldStart) return

        sessionScope.launch {
            var localProcess: Process? = null
            var localWriter: BufferedWriter? = null
            var pump: Job? = null
            try {
                check(prootManager.isPRootInstalled()) {
                    "PRoot belum tersedia untuk ABI perangkat ini."
                }
                val rootfs = requestedRootfs ?: workstationManager.getActiveRootfs()
                val shellCmd = prootManager.buildCommand(
                    rootfsDir = rootfs,
                    command = listOf("/bin/sh"),
                    budiWorkspace = workstationManager.budiWorkspace,
                    rianWorkspace = workstationManager.rianWorkspace
                )
                val pb = ProcessBuilder(shellCmd)
                pb.directory(workstationManager.budiWorkspace)
                pb.environment().putAll(prootManager.runtimeEnvironment())
                pb.environment()["TERM"] = "dumb"
                pb.environment()["PS1"] = "$ "
                pb.redirectErrorStream(true)

                val proc = pb.start()
                localProcess = proc
                // close() may have won while ProcessBuilder.start() was blocking.
                val adopted = synchronized(processLock) {
                    if (state == State.CLOSED) false
                    else {
                        process = proc
                        true
                    }
                }
                if (!adopted) {
                    proc.destroy()
                    return@launch
                }

                val writer = BufferedWriter(OutputStreamWriter(proc.outputStream))
                localWriter = writer
                // Send synchronously, before starting the command pump.
                writer.write("printf '\\n$STARTUP_MARKER\\n'")
                writer.newLine()
                writer.flush()

                val canPump = synchronized(processLock) {
                    if (state == State.CLOSED) false
                    else {
                        state = State.RUNNING
                        true
                    }
                }
                if (!canPump) return@launch

                pump = sessionScope.launch {
                    try {
                        for (cmd in pendingCommands) {
                            writer.write(cmd)
                            writer.newLine()
                            writer.flush()
                        }
                    } catch (e: Exception) {
                        if (isActiveSession()) {
                            Log.w(TAG, "Terminal input pipe failed: ${e.message}", e)
                            emit("\n[Terminal tidak dapat mengirim perintah: ${e.message}]\n")
                            proc.destroy()
                        }
                    }
                }

                readStream(proc.inputStream)
                val exitCode = proc.waitFor()
                emit("\n[Terminal selesai (exit=$exitCode)]\n")
            } catch (e: Exception) {
                if (isActiveSession()) {
                    Log.e(TAG, "Failed to start terminal session: ${e.message}", e)
                    emit("\n[Gagal membuka terminal: ${e.message}]\n")
                }
            } finally {
                pendingCommands.close()
                pump?.cancel()
                synchronized(processLock) {
                    process = null
                    if (state != State.CLOSED) state = State.FINISHED
                }
                // Never flush or close a possibly blocked pipe on the UI thread.
                localProcess?.destroy()
                try {
                    localWriter?.close()
                } catch (e: Exception) {
                    Log.d(TAG, "Terminal pipe closed: ${e.message}")
                }
            }
        }
    }

    fun sendCommand(cmd: String) {
        if (cmd.length > MAX_COMMAND_CHARS) {
            emit("\n[Perintah terlalu panjang (maksimum $MAX_COMMAND_CHARS karakter).]\n")
            return
        }
        val accepted = synchronized(processLock) {
            (state == State.STARTING || state == State.RUNNING) &&
                pendingCommands.trySend(cmd).isSuccess
        }
        if (accepted) {
            feedbackManager?.onCommandStarted(cmd)
        } else {
            emit("\n[Perintah tidak terkirim: shell belum siap, antrean penuh, atau sudah berhenti.]\n")
        }
    }

    private fun isActiveSession(): Boolean = synchronized(processLock) {
        state != State.CLOSED
    }

    private fun emit(value: String) {
        if (isActiveSession()) onOutput(value)
    }

    private fun readStream(stream: InputStream) {
        val buffer = ByteArray(2048)
        while (true) {
            val count = stream.read(buffer)
            if (count == -1) break
            val text = String(buffer, 0, count)
            if (!isActiveSession()) break
            feedbackManager?.onOutputReceived(text)
            emit(text)
        }
    }

    fun close() {
        val proc = synchronized(processLock) {
            if (state == State.CLOSED) return
            state = State.CLOSED
            val owned = process
            process = null
            owned
        }
        pendingCommands.close()
        // Destroy before canceling readers and writers. Closing a pipe from
        // the UI thread may block indefinitely when the shell is stalled.
        proc?.destroy()
        sessionScope.cancel()
    }
}
