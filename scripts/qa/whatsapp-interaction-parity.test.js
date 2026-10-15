"use strict";
const { test }=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve,join}=require("node:path");
const root=resolve(__dirname,"../..");
const read=p=>readFileSync(join(root,p),"utf8");
const app=read("web/app.js"),html=read("web/index.html");
const native=read("android/app/src/main/java/com/bossbayu/aiteam/MainActivity.kt");

test("Mobile composer toggles send/mic and Enter is configurable without IME double-send",()=>{
  assert.match(app,/classList\.toggle\("has-text", hasText\)/);
  assert.match(app,/\/Android\/i\.test\(navigator\.userAgent\)/);
  assert.match(app,/localStorage\.getItem\("wa-agent-enter-sends-v1"\)/);
  assert.match(app,/localStorage\.setItem\("wa-agent-enter-sends-v1"/);
  assert.match(html,/id="settingEnterSends"/);
  assert.match(app,/e\.isComposing \|\| e\.keyCode === 229/);
  assert.match(app,/if \(e\.shiftKey\) return/);
  assert.match(app,/document\.getElementById\("chatInputForm"\)\.requestSubmit\(\)/);
});
test("Draft is scoped per chat and not silently erased on HTTP failure",()=>{
  assert.match(app,/drafts: Object\.create\(null\)/);
  assert.match(app,/appState\.drafts\[previous\] = input\.value/);
  assert.match(app,/input\.value = appState\.drafts\[chatId\] \|\| ""/);
  assert.match(app,/const delivered = await sendMessage\(text, originChat\)/);
  assert.match(app,/if \(messageSubmissionPending\) return/);
  assert.match(app,/if \(!response\.ok \|\| receipt\.success === false\)/);
  assert.match(app,/if \(delivered\) \{/);
  assert.match(app,/messageInput\.value === text/);
  assert.match(app,/Pesan belum terkirim\. Ketikan tetap disimpan/);
});
test("Tap, long press and swipe use separate bounded gesture paths",()=>{
  assert.match(app,/attachLongPressMessageMenu\(bubble, actionBtn, msg\)/);
  assert.match(app,/e\.pointerType !== "touch"/);
  assert.match(app,/if \(Math\.abs\(e\.clientX - x\) > 10/);
  assert.match(app,/}, 450\)/);
  assert.match(app,/attachSwipeGesture\(row, bubble, swipeIcon, msg\)/);
  assert.match(app,/if \(Math\.abs\(dy\) > Math\.abs\(dx\)\)/);
  assert.match(app,/if \(moveX >= threshold\)/);
  assert.match(app,/setReplyingTo\(msg\)/);
});
test("Back closes web dialogs and chat without backgrounding at first press",()=>{
  assert.match(app,/window\.WhatsAppAgentBack = function/);
  assert.match(app,/const popovers = \[/);
  assert.match(app,/chat\?\.classList\.contains\("mobile-open"\)/);
  assert.match(native,/insets\?\.isVisible\(WindowInsetsCompat\.Type\.ime\(\)\)/);
  assert.match(native,/\.hide\(WindowInsetsCompat\.Type\.ime\(\)\)/);
  assert.match(native,/webView\.evaluateJavascript/);
  assert.match(native,/WhatsAppAgentBack/);
  assert.match(native,/if \(handled != "true"/);
});
test("Touch QA exercises real tap targets across mobile and landscape, no secrets",()=>{
  const qa=read("scripts/qa/mobile-touch-browser.cjs");
  for(const term of ["320,685","360,740","390,796","412,860","844,390","btnSendMessage","btnAttach","btnEmoji","btnCloseTerminalModal"]) {
    assert.ok(qa.includes(term),term);
  }
  assert.doesNotMatch(qa,/OPENAI_API_KEY|ANTHROPIC_API_KEY|process\.env\.HOME/);
});
