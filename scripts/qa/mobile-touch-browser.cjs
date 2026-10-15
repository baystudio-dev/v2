"use strict";
// Browser fixture QA. Requires optional Playwright package (PLAYWRIGHT_MODULE env).
// Deliberately mocks /api and EventSource: no user messages or commands are executed.
const assert=require("node:assert/strict");
const {createServer}=require("node:http");
const {readFile}=require("node:fs/promises");
const path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const web=path.resolve(__dirname,"../../web");
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{
  const name=new URL(req.url,"http://localhost").pathname;
  const file=path.resolve(web,"."+(name==="/"?"/index.html":name));
  if(!file.startsWith(web+path.sep)){res.writeHead(403).end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{"content-type":mime[path.extname(file)]||"application/octet-stream"});res.end(bytes);}
  catch{res.writeHead(404).end();}
});
const bounds=el=>{
  const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return {id:el.id,top:r.top,bottom:r.bottom,hit:hit===el||el.contains(hit),visible:r.width>1&&r.height>1,screenHeight:innerHeight};
};
async function tapTarget(page,id){
  const target=await page.locator("#"+id).evaluate(el=>{
    const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:hit===el||el.contains(hit),blockedBy:hit?.id||hit?.className?.toString(),width:r.width,height:r.height,disabled:!!el.disabled,chatOpen:document.getElementById("chatMain")?.classList.contains("mobile-open"),chain:[el,el.parentElement,el.parentElement?.parentElement,el.parentElement?.parentElement?.parentElement].filter(Boolean).map(x=>({id:x.id,className:x.className?.toString(),pointerEvents:getComputedStyle(x).pointerEvents,display:getComputedStyle(x).display,visibility:getComputedStyle(x).visibility,zIndex:getComputedStyle(x).zIndex})),chatVisibility:getComputedStyle(document.getElementById("chatMain")).visibility};
  });
  assert.ok(target.width>0&&target.height>0,id+" hidden");
  assert.ok(target.top>=-1&&target.bottom<=page.viewportSize().height+1 &&
    target.left>=-1&&target.right<=page.viewportSize().width+1,
    id+" outside WebView "+JSON.stringify(target));
  assert.ok(target.hit,id+" covered by another element "+JSON.stringify(target));
  assert.ok(!target.disabled,id+" unintentionally disabled");
}
async function main(){
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const report=[];
  try{
    for(const [label,width,height,landscape] of [
      ["compact",320,685,false],
      ["small",360,740,false],
      ["portrait",390,796,false],
      ["large",412,860,false],
      ["landscape",844,390,true],
    ]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1,reducedMotion:"reduce"});
      await context.addInitScript(()=>{
        window.EventSource=class{addEventListener(){} close(){}};
        window.AndroidBridge={getAntigravityInstallStatus:()=>JSON.stringify({state:"requires_ubuntu",canInstall:false}),openAntigravityInstaller(){}};
      });
      const page=await context.newPage();
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.route("**/api/**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({
        success:true,active:{codex:""},profiles:[],chats:{group:[],direct_budi:[],direct_rian:[]},availableModels:[],messages:[],status:{},workstations:{}
      })}));
      await page.goto("http://127.0.0.1:"+server.address().port+"/",{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>typeof window.AntigravitySetup==="object"&&!!document.querySelector("#btnSettings"));
      await page.waitForTimeout(120);
      const pageMetrics=await page.evaluate(()=>{
        const app=document.getElementById("waApp").getBoundingClientRect();
        return {appHeight:app.height,documentWidth:document.documentElement.scrollWidth,visibleWidth:innerWidth};
      });
      assert.ok(Math.abs(pageMetrics.appHeight-height)<=2,label+" shell extends beyond WebView");
      assert.ok(pageMetrics.documentWidth<=width+2,label+" horizontal page overflow");
      const nav=["tabChats","tabStatus","tabCalls","tabTerminal","btnSettings"];
      for(const id of nav) await tapTarget(page,id);
      await page.locator("#tabStatus").click();
      assert.equal(await page.locator("#viewStatus").evaluate(el=>getComputedStyle(el).display),"flex");
      await page.locator("#tabCalls").click();
      assert.equal(await page.locator("#viewCalls").evaluate(el=>getComputedStyle(el).display),"flex");
      await page.locator("#tabChats").click();
      await page.locator("#btnSettings").click();
      await tapTarget(page,"btnCloseSettings");
      await page.locator("#btnCloseSettings").click();
      await page.locator("#chatItem-group").click();
      await page.waitForTimeout(350);
      if(!landscape){
        assert.ok(await page.locator("#chatMain").evaluate(el=>el.classList.contains("mobile-open")));
        for(const id of ["btnBackMobile","btnEmoji","btnAttach","btnMic","btnChatMenu"])await tapTarget(page,id);
      }else{
        for(const id of ["btnEmoji","btnAttach","btnMic","btnChatMenu"])await tapTarget(page,id);
      }
      await page.locator("#messageInput").fill("uji tombol kirim");
      await page.waitForTimeout(320);
      await tapTarget(page,"btnSendMessage");
      await page.locator("#messageInput").fill("");

      // Android Enter defaults to newline, including IME composition. Ctrl+Enter
      // is an explicit send shortcut. A failed POST must preserve the draft.
      await page.locator("#messageInput").fill("multi-line");
      await page.locator("#messageInput").press("Enter");
      assert.ok((await page.locator("#messageInput").inputValue()).endsWith("\n"),
        label+" Android Enter should insert a line break by default");
      await page.locator("#messageInput").fill("draft remains on failure");
      let writes=0;
      await page.route("**/api/message",route=>{
        writes++;
        const status=writes===1?503:200;
        route.fulfill({status,contentType:"application/json",body:JSON.stringify({
          success:status===200,error:"Simulated backend temporarily unavailable"
        })});
      });
      await page.locator("#btnSendMessage").click();
      await page.waitForFunction(()=>!document.getElementById("btnSendMessage").disabled);
      assert.equal(await page.locator("#messageInput").inputValue(),"draft remains on failure",
        label+" message must survive failed submit");
      await page.locator("#btnSendMessage").click();
      await page.waitForFunction(()=>!document.getElementById("btnSendMessage").disabled);
      assert.equal(await page.locator("#messageInput").inputValue(),"",
        label+" acknowledged message should clear draft");
      assert.equal(writes,2,label+" should submit once per tap");

      // Enabling Enter-to-send switches the input from newline to submit.
      await page.evaluate(()=>{
        const checkbox=document.getElementById("settingEnterSends");
        checkbox.checked=true;
        checkbox.dispatchEvent(new Event("change",{bubbles:true}));
      });
      await page.locator("#messageInput").fill("Enter configured to send");
      await page.locator("#messageInput").press("Enter");
      await page.waitForFunction(()=>!document.getElementById("btnSendMessage").disabled);
      assert.equal(await page.locator("#messageInput").inputValue(),"");
      assert.equal(writes,3,label+" Enter should submit only once");

      // Shift+Enter remains newline, even if Enter-to-send is enabled.
      await page.locator("#messageInput").fill("one");
      await page.locator("#messageInput").press("Shift+Enter");
      assert.ok((await page.locator("#messageInput").inputValue()).endsWith("\n"));
      assert.equal(writes,3);
      await page.locator("#messageInput").fill("");

      // Shortcuts and chat transitions preserve drafts without creating messages.
      await page.locator("#messageInput").fill("draft in group");
      await page.evaluate(()=>switchChat("direct_budi"));
      assert.equal(await page.locator("#messageInput").inputValue(),"");
      await page.locator("#messageInput").fill("draft in Budi");
      await page.evaluate(()=>switchChat("group"));
      assert.equal(await page.locator("#messageInput").inputValue(),"draft in group");
      await page.locator("#messageInput").fill("");

      await page.evaluate(()=>{
        appState.chats.group.push({id:"local-qa-1",side:"left",senderName:"Budi",text:"Pesan QA lokal",
          time:"10:00",type:"text"});
        renderActiveChatMessages();
      });
      const firstBubble=page.locator("#messagesWrap .bubble").first();
      await firstBubble.dispatchEvent("pointerdown",
        {pointerType:"touch",clientX:36,clientY:185,bubbles:true});
      await page.waitForTimeout(490);
      assert.equal(await page.locator("#bubbleContextMenu").evaluate(el=>getComputedStyle(el).display),"flex",
        label+" long press should open message actions");
      await firstBubble.dispatchEvent("pointerup",
        {pointerType:"touch",clientX:36,clientY:185,bubbles:true});
      assert.equal(await page.evaluate(()=>window.WhatsAppAgentBack()),true,
        label+" Back should close the context menu");

      await page.locator("#btnAttach").click();
      assert.equal(await page.locator("#attachPopupMenu").evaluate(el=>getComputedStyle(el).display),"flex");
      await page.locator("#btnEmoji").click();
      assert.notEqual(await page.locator("#emojiDrawer").evaluate(el=>getComputedStyle(el).display),"none");
      await page.locator("#btnChatMenu").click();
      await page.locator("#btnHeaderTerminal").click();
      assert.notEqual(await page.locator("#terminalModal").evaluate(el=>getComputedStyle(el).display),"none");
      await tapTarget(page,"btnCloseTerminalModal");
      await page.locator("#btnCloseTerminalModal").click();
      if(!landscape){
        // Native keyboard insets reduce the WebView height; the composer must stay visible.
        await page.setViewportSize({width,height:Math.max(445,height-280)});
        await tapTarget(page,"btnEmoji");
        await page.locator("#btnBackMobile").click();
        for(const id of nav)await tapTarget(page,id);
      }
      assert.deepEqual(errors,[],label+" JS page errors");
      report.push({viewport:label,size:width+"x"+height,actions:landscape?14:20,uiErrors:errors.length,result:"PASS"});
      await context.close();
    }
  }finally{await browser.close();server.close();}
  console.log(JSON.stringify({status:"PASS",note:"Browser-only layout/tap behavior. Native Android window inset must still be validated on real device.",results:report}));
}
main().catch(error=>{console.error(error.stack||error);server.close();process.exit(1);});
