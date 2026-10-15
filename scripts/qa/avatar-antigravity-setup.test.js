"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const app = read("web/app.js");
const html = read("web/index.html");
const setup = require(path.join(root, "web/antigravity-setup.js"));
const script = read("web/antigravity-install.sh");
const native = p => read("android/app/src/main/java/com/bossbayu/aiteam/" + p);

test("every built-in identity uses accessible monogram markup", () => {
  const start = app.indexOf("const BUILTIN_AVATARS"), end = app.indexOf("// 3. WEB AUDIO");
  assert.ok(start >= 0 && end > start);
  const identities = vm.runInNewContext(app.slice(start, end) + "\n({ BUILTIN_AVATARS, CHAT_METADATA })");
  for (const [name, markup] of Object.entries(identities.BUILTIN_AVATARS)) {
    assert.match(markup, /class="avatar-monogram"/);
    assert.match(markup, /role="img" aria-label="[^"]+"/);
    assert.ok(markup.includes('data-avatar="' + name + '"'));
    assert.doesNotMatch(markup, /<svg|<img|linearGradient/);
  }
  for (const chat of Object.values(identities.CHAT_METADATA)) assert.match(chat.avatarMarkup, /avatar-monogram/);
  assert.doesNotMatch(app + html, /SVG_PORTRAITS|(?:bayu|budi|rian)-(?:skin|hair|suit|bg)/);
});

test("header, profile, stories and calls share the identity source", () => {
  for (const symbol of ["headerAvatar.innerHTML = meta.avatarMarkup", "avatarEl.innerHTML = meta.avatarMarkup", "BUILTIN_AVATARS.bayu", "BUILTIN_AVATARS.rian", "BUILTIN_AVATARS.budi"]) assert.ok(app.includes(symbol), symbol);
  assert.equal((html.match(/class="avatar-monogram"/g) || []).length, 7);
  const css = read("web/roster-identity.css");
  assert.match(css, /\.avatar-vector > \.avatar-monogram/);
  assert.doesNotMatch(css, /::after|> svg|display:\s*none/);
  assert.match(html, /roster-identity\.css\?v=2/);
  assert.match(html, /app\.js\?v=3\.3/);
});

for (const state of ["requires_ubuntu", "runtime_unavailable", "error", "web_preview"]) {
  test("setup fails closed for state " + state, () => {
    const result = setup.getStatus({ getAntigravityInstallStatus: () => JSON.stringify({state, canInstall:true}), openAntigravityInstaller() {} });
    assert.equal(result.canInstall, false);
  });
}

test("preview, old APK, malformed bridge and unknown state cannot become ready", () => {
  assert.equal(setup.getStatus().state, "web_preview");
  assert.equal(setup.getStatus({}).state, "bridge_unavailable");
  for (const payload of ["null", "broken", '{"state":"ready","canInstall":true}']) {
    assert.deepEqual(setup.getStatus({getAntigravityInstallStatus: () => payload, openAntigravityInstaller() {}}), {state:"error",canInstall:false});
  }
});

test("only compatible native states expose the fixed terminal action", () => {
  for (const state of ["not_installed", "binary_found"]) {
    assert.equal(setup.getStatus({getAntigravityInstallStatus: () => JSON.stringify({state,canInstall:true}),openAntigravityInstaller() {}}).canInstall, true);
    assert.equal(setup.getStatus({getAntigravityInstallStatus: () => JSON.stringify({state,canInstall:"true"}),openAntigravityInstaller() {}}).canInstall, false);
  }
});

test("Settings exposes installation and its limits before model selection", () => {
  for (const id of ["btnInstallAntigravity", "antigravityStatus", "antigravityInstallModal", "btnLaunchAntigravityTerminal", "btnCopyAntigravityCommand"]) assert.ok(html.includes('id="'+id+'"'));
  assert.ok(html.indexOf('id="antigravityTitle"') < html.indexOf('id="selectModelA"'));
  assert.match(html,/Login interaktif dan integrasi agent belum tersedia/);
  assert.match(html,/https:\/\/www\.antigravity\.google\/docs\/cli\/install\//);
  assert.match(app,/window\.AntigravitySetup\?\.refresh\(\)/);
});

test("native entry accepts no shell argument, confirms and pins Ubuntu", () => {
  const bridge = native("bridge/NativeBridge.kt"), activity = native("MainActivity.kt");
  assert.match(bridge, /fun openAntigravityInstaller\(\)/);
  assert.match(activity,/!isLocalAppUrl\(webView.url\)\) return/);
  assert.match(activity,/assets\.open\("web\/antigravity-install\.sh"\)/);
  assert.match(activity,/requestedRootfs = workstationManager\.ubuntuDir/);
  assert.match(activity,/\.setNegativeButton\("Batal", null\)/);
  assert.match(activity,/uri\.host == "127\.0\.0\.1"/);
  const installer = activity.slice(activity.indexOf("fun showAntigravityInstaller()"), activity.indexOf("private fun setupTerminalFab"));
  assert.doesNotMatch(installer,/switchWorkstation\(|sendCommand\(|\/api\/terminal/);
  assert.match(native("terminal/TerminalOverlayDialog.kt"),/etCommand\.setText\(it\)/);
  assert.match(native("terminal/TerminalSession.kt"),/requestedRootfs \?: workstationManager.getActiveRootfs\(\)/);
});

function runInstaller(options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-setup-test-"));
  const home = path.join(temp, "home"), bin = path.join(temp, "bin"), trace = path.join(temp, "trace");
  fs.mkdirSync(path.join(home, ".local/bin"), {recursive:true}); fs.mkdirSync(bin);
  const mock = (name, content) => fs.writeFileSync(path.join(bin,name), "#!/bin/sh\n"+content, {mode:0o700});
  mock("curl", `printf 'curl\\n' >> '${trace}'\nexit ${options.curlExit || 0}\n`);
  mock("bash", `printf 'bash %s\\n' "$*" >> '${trace}'\n${options.bashExit ? 'exit '+options.bashExit : `printf '#!/bin/sh\\nprintf version-ok\\n' > '${home}/.local/bin/agy'\nchmod +x '${home}/.local/bin/agy'`}\n`);
  if (options.existing) fs.writeFileSync(path.join(home,".local/bin/agy"), "#!/bin/sh\nprintf existing-version\nexit "+(options.versionExit||0)+"\n", {mode:0o700});
  const isolated = script.replace("export HOME=/root", `export HOME='${home}'`).replace(/^export PATH=.*$/m, `export PATH='${bin}:/usr/bin:/bin'`);
  try {
    const result = spawnSync("/bin/sh", ["-c", isolated], {encoding:"utf8",timeout:5000});
    return { ...result, log: fs.existsSync(trace) ? fs.readFileSync(trace,"utf8") : "" };
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

test("failed download never executes the installer", () => {
  const result = runInstaller({curlExit:22});
  assert.equal(result.status,22);assert.equal(result.log,"curl\n");
});

test("installer failure cannot be reported as success", () => {
  const result = runInstaller({bashExit:17});
  assert.equal(result.status,17);assert.doesNotMatch(result.stdout,/Version check passed/);
});

test("successful installer verifies version without enabling auth", () => {
  const result = runInstaller();
  assert.equal(result.status,0, result.stderr);assert.match(result.log,/--skip-aliases --skip-path/);
  assert.match(result.stdout,/version-ok/);assert.match(result.stdout,/Account login and agent integration are not enabled/);
});

test("existing working binary is checked without reinstalling", () => {
  const result = runInstaller({existing:true});
  assert.equal(result.status,0);assert.equal(result.log,"");assert.match(result.stdout,/existing-version/);
});

test("existing broken binary fails without overwriting user installation", () => {
  const result = runInstaller({existing:true,versionExit:5});
  assert.equal(result.status,5);assert.equal(result.log,"");
});

test("download is HTTPS-only and bounded, not directly piped into a shell", () => {
  assert.match(script,/--proto '=https' --proto-redir '=https'/);
  assert.match(script,/--connect-timeout 15 --max-time 120/);
  assert.doesNotMatch(script,/curl[^\n]*\|\s*(?:ba)?sh|sudo|apt install|oauth-token/i);
  assert.match(script,/trap 'rm -f "\$installer"' EXIT/);
});
