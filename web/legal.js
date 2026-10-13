"use strict";
(() => {
  const modal = document.getElementById("legalModal");
  const open = document.getElementById("btnOpenLegal");
  const close = document.getElementById("btnCloseLegal");
  const select = document.getElementById("legalDocument");
  const status = document.getElementById("legalStatus");
  const output = document.getElementById("legalText");
  if (!modal || !open || !close || !select || !status || !output) return;
  const allowed = new Set(Array.from(select.options, option => option.value));
  let previousFocus = null;
  async function load() {
    const name = select.value;
    if (!allowed.has(name)) return;
    output.textContent = "";
    status.textContent = "Memuat dokumen…";
    try {
      const response = await fetch("/licenses/third_party/" + name, { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const body = await response.text();
      if (body.length > 300000) throw new Error("Dokumen melebihi batas tampilan");
      output.textContent = body;
      status.textContent = "Dokumen tersedia.";
    } catch {
      status.textContent = "Dokumen tidak tersedia. Periksa paket lisensi aplikasi.";
    }
  }
  open.addEventListener("click", () => {
    previousFocus = document.activeElement;
    modal.style.display = "flex";
    select.focus();
    void load();
  });
  close.addEventListener("click", () => {
    modal.style.display = "none";
    previousFocus?.focus();
  });
  select.addEventListener("change", () => void load());
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") close.click();
  });
})();
