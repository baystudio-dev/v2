package com.bossbayu.aiteam.terminal

import android.app.Dialog
import android.content.Context
import android.os.Bundle
import java.io.File
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ScrollView
import android.widget.TextView
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.bossbayu.aiteam.R
import com.bossbayu.aiteam.runtime.PRootManager
import com.bossbayu.aiteam.runtime.WorkstationManager

/**
 * Floating in-app terminal console overlay.
 */
class TerminalOverlayDialog(
    context: Context,
    private val workstationManager: WorkstationManager,
    private val prootManager: PRootManager,
    private val requestedRootfs: File? = null,
    private val initialCommand: String? = null,
    private val workstationLabel: String? = null
) : Dialog(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen) {

    private lateinit var tvOutput: TextView
    private lateinit var etCommand: EditText
    private lateinit var scrollTerminal: ScrollView
    private lateinit var tvTitle: TextView
    private var terminalSession: TerminalSession? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
        setContentView(R.layout.dialog_terminal)
        window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        // A fullscreen dialog must still respect gesture navigation and the IME.
        val content = findViewById<View>(android.R.id.content)
        if (content != null) {
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
                val bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                )
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                val bottom = if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    maxOf(bars.bottom, ime.bottom)
                } else {
                    bars.bottom
                }
                if (view.paddingLeft != bars.left || view.paddingTop != bars.top ||
                    view.paddingRight != bars.right || view.paddingBottom != bottom
                ) {
                    view.setPadding(bars.left, bars.top, bars.right, bottom)
                }
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(content)
        }

        tvTitle = findViewById(R.id.tvTerminalTitle)
        tvOutput = findViewById(R.id.tvTerminalOutput)
        etCommand = findViewById(R.id.etTerminalCommand)
        scrollTerminal = findViewById(R.id.scrollTerminal)

        val btnClear = findViewById<Button>(R.id.btnTerminalClear)
        val btnClose = findViewById<Button>(R.id.btnTerminalClose)
        val btnSend = findViewById<ImageButton>(R.id.btnTerminalSend)

        tvTitle.text = "Terminal Workstation (${workstationLabel ?: workstationManager.currentWorkstation.uppercase()})"
        initialCommand?.let {
            etCommand.setText(it)
            tvOutput.text = "Perintah instalasi disiapkan, belum dijalankan. Tinjau lalu tekan kirim untuk memulai. Tutup terminal untuk membatalkan.\n"
        }

        btnClear.setOnClickListener {
            tvOutput.text = ""
        }

        btnClose.setOnClickListener {
            dismiss()
        }

        btnSend.setOnClickListener {
            submitCommand()
        }

        etCommand.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitCommand()
                true
            } else {
                false
            }
        }

        val toolbar = findViewById<TerminalToolbar>(R.id.terminalToolbar)
        toolbar?.setKeyPressListener(object : TerminalToolbar.KeyPressListener {
            override fun onSpecialKeyPressed(keyName: String, sequence: ByteArray) {
                when (keyName) {
                    "ESC" -> terminalSession?.sendCommand(String(sequence))
                    "TAB" -> etCommand.append("  ")
                    "|" -> etCommand.append(" | ")
                    "/" -> etCommand.append("/")
                    "-" -> etCommand.append("-")
                    "~" -> etCommand.append("~")
                    else -> {
                        if (sequence.isNotEmpty()) {
                            terminalSession?.sendCommand(String(sequence))
                        }
                    }
                }
            }
        })

        startTerminal()
    }

    private fun startTerminal() {
        val feedbackManager = TerminalFeedbackManager(context)
        terminalSession = TerminalSession(workstationManager, prootManager, feedbackManager, requestedRootfs) { text ->
            tvOutput.post {
                tvOutput.append(text)
                scrollTerminal.fullScroll(ScrollView.FOCUS_DOWN)
            }
        }.apply {
            start()
        }
    }

    private fun submitCommand() {
        val cmd = etCommand.text.toString().trim()
        if (cmd.isNotEmpty()) {
            terminalSession?.sendCommand(cmd)
            etCommand.setText("")
        }
    }

    override fun onStop() {
        super.onStop()
        terminalSession?.close()
        terminalSession = null
    }
}
