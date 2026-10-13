"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const read = name => fs.readFileSync(path.join(root, "web", name), "utf8");
const html = read("index.html");
const base = read("style.css");
const motion = read("motion-refinement.css");
const polish = read("conversation-polish.css");

test("UI polish styles are included after the baseline stylesheet without replacing existing chat UI", () => {
  const sheets = ["style.css?v=3.2", "motion-refinement.css?v=1", "conversation-polish.css?v=1"];
  const offsets = sheets.map(sheet => html.indexOf(sheet));
  assert.ok(offsets.every(offset => offset > 0));
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
  for (const id of ["tabChats", "tabStatus", "tabCalls", "tabTerminal", "btnSettings", "settingsModal"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test("Motion supports keyboard focus and reduced-motion users", () => {
  assert.match(motion, /:focus-visible/);
  assert.match(motion, /prefers-reduced-motion:\s*reduce/);
  assert.match(motion, /animation-duration:\s*\.01ms\s*!important/);
  assert.match(motion, /transition-duration:\s*\.01ms\s*!important/);
  assert.doesNotMatch(motion, /animation:\s*[^;]*infinite/);
});

test("Conversation polish uses existing real selectors, preserving composer and message structure", () => {
  for (const selector of [".item-name", ".item-snippet", ".bubble", ".input-box", ".chat-input-bar", ".send-mic-wrap"]) {
    assert.ok(base.includes(selector), "Missing existing selector " + selector);
    assert.ok(polish.includes(selector), "Missing polish selector " + selector);
  }
  assert.match(polish, /max-width:\s*768px/);
  assert.doesNotMatch(polish, /display:\s*none\s*!important/);
});

test("Legal viewer remains linked from Settings after UI changes", () => {
  assert.match(html, /id="btnOpenLegal"/);
  assert.match(html, /id="legalModal"/);
  assert.match(html, /src="legal\.js"/);
});
