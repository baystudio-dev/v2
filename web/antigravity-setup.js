/* User-initiated official CLI setup, separate from managed agent access. */
(function (root, factory) {
  const setup = factory(root);
  if (typeof module === "object" && module.exports) module.exports = setup;
  else root.AntigravitySetup = setup;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  "use strict";
  const states = Object.freeze({
    web_preview: ["Pratinjau web", "Instalasi di perangkat hanya tersedia dalam aplikasi Android. Pratinjau ini tidak memiliki akses ke runtime HP."],
    requires_ubuntu: ["Ubuntu belum siap", "Ubuntu yang kompatibel belum tersedia. Installer Ubuntu pada build ini masih dinonaktifkan; Antigravity belum dapat dipasang dari perangkat ini."],
    runtime_unavailable: ["Runtime belum siap", "PRoot atau shell Ubuntu belum siap. Instalasi tidak akan dialihkan diam-diam ke Alpine."],
    not_installed: ["Belum terpasang", "Ubuntu dan PRoot ditemukan. Perintah resmi dapat ditinjau di terminal; kompatibilitas CLI tetap harus diuji."],
    binary_found: ["Binary ditemukan", "File agy ditemukan, tetapi versi, kompatibilitas, dan login belum terverifikasi. Periksa melalui terminal."],
    bridge_unavailable: ["Perlu APK terbaru", "Bridge instalasi belum tersedia pada APK ini. Perbarui APK untuk membuka jalur instalasi native."],
    error: ["Pemeriksaan gagal", "Status runtime tidak dapat diperiksa. Tekan Periksa ulang; tidak ada instalasi yang dijalankan."]
  });
  function getStatus(bridge) {
    if (!bridge) return { state: "web_preview", canInstall: false };
    if (typeof bridge.getAntigravityInstallStatus !== "function" || typeof bridge.openAntigravityInstaller !== "function") {
      return { state: "bridge_unavailable", canInstall: false };
    }
    try {
      const value = JSON.parse(bridge.getAntigravityInstallStatus());
      const state = Object.hasOwn(states, value?.state) ? value.state : "error";
      return { state, canInstall: value?.canInstall === true && ["not_installed", "binary_found"].includes(state) };
    } catch (_) { return { state: "error", canInstall: false }; }
  }
  const doc = root.document;
  const byId = id => doc?.getElementById(id);
  let command = "";
  let previousFocus;
  let bound = false;
  function refresh() {
    const status = getStatus(root.AndroidBridge);
    const [label, detail] = states[status.state];
    for (const id of ["antigravityStatusDetail", "antigravityInstallDetail"]) {
      const el = byId(id); if (el) el.textContent = detail;
    }
    const badge = byId("antigravityStatus"); if (badge) badge.textContent = label;
    const button = byId("btnLaunchAntigravityTerminal"); if (button) button.disabled = !status.canInstall;
    const install = byId("btnInstallAntigravity");
    if (install) install.textContent = status.state === "binary_found" ? "Periksa Antigravity" : "Instal Antigravity";
    return status;
  }
  async function loadCommand() {
    try {
      const res = await root.fetch("antigravity-install.sh", { cache: "no-store" });
      if (!res.ok) throw new Error("Perintah instalasi tidak tersedia.");
      const text = await res.text();
      if (!text.startsWith("#!/bin/sh\n") || text.length > 7000) throw new Error("Berkas perintah tidak valid.");
      command = text;
      byId("antigravityInstallCommand").textContent = command;
      byId("btnCopyAntigravityCommand").disabled = false;
    } catch (_) {
      command = "";
      byId("antigravityInstallCommand").textContent = "Perintah gagal dimuat. Tutup lalu buka kembali, atau baca panduan resmi.";
      byId("btnCopyAntigravityCommand").disabled = true;
    }
  }
  function open() {
    previousFocus = doc.activeElement;
    refresh();
    byId("antigravityInstallModal").style.display = "flex";
    byId("antigravityInstallNotice").textContent = "";
    byId("btnCloseAntigravityInstall").focus();
    loadCommand();
  }
  function close() {
    byId("antigravityInstallModal").style.display = "none";
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function bind() {
    if (bound || !byId("antigravityInstallModal")) return;
    bound = true;
    byId("btnInstallAntigravity").addEventListener("click", open);
    byId("btnRefreshAntigravity").addEventListener("click", refresh);
    byId("btnCloseAntigravityInstall").addEventListener("click", close);
    byId("antigravityInstallModal").addEventListener("click", e => { if (e.target.id === "antigravityInstallModal") close(); });
    byId("btnLaunchAntigravityTerminal").addEventListener("click", () => {
      if (!refresh().canInstall) return;
      try {
        root.AndroidBridge.openAntigravityInstaller();
        byId("antigravityInstallNotice").textContent = "Tinjau konfirmasi Android. Perintah belum dijalankan; kirim dari terminal untuk memulai.";
      } catch (_) { byId("antigravityInstallNotice").textContent = "Terminal gagal dibuka. Periksa runtime dan coba lagi."; }
    });
    byId("btnCopyAntigravityCommand").addEventListener("click", async () => {
      if (!command) return;
      try {
        await root.navigator.clipboard.writeText(command);
        byId("antigravityInstallNotice").textContent = "Perintah disalin. Jalankan hanya di Ubuntu yang kompatibel; bukan shell Android atau Alpine.";
      } catch (_) { byId("antigravityInstallNotice").textContent = "Clipboard tidak tersedia. Buka Lihat perintah instalasi untuk menyalin secara manual."; }
    });
    doc.addEventListener("keydown", e => {
      const modal = byId("antigravityInstallModal");
      if (modal.style.display === "none") return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      if (e.key !== "Tab") return;
      const nodes = [...modal.querySelectorAll('button:not(:disabled), a[href], summary, pre[tabindex]')].filter(el => el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }, true);
    root.addEventListener("antigravity:refresh", refresh);
    doc.addEventListener("visibilitychange", () => { if (!doc.hidden) refresh(); });
    refresh();
  }
  if (doc) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", bind);
    else bind();
  }
  return { getStatus, refresh, states };
});
