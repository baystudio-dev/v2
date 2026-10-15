package com.bossbayu.aiteam

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.io.File
import androidx.core.content.ContextCompat
import com.bossbayu.aiteam.runtime.BootstrapInstaller
import com.bossbayu.aiteam.runtime.PRootManager
import com.bossbayu.aiteam.runtime.WorkstationManager
import com.bossbayu.aiteam.service.EngineForegroundService
import com.bossbayu.aiteam.terminal.TerminalOverlayDialog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingOverlay: LinearLayout
    private lateinit var tvLoadingStatus: TextView

    private lateinit var workstationManager: WorkstationManager
    private lateinit var prootManager: PRootManager

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var nativeBackDispatchPending = false

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        fileUploadCallback?.onReceiveValue(uris?.toTypedArray())
        fileUploadCallback = null
    }

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // WebView callbacks handle permission results.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Target SDK 36 draws behind system bars; reserve actual system/keyboard
        // insets in the native parent rather than guessing status/nav bar heights in CSS.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        setContentView(R.layout.activity_main)
        applySystemBarAndImeInsets()

        webView = findViewById(R.id.webView)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        tvLoadingStatus = findViewById(R.id.tvLoadingStatus)

        workstationManager = WorkstationManager(this)
        prootManager = PRootManager(this)

        requestRequiredPermissions()
        setupWebView()
        setupBackHandler()

        val bootstrapInstaller = BootstrapInstaller(this)
        if (!bootstrapInstaller.isInstalled()) {
            tvLoadingStatus.text = "Mempersiapkan sistem untuk pertama kali..."
            bootstrapInstaller.installAsync(object : BootstrapInstaller.InstallCallback {
                override fun onProgress(percent: Int, message: String) {
                    runOnUiThread {
                        tvLoadingStatus.text = "$percent% - $message"
                    }
                }

                override fun onComplete() {
                    runOnUiThread {
                        startEngineService()
                        waitForServerAndLoad()
                    }
                }

                override fun onError(error: String) {
                    runOnUiThread {
                        tvLoadingStatus.text = "Gagal ekstraksi aset: $error"
                    }
                }
            })
        } else {
            startEngineService()
            waitForServerAndLoad()
        }
    }

    private fun applySystemBarAndImeInsets() {
        val root = findViewById<View>(R.id.rootLayout)
        ViewCompat.setOnApplyWindowInsetsListener(root) { target, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                maxOf(bars.bottom, ime.bottom)
            } else {
                bars.bottom
            }
            if (target.paddingLeft != bars.left || target.paddingTop != bars.top ||
                target.paddingRight != bars.right || target.paddingBottom != bottom
            ) {
                target.setPadding(bars.left, bars.top, bars.right, bottom)
            }
            // The child WebView already resides inside the protected content area.
            // Do not let it or the embedded CSS apply the same native inset twice.
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun requestRequiredPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissionLauncher.launch(permissions.toTypedArray())
    }

    private fun startEngineService() {
        EngineForegroundService.startService(this)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Auto-grant microphone for Voice Notes & WhatsApp Calls
            override fun onPermissionRequest(request: PermissionRequest?) {
                request ?: return
                runOnUiThread {
                    val allowed = request.resources.filter { resource ->
                        when (resource) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                                ContextCompat.checkSelfPermission(
                                    this@MainActivity,
                                    Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED

                            PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                                ContextCompat.checkSelfPermission(
                                    this@MainActivity,
                                    Manifest.permission.CAMERA
                                ) == PackageManager.PERMISSION_GRANTED

                            else -> false
                        }
                    }

                    if (allowed.isNotEmpty()) {
                        request.grant(allowed.toTypedArray())
                    } else {
                        request.deny()
                    }
                }
            }

            // File upload intent for chat attachments
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                filePickerLauncher.launch("*/*")
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Hide splash overlay once loaded
                loadingOverlay.visibility = View.GONE
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: ""
                if (isLocalAppUrl(url)) {
                    return false
                }
                // Open external links (e.g. OpenAI / Google device auth) in external browser
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                startActivity(intent)
                return true
            }
        }
        // Inisialisasi NativeBridge dua arah
        webView.addJavascriptInterface(com.bossbayu.aiteam.bridge.NativeBridge(this, this), "AndroidBridge")
    }

    fun showTerminalOverlay(sessionType: String = "alpine") {
        workstationManager.switchWorkstation(sessionType)
        val dialog = TerminalOverlayDialog(this, workstationManager, prootManager)
        dialog.show()
    }

    private fun isLocalAppUrl(url: String?): Boolean {
        val uri = url?.let(Uri::parse) ?: return false
        return uri.scheme == "http" && uri.port == 3000 && uri.userInfo == null &&
            (uri.host == "127.0.0.1" || uri.host == "localhost")
    }

    fun getAntigravityInstallStatus(): String {
        val state = when {
            !workstationManager.isUbuntuInstalled() -> "requires_ubuntu"
            !prootManager.isPRootInstalled() ||
                !com.bossbayu.aiteam.runtime.RootfsShellValidator.hasShell(workstationManager.ubuntuDir) -> "runtime_unavailable"
            File(workstationManager.ubuntuDir, "root/.local/bin/agy").isFile -> "binary_found"
            else -> "not_installed"
        }
        return JSONObject().apply {
            put("state", state)
            put("canInstall", state == "not_installed" || state == "binary_found")
            put("integrationEnabled", false)
        }.toString()
    }

    fun showAntigravityInstaller() {
        // Native confirmation remains mandatory even if a WebView frame calls the bridge.
        if (isFinishing || isDestroyed || !isLocalAppUrl(webView.url)) return
        val status = JSONObject(getAntigravityInstallStatus())
        if (!status.optBoolean("canInstall")) {
            AlertDialog.Builder(this)
                .setTitle("Ubuntu belum siap")
                .setMessage("Antigravity memerlukan shell Ubuntu dan PRoot yang kompatibel. Installer Ubuntu pada build ini belum diaktifkan. Tidak ada perintah yang dijalankan di Alpine.")
                .setPositiveButton("Mengerti", null).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Siapkan instalasi Antigravity?")
            .setMessage("Terminal Ubuntu akan dibuka dengan perintah unduhan resmi Google. Tinjau perintah, lalu tekan kirim untuk menjalankan. Login dan integrasi agent tidak diaktifkan. Lingkungan utama tidak akan diganti.")
            .setNegativeButton("Batal", null)
            .setPositiveButton("Buka terminal") { _, _ ->
                if (!JSONObject(getAntigravityInstallStatus()).optBoolean("canInstall")) return@setPositiveButton
                try {
                    val script = assets.open("web/antigravity-install.sh").bufferedReader().use { it.readText() }
                    check(script.startsWith("#!/bin/sh\n") && script.length <= 7000)
                    val command = "/bin/sh -c '" + script.replace("'", "'\\''") + "'"
                    check(command.length <= 8192)
                    val dialog = TerminalOverlayDialog(
                        this, workstationManager, prootManager,
                        requestedRootfs = workstationManager.ubuntuDir,
                        initialCommand = command,
                        workstationLabel = "Ubuntu · Antigravity"
                    )
                    dialog.setOnDismissListener {
                        if (!isDestroyed && isLocalAppUrl(webView.url)) {
                            webView.evaluateJavascript("window.dispatchEvent(new Event('antigravity:refresh'))", null)
                        }
                    }
                    dialog.show()
                } catch (_: Exception) {
                    AlertDialog.Builder(this).setTitle("Terminal belum dapat dibuka")
                        .setMessage("Perintah instalasi atau runtime tidak tersedia. Tidak ada instalasi yang dijalankan.")
                        .setPositiveButton("Mengerti", null).show()
                }
            }.show()
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val content = findViewById<View>(R.id.rootLayout)
                val insets = ViewCompat.getRootWindowInsets(content)
                if (insets?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                    // First Back hides Gboard/IME; leave the typed draft untouched.
                    WindowCompat.getInsetsController(window, content)
                        .hide(WindowInsetsCompat.Type.ime())
                    return
                }
                if (nativeBackDispatchPending) return
                if (!isLocalAppUrl(webView.url)) {
                    navigateBackOrBackground()
                    return
                }
                nativeBackDispatchPending = true
                try {
                    webView.evaluateJavascript(
                        "(function(){return !!(window.WhatsAppAgentBack && window.WhatsAppAgentBack());})()"
                    ) { handled ->
                        nativeBackDispatchPending = false
                        if (handled != "true" && !isFinishing && !isDestroyed) {
                            navigateBackOrBackground()
                        }
                    }
                } catch (_: Exception) {
                    nativeBackDispatchPending = false
                    navigateBackOrBackground()
                }
            }
        })
    }

    private fun navigateBackOrBackground() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Keep local engines alive if the user exits the main chat screen.
            moveTaskToBack(true)
        }
    }

    private fun waitForServerAndLoad() {
        CoroutineScope(Dispatchers.Main).launch {
            tvLoadingStatus.text = "Menunggu server lokal siap..."
            var isUp = false
            var attempts = 0

            while (!isUp && attempts < 40) {
                isUp = kotlinx.coroutines.withContext(Dispatchers.IO) {
                    try {
                        val conn = URL("http://127.0.0.1:3000/api/status").openConnection() as HttpURLConnection
                        conn.connectTimeout = 800
                        conn.readTimeout = 800
                        conn.responseCode == 200
                    } catch (e: Exception) {
                        false
                    }
                }
                if (!isUp) {
                    delay(500)
                    attempts++
                }
            }

            if (!isUp) {
                tvLoadingStatus.text =
                    "Runtime lokal belum siap. Pastikan runtime pack Android (Node.js, PRoot, rootfs, dan engine) sudah tersedia."
                return@launch
            }

            tvLoadingStatus.text = "Memuat antarmuka Tim AI..."
            webView.loadUrl("http://127.0.0.1:3000")
        }
    }
}
