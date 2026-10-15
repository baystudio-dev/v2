"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join,resolve}=require("node:path");
const root=resolve(__dirname,"../..");
const read=p=>readFileSync(join(root,p),"utf8");
test("Target-36 WebView parent reserves status bar, cutout, gesture bar, and IME once",()=>{
  const main=read("android/app/src/main/java/com/bossbayu/aiteam/MainActivity.kt");
  const xml=read("android/app/src/main/res/layout/activity_main.xml");
  assert.match(xml,/android:id="@\+id\/rootLayout"/);
  assert.match(main,/WindowCompat\.setDecorFitsSystemWindows\(window, false\)/);
  assert.match(main,/ViewCompat\.setOnApplyWindowInsetsListener\(root\)/);
  assert.match(main,/WindowInsetsCompat\.Type\.systemBars\(\) or WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(main,/WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(main,/insets\.isVisible\(WindowInsetsCompat\.Type\.ime\(\)\)/);
  assert.match(main,/maxOf\(bars\.bottom, ime\.bottom\)/);
  assert.match(main,/target\.setPadding\(bars\.left, bars\.top, bars\.right, bottom\)/);
  assert.match(main,/WindowInsetsCompat\.CONSUMED/);
  assert.match(main,/ViewCompat\.requestApplyInsets\(root\)/);
  assert.doesNotMatch(main+Utils(xml),/fabTerminal|@\+id\/fabTerminal/);
});
function Utils(v){return v;}
test("Native terminal dialog reserves gesture bar and keyboard too",()=>{
  const src=read("android/app/src/main/java/com/bossbayu/aiteam/terminal/TerminalOverlayDialog.kt");
  assert.match(src,/WindowCompat\.setDecorFitsSystemWindows\(it, false\)/);
  assert.match(src,/WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(src,/WindowInsetsCompat\.Type\.systemBars\(\)/);
  assert.match(src,/ViewCompat\.requestApplyInsets\(content\)/);
});
test("Web shell sizes relative to native-safe WebView content, not duplicate safe area",()=>{
  const html=read("web/index.html");
  const css=read("web/mobile-touch-insets.css");
  assert.match(html,/mobile-touch-insets\.css\?v=1/);
  assert.match(css,/height: 100dvh/);
  assert.match(css,/\.chat-main\.mobile-open\s*\{[^}]*pointer-events: auto/s);
  assert.match(css,/\.chat-main\s*\{[^}]*pointer-events: none/s);
  assert.match(css,/\.nav-rail\s*\{[^}]*flex: 0 0 62px/s);
  assert.match(css,/\.sidebar-panel\s*\{[^}]*min-height: 0/s);
  assert.doesNotMatch(css,/env\(safe-area-inset-(?:top|bottom)\)/);
});
test("Every exposed key menu action has one meaningful route and error feedback",()=>{
  const app=read("web/app.js");
  const html=read("web/index.html");
  assert.doesNotMatch(html,/<button[^>]+id="tabVaultCodex"/);
  assert.match(html,/<span[^>]+id="tabVaultCodex"/);
  assert.ok(app.includes('if (tab === "terminal")'),"nav terminal handled via data-tab");
  assert.doesNotMatch(app,/getElementById\("tabTerminal"\)\?\.addEventListener/);
  assert.match(app,/openTerminalModal\(\);\s*showToast\("Terminal native hanya tersedia dalam APK Android\."\)/);
  assert.match(app,/Pengaturan belum tersimpan/);
  assert.match(app,/saveButton\.disabled = false/);
  assert.match(app,/Gagal memeriksa workstation/);
});
