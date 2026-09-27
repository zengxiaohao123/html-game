/* ============================================================
   js/ui.js —— 模块：界面与UI
   ============================================================ */
"use strict";
const qs=id=>document.querySelector(id);
function el(html){const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild;}
function switchMode(m){
  gameMode=m;
  qs('#bottom').classList.toggle('mode-story', m==='story');
  qs('#bottom').classList.toggle('mode-combat', m==='combat');
  qs('#rightTitle').textContent='信息';
  if(m==='story'){
    // 事件 lockEventUI / 主线剧情 playMainStorySeg 都走这条路：
    // 强制隐藏 goBtn（防止从探索/战斗残留过来的"前往"按钮继续显示）
    qs('#goBtn').style.display='none';
    // 刷新 iconbar —— isInFlow() 会根据 eventState/mainStoryPlaying/combatState 决定禁用哪些按钮
    renderIconbar();
  } else {
    // 切到战斗或其他非 story 模式：确保故事引擎的残留全部清掉
    finishCurrentFragment();  // 清 pages / storyBody / speaker / 屏幕效果 / 回调
    const sc = qs('#storyControls'); if(sc) sc.style.display='none';
    renderIconbar();
  }
}
function clearLog(){ qs('#logBody').innerHTML=''; }
function clearStory(){ storyClear(); }
/* ---- 主线 / 通用辅助：名字彩色、屏幕效果、幕标题 ---- */
/* 名字彩色：仅对特定名字的特定字上色，其余保持白色 */
function applySpeakerColor(name){
  if(!name) return '';
  // 白名单名字 -> 替换特定字为带 class 的 span
  const rules = [
    { key:'夏阳',   ch:'阳',   cls:'sp-sun' },
    { key:'叶唯安', ch:'叶',   cls:'sp-ye' },
    { key:'陆悠悠', ch:'悠悠', cls:'sp-youyou' },
    { key:'宋梦雨', ch:'梦',   cls:'sp-mengyu' },
    { key:'许泠朦', ch:'泠',   cls:'sp-lingmeng' },
    { key:'潘天宇', ch:'宇',   cls:'sp-tianyu' },
    { key:'杨一帆', ch:'杨',   cls:'sp-yifan' },
    { key:'灰白',   ch:'灰',   cls:'sp-hui' },
  ];
  let out=name;
  for(const r of rules){
    if(name===r.key){ out=out.split(r.ch).join(`<span class="${r.cls}">${r.ch}</span>`); }
  }
  return out;
}
/* 屏幕效果：shake / shake-dull / flash / black */
function playScreenEffect(type){
  if(type==='shake-dull'){
    qs('#app').classList.add('fx-shake-dull');
    setTimeout(()=>qs('#app').classList.remove('fx-shake-dull'), 500);
    return;
  }
  if(type==='shake'){
    qs('#app').classList.add('fx-shake');
    setTimeout(()=>qs('#app').classList.remove('fx-shake'), 600);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'screen-effect fx-'+type;
  document.body.appendChild(overlay);
  setTimeout(()=>overlay.remove(), 2800);
}
/* 幕标题：白字大字遮罩 5s 自动淡出 */
function showActTitle(title){
  const ov = qs('#actTitleOverlay');
  ov.innerHTML = `<div class="act-title-text">${escapeHtml(title)}</div>`;
  ov.classList.add('show');
  setTimeout(()=>{ ov.classList.remove('show'); setTimeout(()=>{ ov.innerHTML=''; }, 400); }, 5500);
}

/* 处理文本中的元指令（返回纯净 HTML，副作用执行指令） */
function processMetaCommands(text){
  let cleaned = text;
  // 所有 【xxx】 块
  const re = /【([^】]+)】/g;
  cleaned = cleaned.replace(re, (m, cmd)=>{
    const c = cmd.trim();
    if(!c) return '';

    // —— 等价别名（让后续剧情写作更自由）——
    const map = {
      '屏幕抖动': 'shake',
      '轻微抖动': 'shake-dull',
      '屏幕闪白': 'flash',
      '闪白':    'flash',
      '屏幕黑屏': 'black',
      '黑屏':    'black',
      '回忆开始': 'flashback-on',
      '进入回忆': 'flashback-on',
      '回忆结束': 'flashback-off',
      '退出回忆': 'flashback-off',
      '变回正常': 'flashback-off',
    };
    const eff = map[c] || c;

    // 屏幕效果
    if(eff==='shake' || eff==='shake-dull'){
      playScreenEffect(eff);
      return '';
    }
    if(eff==='flash' || eff==='black'){
      playScreenEffect(eff);
      return '';
    }
    // 回忆 class 切换（只切 storyBox 容器，不影响地图/HUD）
    if(eff==='flashback-on'){
      qs('#bottom').classList.add('storyFlashback');
      return '';
    }
    if(eff==='flashback-off'){
      qs('#bottom').classList.remove('storyFlashback');
      return '';
    }
    // 幕标题：【act:第一幕 分道扬镳】
    if(c.startsWith('act:')){
      showActTitle(c.slice(4).trim());
      return '';
    }
    // 指令不识别 -> 不显示
    return '';
  });
  return cleaned;
}

/* ============================================================
   js/ui.js PART 2 —— 剧情打字机引擎 v3（分页 + 段间点击 + 自动模式）
   ------------------------------------------------------------
   【分页规则】buildPages(body) 把片段切成 page 数组：
     R1. speaker 变化 强制换页（除非当前页还空）
     R2. 同 speaker 连续 >5 段 或 纯字数 >300 强制换页
     R3. 跨度大（回忆闪回、flashback-on/off）强制换页
     R4. 片段结束时自动收尾，与后续自然分隔

   【交互规则】
     - 手动模式：打字完当前段 → 停住 → 玩家点击剧情区 → 推进下一段
     - 自动模式：段间 200ms 自动连打；页尾 1.5s 自动翻；最后一页 4s 清场
     - 打字中点击 → 立即 skip-to-end 本段，再按上述规则推进
     - 剧情区不再滚动，翻页靠"清屏 + 淡入动画"

   【入口】
     - 主线剧情：storyStartFragment(body, afterPlayed) 一次性灌入完整 body
     - 事件系统：storyPush(html, onDone) 旧签名继续兼容 —— 每次 push
       引擎自动把新段加入 current page 并在点击时推进
     - 二者完全共存，共享 buildPages 和 typeSegment
   ============================================================ */

// ---- 引擎状态 ----
let storyPages=[];        // [{ paragraphs: [{speaker, html}] }]
let storyPageIdx=0;
let storySegIdx=0;
let storyPageTimer=null;
let storyAutoTimer=null;
let storyAutoMode=false;
try { storyAutoMode = sessionStorage.getItem('storyAutoMode')==='1'; } catch(e){}
let storyTyping=false;
let storyCurrent=null;
let storyPlainIdx=0;
let storyOnSegEnd=null;

/* ============================================================
   buildPages：把 segments [{speaker, html}] 分成 page 数组
   纯函数，不执行任何副作用；html 保持原始（含 【元指令】）
   ============================================================ */
function buildPages(segments){
  const pages=[];
  let cur=null;
  // 闪回 / 屏幕效果等元指令关键字（匹配原始 html 里的 【xxx】）
  const META_EDGE = /【(回忆开始|进入回忆|回忆结束|退出回忆|变回正常|act:|屏幕闪白|闪白|屏幕黑屏|黑屏|屏幕抖动|轻微抖动)】/;
  const MAX_PARAS_PER_PAGE = 5;
  const MAX_CHARS_PER_PAGE = 300;

  const flush = ()=>{
    if(cur && cur.paragraphs.length){ pages.push(cur); cur=null; }
  };
  const makePage = ()=>({ paragraphs:[], pageChars:0 });

  for(let si=0; si<segments.length; si++){
    const seg = segments[si] || {};
    const speaker = seg.speaker || null;
    const html = seg.html || '';
    const plain = html.replace(/<[^>]+>/g,'');
    const charCount = plain.length;

    // 规则3：含元指令的段落 → 强制换页（若当前页非空），让屏幕效果独立成页
    const edgeMarker = META_EDGE.test(html);

    if(!cur) cur = makePage();

    // 规则1：speaker 变化 → 强制换页
    const lastSp = cur.paragraphs.length
      ? cur.paragraphs[cur.paragraphs.length-1].speaker : null;
    const speakerChanged = (lastSp !== speaker) && cur.paragraphs.length > 0;

    if(speakerChanged || (edgeMarker && cur.paragraphs.length>0)){
      flush(); cur = makePage();
    }

    cur.paragraphs.push({ speaker, html });
    cur.pageChars += charCount;

    // 规则2：同 speaker 段数 ≥5 或 字数 ≥300 → 换页（把当前段留到下一页开头）
    let sameRun = 0;
    for(let pi=cur.paragraphs.length-1; pi>=0; pi--){
      if(cur.paragraphs[pi].speaker === speaker) sameRun++;
      else break;
    }
    if(sameRun >= MAX_PARAS_PER_PAGE || cur.pageChars >= MAX_CHARS_PER_PAGE){
      const last = cur.paragraphs.pop();
      cur.pageChars -= plain.length;
      flush();
      cur = { paragraphs:[last], pageChars: plain.length };
    }
  }
  flush();
  return pages;
}

/* ============================================================
   剧情入口
   ============================================================ */

/* 引擎上下文：本次 storyStartFragment 的运行时信息（事件标题等） */
let storyCtx = null;

/* 统一剧情入口（主线 & 事件都走这个）
   body: [{speaker, html}, ...] —— 保持原始 html（含 【元指令】）
   onSegEnd: 所有页打完后的回调
   opts:
     - title: 剧情标题（事件用，显示在 storySpeaker 区；主线不传，默认用段落的 speaker）
     - keepControls: 是否保留 storyControls（默认 true；特殊场景如只显示元指令效果的独立片段可设 false） */
function storyStartFragment(body, onSegEnd, opts){
  opts = opts || {};

  // 先停掉上一段遗留的定时器/打字
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
  if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
  storyTyping=false; storyCurrent=null; storyPlainIdx=0;

  // 清 storyBody（上次 finish 后可能有残留；也确保 storyOnTap 里的 "故事引擎空" 判断正确）
  qs('#storyBody').innerHTML='';
  qs('#storySpeaker').innerHTML='';

  // 统一清屏：彻底重置屏幕效果（闪回 class、抖动、overlay），避免上一段残留
  qs('#bottom').classList.remove('storyFlashback');
  qs('#app').classList.remove('fx-shake','fx-shake-dull');
  document.querySelectorAll('.screen-effect').forEach(el=>{ try{ el.remove(); }catch(e){} });

  // 保存上下文（skipBlockedWhenChoice: true 表示该片段结束时会进入选项，
  // 玩家不能跳过——跳过会让选项之前的文本丢失，玩家不知道选什么）
  storyCtx = { title: opts.title || null, skipBlockedWhenChoice: !!opts.skipBlockedWhenChoice };

  // 构建 pages：html 保持原始，processMetaCommands 延迟到 typeSegment 执行
  const segments = body.map(s => ({
    speaker: s.speaker || null,
    html: s.html || '',
  }));
  storyPages = buildPages(segments);
  storyPageIdx = 0; storySegIdx = 0;
  storyOnSegEnd = onSegEnd || null;

  // 初始化自动/跳过按钮（默认每次 start 时重建事件绑定；如果已 initStoryControls 过则 auto/skip onclick 已绑好）
  // 但按钮需要可见 —— 确保 DOM 存在并显示
  const controls = qs('#storyControls');
  if(controls){
    controls.style.display = '';
    // 自动按钮状态同步
    const auto=qs('#autoBtn'); if(auto) auto.classList.toggle('on', storyAutoMode);
  }

  // 如果没有任何段落（理论上不会发生），直接结束
  if(!storyPages.length){ finishCurrentFragment(); return; }

  renderCurrentPage();
}

/* 旧增量入口 storyPush —— 保留为 deprecated，内部用 storyStartFragment 重建（不推荐新代码用） */
function storyPush(html, onDone){
  const cleanHtml = processMetaCommands(String(html||''));
  if(!storyPages.length){
    storyStartFragment([{ speaker: null, html: cleanHtml }], onDone);
    return;
  }
  // 已在播：先清旧定时器，追加段后重新从 current segment 继续
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
  storyTyping=false; storyCurrent=null; storyPlainIdx=0;

  const lastPageIdx = storyPages.length - 1;
  const plain = cleanHtml.replace(/<[^>]+>/g,'');
  storyPages[lastPageIdx].paragraphs.push({ speaker: null, html: cleanHtml });
  storyPages[lastPageIdx].pageChars += plain.length;
  storyOnSegEnd = onDone || null;

  // 如果在打字中（storyCurrent != null 其实已经清了，这里是保险），让引擎继续推进
  advanceAfterIdle();
}

/* 从 idle 状态（页尾等待、或刚追加完）推进一段 */
function advanceAfterIdle(){
  if(storyPageIdx >= storyPages.length){
    // 所有页打完 → finishSeg
    finishCurrentFragment(); return;
  }
  const page = storyPages[storyPageIdx];
  if(storySegIdx < page.paragraphs.length){
    // 当前页还有段 → 直接打
    typeSegment();
  } else {
    // 当前页已打完 → 玩家点击下一页触发；自动模式下 timer 会自动翻
    onPageEnd();
  }
}

/* ============================================================
   播放核心
   ============================================================ */

function renderCurrentPage(){
  const body = qs('#storyBody');
  body.innerHTML = '';
  body.classList.remove('story-tap-hint','story-page');

  if(storyPageIdx >= storyPages.length){
    finishCurrentFragment(); return;
  }
  // 给这一页加淡入动画
  body.classList.add('story-page');

  const page = storyPages[storyPageIdx];
  if(!page.paragraphs.length){
    storyPageIdx++; storySegIdx=0;
    renderCurrentPage(); return;
  }

  // 事件系统：第一页第一句带事件标题由 startEvent 自己提前塞到 storyBody
  // 所以我们先打第 storySegIdx 段（0-based）
  typeSegment();
}

function typeSegment(){
  if(storyPageIdx >= storyPages.length){
    finishCurrentFragment(); return;
  }
  const page = storyPages[storyPageIdx];
  if(storySegIdx >= page.paragraphs.length){
    onPageEnd(); return;
  }
  const seg = page.paragraphs[storySegIdx];

  // ★ 核心改动：元指令延迟到打字这一刻才执行 —— processMetaCommands 的副作用（闪白/抖动/闪回 class/幕标题）
  // 只有当该段落真正被打字时才会触发，保证时机正确。cleanHtml 是清掉了 【xxx】 指令的纯内容。
  const cleanHtml = processMetaCommands(seg.html || '');

  // 更新 speaker 区：事件优先显示事件标题（固定不动），否则用段落的 speaker（主线角色名），都没有则清空
  const speakerEl = qs('#storySpeaker');
  if(storyCtx && storyCtx.title){
    // 每次都强制重设 —— 之前 storyStartFragment 会把 innerHTML 清空但不会清 dataset.storyTitle，
    // 如果同一个事件里 body → result 用的是同一个 title，旧的"只在 title 变化时设"判断会因为
    // dataset 还留着而跳过，speaker 区就保持空了（自动模式下尤其容易复现）。
    speakerEl.innerHTML = applySpeakerColor(storyCtx.title);
    speakerEl.dataset.storyTitle = storyCtx.title;
  } else {
    // 主线：每段根据 seg.speaker 切换
    speakerEl.innerHTML = seg.speaker ? applySpeakerColor(seg.speaker) : '';
    delete speakerEl.dataset.storyTitle;
  }

  const box=qs('#storyBody');
  const para = document.createElement('div');
  para.className = 'story-para';
  box.appendChild(para);

  // 非 <p> 开头 → 直接渲染（不打字机）—— 事件标题 div、空 <p></p> 占位等
  if(!/^\s*<p/i.test(cleanHtml)){
    para.innerHTML = cleanHtml;
    box.scrollTop = box.scrollHeight;
    storySegIdx++;
    onParagraphDone();
    return;
  }

  // 打字机
  storyTyping = true;
  storyPlainIdx = 0;
  storyCurrent = cleanHtml;
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }

  const plain = cleanHtml.replace(/<[^>]+>/g,'');
  storyPageTimer = setInterval(()=>{
    storyPlainIdx = Math.min(storyPlainIdx+1, plain.length);
    para.innerHTML = escapeHtml(plain.slice(0, storyPlainIdx))
      + (storyPlainIdx < plain.length ? '<span class="story-caret"></span>' : '');
    box.scrollTop = box.scrollHeight;
    if(storyPlainIdx >= plain.length){
      if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
      storyTyping = false;
      para.innerHTML = storyCurrent;
      box.scrollTop = box.scrollHeight;
      storyCurrent = null;
      storySegIdx++;
      onParagraphDone();
    }
  }, 1000/30);
}

/* 一段打字完成后 → 根据手动/自动模式决定是否推进 */
function onParagraphDone(){
  const page = storyPages[storyPageIdx];
  if(!page) return;
  if(storySegIdx < page.paragraphs.length){
    // 同页还有段
    if(storyAutoMode){
      if(storyAutoTimer){ clearTimeout(storyAutoTimer); }
      storyAutoTimer = setTimeout(typeSegment, 200);
    }
    // 手动模式：等玩家点击
    return;
  }
  // 当前页所有段打完
  onPageEnd();
}

/* 页尾：等玩家点击或自动翻页 */
function onPageEnd(){
  const box = qs('#storyBody');
  // 手动模式才显示"点击继续"提示；自动模式自己翻不需要
  if(!storyAutoMode){
    box.innerHTML += '<div class="story-tap-hint">↓ 点击继续</div>';
  }

  if(storyAutoMode){
    if(storyPageIdx + 1 < storyPages.length){
      // 中间页 → 1.5s 自动翻下一页
      if(storyAutoTimer){ clearTimeout(storyAutoTimer); }
      storyAutoTimer = setTimeout(()=>{
        storyPageIdx++; storySegIdx=0;
        renderCurrentPage();
      }, 1500);
    } else {
      // 最后一页 → 立刻触发回调（选项叠加在最后一页文字上，不清屏）
      // 等回调里的选项处理完（用户选完 → 下一次 storyStartFragment 会清屏）
      if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
      endForCallbacks();
    }
  }
}

/* 片段结束但不清正文 —— 用于"选项叠加在最后一页文字上"场景
   （主线剧情 / 事件正文：最后一页打完，文字保留，选项在 promptZone 出现） */
function endForCallbacks(){
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
  if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
  storyTyping=false; storyCurrent=null; storyPlainIdx=0;

  // 清最后那页的"点击继续"提示（正文内容不动）
  const box = qs('#storyBody');
  const hint = box.querySelector('.story-tap-hint');
  if(hint) hint.remove();

  // 存回调、清引用
  const cb = storyOnSegEnd; storyOnSegEnd = null;
  /* ★ 关键：绝对不能清 storyPages / storyPageIdx / storySegIdx
     1) 这三行之前被清成 0 了，导致 storyOnTap() 第一行 `if(!storyPages.length) return;`
        直接返回 —— 自动模式打完最后一页后，哪怕玩家临时切回手动再点剧情区也没反应，
        整个故事引擎在"选项叠加阶段"其实是"死"的。
     2) 保留完整 storyPages 状态让 storyOnTap 语义不变：
        最后一页最后一段的情况下它会走到函数末尾，再调 endForCallbacks() —— 但那时
        storyOnSegEnd 已经被置 null，回调不会二次触发，完全安全。
     3) storyHasMore() 也因此能继续返回 true —— 这就是它本应有的语义：
        "故事引擎还在跑，只是暂时等回调 / 等选项"。
     真正彻底清理（清 pages / 清 controls / 清屏幕效果 / 清 storyCtx）
     留给 finishCurrentFragment，它的调用点（选项选完后 / 真结束清场）是明确的。 */

  // 直接同步调回调。finishMainStorySeg → 有 options 则 renderMainStoryOptions 叠加到 promptZone；
  // 无 options 则 0.3s 后触发下一段 storyStartFragment。
  // 事件 renderEventOptions → 选项叠加到 promptZone。
  if(cb) cb();
}

function finishCurrentFragment(){
  // 1. 停定时器、清打字状态
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
  if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
  storyTyping=false; storyCurrent=null; storyPlainIdx=0;
  storyPages=[]; storyPageIdx=0; storySegIdx=0;
  const cb = storyOnSegEnd; storyOnSegEnd = null;

  // 2. 彻底清 storyBody（正文 + 翻页提示）
  qs('#storyBody').innerHTML='';

  // 3. 清 speaker（包括事件标题残留的 dataset.storyTitle）
  const speakerEl = qs('#storySpeaker');
  speakerEl.innerHTML='';
  delete speakerEl.dataset.storyTitle;

  // 4. 隐藏自动/跳过按钮（剧情/事件彻底结束时清空）——
  //    但 endForCallbacks（选项叠加场景）**不**走这里，它不清正文、不清 speaker、不隐藏 controls
  const controls = qs('#storyControls');
  if(controls) controls.style.display='none';

  // 5. 清理所有屏幕效果（闪回、抖动、overlay）—— 防止跳过剧情后效果残留
  qs('#bottom').classList.remove('storyFlashback');
  qs('#app').classList.remove('fx-shake','fx-shake-dull');
  document.querySelectorAll('.screen-effect').forEach(el=>{ try{ el.remove(); }catch(e){} });

  // 6. 清引擎上下文
  storyCtx = null;

  // 7. 触发回调（如果有）—— 通常 finishCurrentFragment 用于"彻底结束"，回调一般为 null；
  //    storySkipMainSeg（跳过时）直接调这里，此时回调可能还在，照常触发
  if(cb) cb();
}

/* ============================================================
   强制结束故事流程 + 解锁所有 UI（给自动模式下"最后一页点一下提前退出"用）

   finishCurrentFragment 只负责清故事引擎的 DOM/timer；
   真正的"主线 mainStoryPlaying=false + 事件 eventState=null + iconbar 解锁"分散在
   finishMainStorySeg / finishEvent 各自的 setTimeout 里。这里统一做完，
   避免在多处各写一遍 unlock 代码 + 确保玩家"点一下"之后状态是完整的。
   ============================================================ */
window.forceEndStoryFlow = function(){
  // 1) 清故事引擎 DOM/timer（finishCurrentFragment 会停 storyPageTimer/storyAutoTimer、
  //    清 storyPages/speaker/storyCtx 等引擎内部状态，但不会碰 eventState/mainStoryPlaying ——
  //    那些是主线/事件自己的锁标记，必须在此函数层面处理）
  finishCurrentFragment();

  // 2) ★ 清锁标记 —— 必须同时写 window 属性和全局词法变量（普通 <script> 的顶层 let 不会自动挂 window）
  if(typeof window.mainStoryPlaying !== 'undefined'){ window.mainStoryPlaying = false; }
  if(typeof window.eventState !== 'undefined'){ window.eventState = null; }
  if(typeof eventState !== 'undefined'){ eventState = null; }
  if(typeof mainStoryPlaying !== 'undefined'){ mainStoryPlaying = false; }
  // 清可能挂着的待解锁 setTimeout（主线/事件各自的 4s autoWait timer）
  if(typeof window._mainStoryUnlockTimer !== 'undefined'){ clearTimeout(window._mainStoryUnlockTimer); window._mainStoryUnlockTimer = null; }
  if(typeof window._eventUnlockTimer !== 'undefined'){ clearTimeout(window._eventUnlockTimer); window._eventUnlockTimer = null; }

  // 3) 解除 UI 独占 class + 刷新 iconbar（renderIconbar 会用 isInFlow 判定哪些按钮置灰）
  const bottom = qs('#bottom'); if(bottom) bottom.classList.remove('mode-event-lock');
  if(typeof renderIconbar === 'function') renderIconbar();

  // 4) 刷新 HUD + 地图（主线/事件结束后地图可操作、任务自动接取 log 需要 refreshHUD 触发 questNotified）
  if(typeof renderMap === 'function') renderMap();
  if(typeof refreshHUD === 'function') refreshHUD();
};

/* ============================================================
   外部触发：玩家点击剧情区 → 推进
   ============================================================ */
function storyOnTap(){
  if(storyTyping){
    // 打字中点击 → skip-to-end 本段
    const box=qs('#storyBody');
    const para=box.lastElementChild;
    if(para && para.classList.contains('story-para') && storyCurrent){
      para.innerHTML=storyCurrent;
      if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
      storyTyping=false; storyCurrent=null;
      storySegIdx++;
      onParagraphDone();
    }
    return;
  }
  if(!storyPages.length) return;
  const page = storyPages[storyPageIdx];
  if(!page) return;

  // 自动模式下玩家点击 → 清掉 auto timer，手动接管一次推进
  if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }

  if(storySegIdx < page.paragraphs.length){
    // 还有段没打 → 推进下一段
    typeSegment();
    return;
  }
  // 当前页已打完 → 翻下一页 or 结束
  if(storyPageIdx + 1 < storyPages.length){
    storyPageIdx++; storySegIdx=0;
    renderCurrentPage();
    return;
  }
  // 所有页打完 → endForCallbacks 走回调（渲染选项 或 触发下一段/真结束）
  // 这里的 didRunCallback 判断是整个"手动点最后一页 = 提前退出"的核心：
  //
  //   - 自动模式下最后一页不会设 storyAutoTimer（不走 1.5s auto 翻页，直接 endForCallbacks），
  //     endForCallbacks 回调会在主线/事件里自己排一个 setTimeout(4000) 解锁
  //   - 手动模式下主线/事件的解锁 setTimeout 根本不会排（autoWait=0 时 finishMainStorySeg /
  //     finishEvent 走的是 else 分支里直接调 forceEndStoryFlow，但那是 endForCallbacks 同步
  //     执行的回调里的事 —— 而这里 endForCallbacks 会再次被 storyOnTap 调吗？取决于 cb）
  //
  // 关键点：endForCallbacks 会把 storyOnSegEnd 清成 null。
  // 所以 didRunCallback===false 意味着 cb 之前已经被调过、这次 endForCallbacks 是空跑。
  // 此时无论当前是手动模式（setTimeout 解锁根本没排）还是自动模式（setTimeout 正在等 4s），
  // 玩家这一下点击就是想提前结束 —— 统一 forceEndStoryFlow。
  const didRunCallback = !!(storyOnSegEnd);
  endForCallbacks();
  if(!didRunCallback){
    forceEndStoryFlow();
  }
}

/* ============================================================
   兼容旧 API（event.js 等依赖）
   ============================================================ */
function storyAdvance(){ storyOnTap(); }
function storyIsTyping(){ return storyTyping; }
function storyHasMore(){
  if(storyPageIdx >= storyPages.length) return false;
  const page = storyPages[storyPageIdx];
  return page && (storySegIdx < page.paragraphs.length || storyPageIdx + 1 < storyPages.length);
}
function storyClear(){ finishCurrentFragment(); }
function story(html){ storyPush(html); }
function storySetSpeaker(name){
  // 外部主动设 speaker（主线剧情 start 前预填、选项后等场景）—— 设完清掉 eventTitle dataset
  const el = qs('#storySpeaker');
  el.innerHTML = name ? applySpeakerColor(name) : '';
  if(!name) delete el.dataset.storyTitle;
}
function storySkipToEnd(){ storyOnTap(); return true; }
function storyMarkChoice(){ /* 空实现，分页引擎不依赖 marker */ }

/* 跳过当前故事片段（主线正文 / 事件正文 / 事件结果 都走这个）：
   清所有 pages → finishCurrentFragment 触发 onSegEnd 回调（主线 → finishMainStorySeg 进选项；事件 → renderEventOptions 进选项） */
function storySkipMainSeg(){
  // 停打字/定时器（finishCurrentFragment 会再清一遍，这里保险）
  if(storyPageTimer){ clearInterval(storyPageTimer); storyPageTimer=null; }
  if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
  storyTyping=false;

  // 强制 finish —— finishCurrentFragment 里会清 storyBody / controls / 屏幕效果 / 触发回调
  storyPages = []; storyPageIdx = 0; storySegIdx = 0;
  finishCurrentFragment();
}

/* ============================================================
   自动 / 跳过按钮
   ============================================================ */
function initStoryControls(){
  const auto=qs('#autoBtn');
  const skip=qs('#skipBtn');
  if(auto){ auto.classList.toggle('on', storyAutoMode); auto.onclick=()=>{
    storyAutoMode = !storyAutoMode;
    try{ sessionStorage.setItem('storyAutoMode', storyAutoMode?'1':'0'); }catch(e){}
    auto.classList.toggle('on', storyAutoMode);
    if(storyAutoMode && storyPages.length){
      // ★ 四种状态全覆盖，让切换到自动模式的瞬间立即接入自动推进
      if(storyTyping){
        // 正在打字 —— typeSegment 自然打完后 onPageEnd 会按自动模式接管，不用额外处理
      } else if(storySegIdx < storyPages[storyPageIdx].paragraphs.length){
        // 还有未打的段（当前 idle） → 立即连打下一段
        typeSegment();
      } else if(storyPageIdx + 1 < storyPages.length){
        // 页尾等待 + 中间页 → 立即排 1.5s 翻下一页（和 onPageEnd 逻辑一致）
        if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
        storyAutoTimer = setTimeout(()=>{
          storyPageIdx++; storySegIdx=0;
          renderCurrentPage();
        }, 1500);
      } else {
        // 最后一页已打完 → 复用 onPageEnd 的最后一页逻辑（endForCallbacks → 同步调回调 → 回调里
        // 根据 storyAutoMode 排 autoWait 4s 或立即 forceEndStoryFlow）
        if(storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
        endForCallbacks();
      }
    }
    if(!storyAutoMode && storyAutoTimer){ clearTimeout(storyAutoTimer); storyAutoTimer=null; }
  }}
  if(skip){ skip.onclick=onSkipClicked; }
}
function onSkipClicked(){
  // 保护 1：promptZone 里已经有选项（选阶段）
  if(document.querySelector('#promptZone .ev-opt')){
    alertDialog('无法跳过','这里需要你做出选择！'); return;
  }
  // 保护 2：当前片段结束时会进入选项，但选项还没出现 → 跳过会把选项前的文本清掉
  if(storyCtx && storyCtx.skipBlockedWhenChoice){
    alertDialog('无法跳过','这段剧情后需要你做出选择，请先看完。'); return;
  }
  openModal('确认跳过', '<p>你确定跳过本段剧情？</p>', 'small', {noCloseX:true});
  const body=qs('#modalBody');
  const btnRow=document.createElement('div'); btnRow.className='btn-row'; btnRow.style='justify-content:center;margin-top:10px;';
  btnRow.innerHTML = `<button class="mbtn small" id="skipYes">是</button><button class="mbtn small" id="skipNo">否</button>`;
  body.appendChild(btnRow);
  qs('#skipNo').onclick=closeModal;
  qs('#skipYes').onclick=()=>{ closeModal(); doSkipCurrent(); };
}
function doSkipCurrent(){
  // 二次保险：onSkipClicked 已经拦了 skipBlockedWhenChoice，但如果其他地方直接调 skip 也要拦住
  if(storyCtx && storyCtx.skipBlockedWhenChoice){ return; }
  if(eventState){
    // 事件正文阶段：跳过正文 → 回调触发 renderEventOptions（进入选项阶段）
    // 事件结果阶段：跳过结果文本 → 回调触发 eventState=null + unlockEventUI（彻底结束）
    // 选项阶段有 onSkipClicked 里的"选项存在"保护，用户没机会点到这里
    storySkipMainSeg();
    return;
  }
  // 主线剧情：跳过整个片段
  storySkipMainSeg();
}

/* 绑定 storyBox 点击（DOMContentLoaded 时执行） */
function bindStoryTap(){
  const box=qs('#storyBox');
  if(!box) return;
  box.addEventListener('click', (e)=>{
    // 1. 点击自动/跳过按钮冒泡到 storyBox —— 不算点剧情区
    if(e.target && e.target.closest('#storyControls')) return;
    // 2. 选项叠加在 promptZone 里 —— 不响应 storyBox 点击
    if(document.querySelector('#promptZone .ev-opt')) return;
    storyOnTap();
  });
}
if(typeof document!=='undefined'){ document.addEventListener('DOMContentLoaded', ()=>{
  initStoryControls();
  bindStoryTap();
}); }

/* escapeHtml（工具） */
function escapeHtml(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function itemDetailHTML(key){
  let body='';
  if(FOOD[key] || key==='cookedMeat'){
    let add = FOOD[key]&&FOOD[key].healthChance ? '，有20%概率健康+1' : '';
    body = `回复 <span class="lvlup">${foodHeal(key)}</span> 点生命${add}（已计入篝火、烹饪天赋加成）。`;
  } else if(key==='clearMind'){
    body = `心理压力<span style="color:#d9534f">+4</span>，立即回满生命值与行动力并解除 ${termHTML('depress','抑郁')} 状态，本日内主角攻击力+25%、受到的伤害-25%。`;
  } else if(ITEMS[key] && ITEMS[key].permanent && (ITEMS[key].desc||'').indexOf('天赋')>=0){
    const map={club:'crit',cloth:'block',dagger:'blood',leather:'hold',ironSword:'momentum'};
    if(map[key]){ const tid=map[key]; const tname=(PROTAGONIST.passives.find(p=>p.id===tid)||{}).name || tid; const lv=(G&&G.proLevels&&G.proLevels[tid])||1; body=`使主角【天赋·${tname}】升为 <span class="lvlup">${lv+1}</span> 级（当前 ${lv} 级）。`; }
    else body = ITEMS[key].desc || '';
  } else if(key==='armor'){ const lv=(G&&G.proLevels&&G.proLevels.block)||1; body=`使【格挡】升为 <span class="lvlup">${lv+2}</span> 级、【坚守】升为 <span class="lvlup">${((G&&G.proLevels&&G.proLevels.hold)||1)+1}</span> 级。`; }
  else { body = itemDesc(key)||'（暂无说明）'; }
  /* === lore 蓝色文学描述：优先 ITEMS.lore，其次 RES_LORE（资源专用） === */
  const lore = (ITEMS[key] && ITEMS[key].lore) || RES_LORE[key] || '';
  return lore ? `${body}<div class="item-lore">${lore}</div>` : body;
}
function itemUsable(k){ if(FOOD[k] || k==='clearMind') return !!FOOD[k] || k==='clearMind'; return false; }
function refreshHUD(){ if(!G) return;
  /* === 首次获得 hook 兜底检查 === */
  G.records=G.records||{};
  if(!G.records.fruitFirstOwned && (G.inventory.fruit||0)>0) G.records.fruitFirstOwned=true;
  if(!G.records.cookedMeatFirstOwned && (G.inventory.cookedMeat||0)>0) G.records.cookedMeatFirstOwned=true;
  if(!G.records.nonWalkVehicleOwned){ if((G.vehicles||[]).some(v=>v.key&&!['walk','dash'].includes(v.key))){ G.records.nonWalkVehicleOwned=true; } }
  /* === 任务自动接取提醒：新变为可见的任务立即 log === */
  if(!G.records.questNotified) G.records.questNotified={};
  for(const t of TASKS){ if(taskVisible(t) && !G.records.questNotified[t.id]){ G.records.questNotified[t.id]=true; log(`📋 已接取 ${t.cat==='main'?'主线':'支线'}任务「${t.name}」，请前往任务界面查看。`); } }
  /* === HUD === */
  const h=G.hero; const mHp=heroDisplayMaxHp(); const hpCls=h.hp< mHp*0.3?'hpfill low':'hpfill';
  const depress = h.depress ? `<span class="stat depress-stat">${termHTML('depress','抑郁')}</span>` : '';
  const psy = Math.max(-100, Math.min(100, (h.psyStress||0)));
  qs('#hud').innerHTML=`<span class="stat">健康 <b>${h.health}</b></span>`+`<span class="stat">天数 <b>${G.day}</b></span>`+`<span class="stat">区域 <b>${G.region==='wild'?'野外':'城市'}</b></span>`+`<span class="stat">攻击 <b>${heroDisplayAtk()}</b></span>`+`<span class="stat">防御 <b>${heroDisplayDef()}</b></span>`+`<span class="stat">生命 <b class="${hpCls}">${h.hp}/${mHp}</b></span>`+`<span class="stat">金币 <b>${G.inventory.coin}</b></span>`+`<span class="stat">行动力 <b>${h.actionPoint}/${h.apCap}</b></span>`+`<span class="stat">心理压力 <b>${psy}</b></span>`+depress;
}
function renderIconbar(){ if(!G) return; const show=[[ '任务',openTasks],['编队',openFormation],['角色',openCharacters],['背包',openInventory],['睡觉',sleep],['设置',openSettings],['商店',openShop],['合成',openCraft],['载具',openVehicles]]; const blocked = (isInFlow()) ? new Set(['编队','睡觉','商店','合成']) : new Set(); qs('#iconbar').innerHTML=show.map(([t,f],i)=>`<button class="icobtn${t==='睡觉'?' sleep':''}${blocked.has(t)?' dis':''}" data-i="${i}">${t}</button>`).join(''); qs('#iconbar').querySelectorAll('.icobtn').forEach(b=>b.onclick=()=>show[+b.dataset.i][1]()); }
function log(msg){ const d=el(`<div class="logline">${msg}</div>`); const body=qs('#logBody'); body.appendChild(d); body.scrollTop=body.scrollHeight; /* 行动记录区无上限，仅战斗开始/结束/睡觉时清除 */ }
function story(html){qs('#storyBody').insertAdjacentHTML('beforeend',`<div>${html}</div>`); qs('#storyBody').scrollTop=qs('#storyBody').scrollHeight;}
function prompt(msg){qs('#promptZone').innerHTML=msg;}
function terms(txt){ if(typeof txt!=='string') return txt; return txt.replace(/【([^】]+)】/g, (m,zh)=> TERM_KEYS[zh]? termHTML(TERM_KEYS[zh], zh) : `<b>${m}</b>`); }
function renderMap(){ const m=G.map; const grid=qs('#mapGrid'); grid.style.gridTemplateColumns=`repeat(${m.n},44px)`; grid.innerHTML=''; for(let y=0;y<m.n;y++){ for(let x=0;x<m.n;x++){ const c=m.cells[y*m.n+x]; const cell=el('<div class="cell"></div>'); if(c.terrain==='obstacle'){cell.classList.add('obstacle');} else if(c.terrain==='void'){cell.classList.add('void');} if(c.terrain!=='void' && c.content && c.content.type) renderCellContent(cell,c); if(G.px===x&&G.py===y){cell.classList.add('player'); cell.classList.add('facing-'+G.hero.facing);} cell.dataset.x=x; cell.dataset.y=y; cell.addEventListener('click',()=>onCellClick(x,y)); grid.appendChild(cell); } } }
function renderCellContent(cell,c){ if(c.content.type==='battle' && !c.content.done){ if(c.content.rare && (G.inventory.roadmap||0)>0){ cell.textContent='🐻'; cell.title='稀有动物'; cell.style.color='#ffd700'; } else if(c.content.sub==='hard'){ cell.textContent='⚠️'; cell.title='紧急作战'; cell.style.color='#ff6b6b'; } else if(c.content.sub==='boss'){ cell.textContent='💀'; cell.title='boss战'; } else { cell.textContent='⚔'; cell.title='作战'; } return; } else if(c.content.type==='loot' && !c.content.done){ cell.textContent='🎁'; cell.title='战利品'; } else if(c.content.type==='event' && !c.content.done){ cell.textContent='❓'; cell.title='事件'; } }
function openSettings(){ const lbl = combatState? '存档（回本次战斗开始时）' : (isInStoryFlow()? '存档（回本次剧情开始时）' : '存档'); openModal('设置', `<div style="display:flex;flex-direction:column;gap:14px"><button class="mbtn big" onclick="saveMenuOpen()">${lbl}</button><button class="mbtn big" onclick="openReadSave()">读档</button><button class="mbtn big" onclick="closeModal();backToMenu()">返回主界面（不存档）</button></div>`, 'small'); const sm=qs('#modalOverlay .modal'); if(sm) sm.classList.add('settingz'); }
function saveMenuOpen(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function openReadSave(){ openReadSaveMenu(); }
function alertDialog(title,msg){ openModal(title, `<p>${msg}</p>`, 'small'); }
function openSaveMenu(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function buildSaveSlotHTML(action){ return savesSlotsHTML(action, loadSaves()); }
function savesSlotsHTML(action,saves){ let h=''; for(let i=0;i<MAX_SAVES;i++){ const s=saves[i]; h+=`<button class="mbtn" onclick="${action==='save'?`doSave(${i})`:`doLoad(${i})`}">`+`存档位 ${i+1}${s?` — 第 ${s.day} 天 · 健康${s.hero.health} · ${new Date(s._ts).toLocaleString()}`:'（空）'}`+`</button>`; } return h; }
window.doSave=function(i){ saveGame(i); log(`已保存到存档位 ${i+1}。`); closeModal(); };
window.doLoad=function(i){ if(loadGame(i)){ loadIntoWorld(); } else{ alert('该存档位为空。'); } };
function openReadSaveMenu(){ openModal('读取存档', buildSaveSlotHTML('load'), 'small'); }
let invMsg='';
let invTab='consumable';
let invSelKey=null;
const INV_CATS=[{id:'consumable',label:'消耗品'},{id:'permanent',label:'永久物品'},{id:'misc',label:'杂物'},{id:'quest',label:'任务道具'}];
function invClassify(key){
  /* 永久物品：ITEMS 里带 permanent:true 的 */
  if(ITEMS[key] && ITEMS[key].permanent) return 'permanent';
  /* 载具类（魔法扫帚等）也归永久物品 */
  if(ITEMS[key] && ITEMS[key].vehicle) return 'permanent';
  /* 其余全部归消耗品（资源、合成品、赠礼品类）；当前无杂物 / 任务道具 */
  return 'consumable';
}
function openInventory(){
  if(G){ invMsg=''; invTab='consumable'; invSelKey=null; renderInventory(); }
}
function renderInventory(){
  const allKeys=Object.keys(G.inventory).filter(k=>k!=='coin' && (G.inventory[k]||0)>0);
  const byCat={consumable:[], permanent:[], misc:[], quest:[]};
  for(const k of allKeys){ const c=invClassify(k); if(byCat[c]) byCat[c].push(k); }
  const currentKeys = byCat[invTab]||[];
  /* 选中检查 */
  if(!currentKeys.includes(invSelKey)) invSelKey = currentKeys[0] || null;
  /* 左侧网格 */
  const tiles = currentKeys.map(k=>{
    const n=G.inventory[k];
    const sel=(k===invSelKey)?' on':'';
    return `<div class="itile inv-cell${sel}" data-k="${k}"><div class="iname craftlink" data-key="${k}">${itemName(k)}</div><div class="icount">×${n}</div></div>`;
  }).join('');
  /* 右侧描述栏 */
  let rightHTML='';
  if(invSelKey){
    const k=invSelKey; const n=G.inventory[k];
    const useBtn = (!isInFlow() && itemUsable(k)) ? `<button class="mbtn tiny invUse" onclick="useInvItem('${k}')">使用</button>` : '';
    rightHTML = `<div class="inv-detail-right">
      <div class="dr-name">${itemName(k)} ×${n} ${useBtn}</div>
      <div class="dr-desc">${terms(itemDetailHTML(k))}</div>
    </div>`;
  } else {
    rightHTML = `<div class="inv-detail-right"><div class="dr-empty">请点击左侧物品查看描述</div></div>`;
  }
  const tabBtns=INV_CATS.map(t=>`<button class="inv-tab ${invTab===t.id?'on':''}" data-id="${t.id}">${t.label}${byCat[t.id]&&byCat[t.id].length?` (${byCat[t.id].length})`:''}</button>`).join('');
  openModal('背包',
    `<div class="invbar"><span class="invtitle">随身物品</span><span class="invcoin">金币 <b>${G.inventory.coin}</b></span></div>`+
    `<div class="inv-tabs">${tabBtns}</div>`+
    (invMsg?`<div class="shopmsg">${invMsg}</div>`:'')+
    `<div class="inv-layout"><div class="inv-grid-left"><div class="vgrid inv">${tiles||'<span class="stempty">此类下没有物品</span>'}</div></div>${rightHTML}</div>`, 'full', {replace:true});
  qs('#modalBody').querySelectorAll('.inv-tab').forEach(b=>b.onclick=()=>{ invTab=b.dataset.id; invSelKey=null; renderInventory(); });
  /* 点击物品选中/取消 */
  qs('#modalBody').querySelectorAll('.inv-cell').forEach(t=>{
    t.onclick=ev=>{
      if(ev.target.classList.contains('craftlink')){ if(window.openItemHelp) openItemHelp(t.dataset.k); return; }
      if(invSelKey===t.dataset.k) invSelKey=null; else invSelKey=t.dataset.k;
      renderInventory();
    };
  });
}
window.useInvItem=function(k){ if(isInFlow()){ invMsg='事件中无法使用背包物品。'; renderInventory(); return; } const n=G.inventory[k]||0; if(n<=0){ renderInventory(); return; }
  /* === 明心浆 === */
  if(k==='clearMind'){
    G.inventory[k]-=1;
    G.hero.psyStress = Math.max(-100, Math.min(100, (G.hero.psyStress||0)+4));
    G.hero.hp = heroDisplayMaxHp();
    G.hero.actionPoint = G.hero.apCap;
    if(G.hero.depress){ G.hero.depress=false; log(`使用了 <b>${itemName(k)}</b>，解除了${termHTML('depress','抑郁')}状态！`); }
    /* 当日 buff */
    G.hero.clearMindBuff = { day:G.day, atkUp:25, dr:25 };
    log(`使用了 <b>${itemName(k)}</b>：生命值与行动力回满，心理压力+4。本日内主角攻击力+25%、受到的伤害-25%。`);
    refreshHUD(); renderInventory(); return;
  }
  /* === 食物 === */
  if(!FOOD[k]){ renderInventory(); return; }
  G.inventory[k]-=1;
  const heal=foodHeal(k); const before=G.hero.hp;
  if(heal && G.hero.hp<heroineMaxHp()){ G.hero.hp=Math.min(heroineMaxHp(), G.hero.hp+heal); }
  log(`使用了 <b>${itemName(k)}</b>，回复 ${G.hero.hp-before} 点生命。`);
  if(k==='fruit' && FOOD[k].healthChance && Math.random()<FOOD[k].healthChance){ G.hero.health+=1; log('果子蕴含生机，你的<b>健康</b>+1。'); }
  /* === 启程任务挂钩：果腹 / 大口吃肉 === */
  if(k==='fruit'){ G.records.qFruitCount = (G.records.qFruitCount||0)+1; }
  if(k==='cookedMeat'){ G.records.qMeatCount = (G.records.qMeatCount||0)+1; }
  refreshHUD(); renderInventory();
};
let modalStack=[];
function openModal(title,html,size,opt){ const ov=qs('#modalOverlay'); if(ov.classList.contains('show') && !(opt&&opt.replace)){ const m=ov.querySelector('.modal'); const sz=m.classList.contains('small')?'small':m.classList.contains('wide')?'wide':m.classList.contains('full')?'full':''; modalStack.push({title:qs('#modalTitle').textContent, html:qs('#modalBody').innerHTML, size:sz}); } const br=ov.querySelector('.btn-row'); if(br){ br.style.display=''; } qs('#modalTitle').textContent=title; const modal=ov.querySelector('.modal'); modal.className='modal'+(size==='small'?' small':(size==='wide'?' wide':(size==='full'?' full':''))); qs('#modalBody').innerHTML=html; const mx=document.getElementById('modalX'); if(mx) mx.style.display=(opt&&opt.noCloseX)?'none':'block'; ov.classList.add('show'); }
function closeModal(){
  // 问题2：离开角色页面时，自动重置选中主角 + 技能展示（不清除其他界面文本）
  try{ if(qs('#modalTitle') && qs('#modalTitle').textContent==='角色'){ charPageKey='pro'; charPageTab='skills'; } }catch(e){}
  qs('#modalOverlay').classList.remove('show'); modalStack.length=0;
}
function onModalX(){ if(swapOpen){ applySwap(); } closeModal(); }
function modalBack(){ if(modalStack.length){ const p=modalStack.pop(); qs('#modalOverlay').classList.remove('show'); openModal(p.title,p.html,p.size); return true; } closeModal(); return false; }

let charPageKey='pro'; let charPageTab='skills';
function openCharacters(){ renderCharacters(); }
function renderCharacters(){
  const keys=['pro',...Object.keys(ALLIES)];
  const tabs=keys.map(k=>`<button class="ctab ${k===charPageKey?'on':''}" data-k="${k}">${getChar(k).name}</button>`).join('');
  openModal('角色',
    `<div class="ctabs">${tabs}</div>`+
    `<div id="charLayout">${charPageLayout(charPageKey)}</div>`,
    'full', {replace:true});
  qs('#modalBody').querySelectorAll('.ctab').forEach(b=>b.onclick=()=>{ charPageKey=b.dataset.k; renderCharacters(); });
  // 事件/战斗中禁用 carry & interact 按钮
  if(isInFlow()){
    document.querySelectorAll('#charLayout .csidebtn').forEach(b=>{
      if(b.dataset && (b.dataset.tab==='carry' || b.dataset.tab==='interact')){
        b.classList.add('dis'); b.disabled=true; b.title='事件/战斗中不可使用';
      }
    });
  }
  interactInit();
}

function charPageLayout(key){
  const c=getChar(key); if(!c) return '';
  const isPro = key==='pro';
  const b = isPro? null : getBond(key);
  const subMap={
    skills:  charShowcase,
    carry:   charCarryTabV2,
    interact: !isPro ? charInteractTab : null,
    story:   charStoryTab,
    bond:    !isPro ? charBondTab : null,
  };
  const canCarryInteract = !(isInFlow());
  const sideTabs = [
    {tab:'skills', label:'天赋与技能', enabled:true},
    {tab:'carry',  label:'多形态技能调整', enabled:canCarryInteract},
    {tab:'interact', label:'交互', enabled:canCarryInteract && !isPro},
    {tab:'bond',   label:'羁绊', enabled:!isPro},
    {tab:'story',  label:'故事', enabled:true},
  ];
  const sideBtns = sideTabs.filter(t=>subMap[t.tab]).map(t=>
    `<button class="csidebtn ${charPageTab===t.tab?'on':''}${t.enabled?'':' dis'}" data-tab="${t.tab}"
      ${t.enabled?`onclick="setCharPageTab('${t.tab}')"`:'disabled'}>${t.label}</button>`
  ).join('');
  const body = (subMap[charPageTab] || charShowcase)(key, c);
  const eleTxt = isPro ? '无属性' : (ELEM[c.element]?.zh || '');
  const atkTxt = isPro ? R(charAtk('pro')) : R(charAtk(key));
  return `
  <div class="char-layout">
    <div class="char-main">
      <div class="char-head-card">
        <div class="char-big-icon" style="background:${c.color||'#444'};background-image:url('assets/skills/${(getSkillIcon((c.skills||[])[0]?.id).file)}');background-size:cover;background-position:center"></div>
        <div class="char-head-info">
          <div class="char-head-name">${c.name}</div>
          <div class="char-head-meta">属性 ${eleTxt} · 攻击 ${atkTxt}</div>
          ${!isPro ? `<div class="char-head-meta">羁绊 Lv.${b.level} · 好感度 ${b.affinity}</div>` : `<div class="char-head-meta">主角 · 无羁绊</div>`}
        </div>
      </div>
      <div class="charPageSub">${body}</div>
    </div>
    <div class="char-side"><div class="csname">${c.name}</div><div class="csbtns">${sideBtns}</div></div>
  </div>`;
}
window.setCharPageTab=function(id){
  const allowed=['skills','carry','interact','bond','story'];
  if(!allowed.includes(id)) return;
  if(isInFlow() && (id==='carry' || id==='interact')) return;
  charPageTab=id; renderCharacters();
};

/* ---- Tab 1：天赋 + 技能 展示（只读，但可以看到哪些已编入技能组） ---- */
function charShowcase(key, c){
  c = c || getChar(key);
  const slots = G.skillGroup || [];
  const talents = (c.passives||[]).map(p => {
    const name = p.scal? talentDisplayName(key,p) : p.name;
    const desc = p.scal? lvDescText(p,entryLevel(key,p)) : terms(p.desc);
    return `<div class="charTalent"><span class="cat talent">天赋</span>${name}：${desc}</div>`;
  }).join('') || '<div class="nohint">（该角色没有天赋）</div>';

  const skills = (c.skills||[]).map(s => {
    const inGroup = slots.find(sl => sl.charKey===key && sl.skillId===s.id);
    const kindCss = SKILL_KIND_CSS[s.kind] || SKILL_KIND_CSS.auto;
    const icon = getSkillIcon(s.id);
    const iconBg = `assets/skills/${icon.file}`;
    const dmgHint = skillDamagePreview(key,s) != null ? ` · 约${R(skillDamagePreview(key,s))}点` : '';
    const cd = s.cd ? ` · 冷却${s.cd}` : '';
    const usedByMe = (c.skills||[]).filter(x=>x.kind===s.kind).length>1;
    const sameKindHint = usedByMe ? '' : '';
    return `<div class="charSkill">
      <span class="sg-tile sg-${s.kind}" style="float:left;margin-right:10px">
        <div class="sg-tile-icon" style="background-image:url('${iconBg}')"></div>
        <div class="sg-tile-label">${s.name.replace(/^(自动|主动|连携)·/,'')}</div>
      </span>
      <b>${s.name}</b>${inGroup?` <span class="carry">[已编入槽${inGroup.slot}]</span>`:''}
      <div class="nohint" style="margin-left:72px;color:#ffffff">${terms(s.desc)}${dmgHint}${cd}</div>
      <div style="clear:both"></div>
    </div>`;
  }).join('') || '<div class="nohint">（该角色没有技能）</div>';

  return `
    <div class="sec"><b>天赋</b></div>
    ${talents}
    <div class="sec"><b>技能</b>（常规技能统一在编队界面「编辑技能组」中管理；这里仅展示）</div>
    ${skills}
    <div class="nohint" style="margin-top:8px">想要调整编入哪些技能 / 顺序 / 多角色混搭？去 <b>编队</b> → <b>编辑技能组</b>。</div>
  `;
}

/* ---- Tab 2：多形态技能调整（带 elementChoices 或 bindElement 的技能才有内容） ---- */
function charCarryTabV2(key, c){
  c = c || getChar(key);
  const specials = (c.skills||[]).filter(s => s.elementChoices || s.bindElement);
  if(!specials.length){
    return `<div class="nohint">该角色没有多形态技能（元素选择 / 类型切换）。常规技能的调整统一在编队界面「编辑技能组」里完成。</div>`;
  }
  return specials.map(s => {
    const cur = (G.skillGroup || []).find(sl => sl.charKey===key && sl.skillId===s.id);
    const choices = s.elementChoices || (s.bindElement ? ['fire','water','thunder','ice','wind'] : []);
    const btns = choices.map(elem => {
      const e = ELEM[elem]; if(!e) return '';
      const active = s._elemChoice === elem ? ' on' : '';
      return `<button class="mbtn tiny${active}" onclick="sgSetCharElem('${key}','${s.id}','${elem}')" style="background:${e.c||'#444'}">${e.zh}</button>`;
    }).join('');
    return `<div class="charSkill">
      <b>${s.name}</b>${cur?` <span class="carry">[已编入槽${cur.slot}]</span>`:''}
      <div class="nohint" style="color:#ffffff">${terms(s.desc)}</div>
      <div style="margin-top:6px">元素选择：${btns}</div>
    </div>`;
  }).join('');
}
window.sgSetCharElem = function(charKey, skillId, elem){
  const c = getChar(charKey); if(!c) return;
  const sk = (c.skills||[]).find(x => x.id===skillId); if(!sk) return;
  sk._elemChoice = elem;
  log(`${c.name} · ${sk.name} 的元素已切换为 ${ELEM[elem]?.zh||elem}。`);
  renderCharacters();
};

function charBondTab(key,c){
  c=c||getChar(key);
  if(key==='pro') return '<p>主角没有羁绊等级。</p>';
  const bt=(BOND_TEXT[key])||{};
  let rows='';
  for(let lv=0; lv<=10; lv++){
    const note=bt[lv]||'';
    const cur=getBond(key).level===lv? '（当前）':'';
    rows+=`<div class="bondrow ${getBond(key).level===lv?'cur':''}"><span class="bondlv">羁绊 ${lv} 级${cur}</span><span class="bondnote">${note}</span></div>`;
  }
  return `<div class="bondrows">${rows}</div><p style="margin-top:10px;font-size:13px;color:#9aa0ac">基础效果：羁绊每升 1 级，攻击力 +10；标注有等级的技能的等级对应提升。好感度每累计 10 点提升 1 级，羁绊等级只升不降。当前好感度 <b class="lvlup">${getBond(key).affinity}</b>（上限 999，下限 -999）。</p>`;
}

function charStoryTab(key,c){
  c=c||getChar(key);
  if(key==='pro') return '<p>属于你的故事，才刚刚开始……</p>';
  return `<p>关于 <b>${c.name}</b> 的故事，正在撰写中，敬请期待。</p>`;
}

/* ============== 角色交互系统 ============== */
let interTick = {};      // 打字机定时器 per key
let interHist = {};      // 历史对话 DOM 节点列表 per key
let interTyping = {};    // 正在打的完整 html 文本 per key
let giftOpenKey = null;
let giftSelItem = null;
let giftJustOpened = false;
let swapOpen = false;
let swapJustOpened = false;

function interactInit(){
  // 空占位：对话历史在 charInteractTab 渲染时从 interHist 恢复
}

/* 聊天/投喂/送礼 的路由 */
window.interactAction = function(key, act){
  if(act==='chat') interactChat(key);
  else if(act==='feed') interactFeed(key);
  else if(act==='gift') openGift(key);
};

/* 打字机效果：把 html 逐字打进对话区 */
function startInterType(key, html){
  const dlg = qs('#interactDlg_'+key); if(!dlg) return;
  if(interTick['t'+key]) clearInterval(interTick['t'+key]);
  const plain = html.replace(/<[^>]+>/g,'');
  const node = document.createElement('div');
  node.className = 'iline typing';
  dlg.appendChild(node);
  dlg.scrollTop = dlg.scrollHeight;
  let i = 0;
  interTick['t'+key] = setInterval(()=>{
    i = Math.min(i+1, plain.length);
    node.innerHTML = escapeHtml(plain.slice(0,i)) + (i<plain.length?'<span class="story-caret"></span>':'');
    dlg.scrollTop = dlg.scrollHeight;
    if(i>=plain.length){
      clearInterval(interTick['t'+key]); interTick['t'+key]=null;
      node.innerHTML = html; node.classList.remove('typing');
      interTyping[key] = null;
      interHist[key] = interHist[key] || [];
      interHist[key].push({el:node, html});
      while(interHist[key].length > 5){
        const oldest = interHist[key].shift();
        if(oldest && oldest.el && oldest.el.parentNode) oldest.el.parentNode.removeChild(oldest.el);
      }
    }
  }, 1000/40);
}

/* 说一段话到对话区 */
function interactSay(key, html){
  const dlg = qs('#interactDlg_'+key);
  if(!dlg){
    interHist[key] = interHist[key] || [];
    interHist[key] = interHist[key].slice(-5);
    startInterType(key, html);
    return;
  }
  const oldNode = dlg.querySelector('.iline.typing');
  const oldHtml = interTyping[key];
  if(oldNode && oldHtml){
    oldNode.innerHTML = oldHtml; oldNode.classList.remove('typing');
    if(interTick['t'+key]){ clearInterval(interTick['t'+key]); interTick['t'+key]=null; }
    interHist[key] = interHist[key] || [];
    interHist[key].push({el:oldNode, html:oldHtml});
    while(interHist[key].length > 5){
      const oldest = interHist[key].shift();
      if(oldest && oldest.el && oldest.el.parentNode) oldest.el.parentNode.removeChild(oldest.el);
    }
  } else {
    if(interTick['t'+key]){ clearInterval(interTick['t'+key]); interTick['t'+key]=null; }
  }
  // 保证对话区已完成消息不超过 5 条
  while(true){
    let doneCount=0, firstDone=null;
    for(const c of dlg.children){
      if(c.classList && c.classList.contains('iline') && !c.classList.contains('typing')){
        doneCount++; if(!firstDone) firstDone=c;
      }
    }
    if(doneCount < 5) break;
    if(firstDone) firstDone.parentNode.removeChild(firstDone);
  }
  interTyping[key] = html;
  startInterType(key, html);
}

/* 陆悠悠聊天成功率状态 */
function lyChatState(){
  G.records = G.records || {};
  if(!G.records.lychat) G.records.lychat = { day:0, base:0, cur:0 };
  const s = G.records.lychat;
  const day = G.day || 1;
  if(s.day !== day){ s.day = day; s.base = Math.round(Math.random()*80-20); s.cur = s.base; }
  return s;
}

function interactChat(key){
  const c = getChar(key);
  if((G.hero.actionPoint||0) < 1){ interactSay(key, `你的行动力不足，无法与 ${c.name} 聊天。（聊天需消耗 1 行动力）`); return; }
  G.hero.actionPoint -= 1; refreshHUD();
  if(key === 'xiayang'){
    if(Math.random() < 0.5){
      gainAffinity(key, 1);
      interactSay(key, `${c.name}：你讲了个烤熊掌的笑话，夏阳先是愣了一下，随后笑出了声。……你俩相谈甚欢。<span class="lvlup">好感度+1</span>（消耗 1 行动力）`);
    } else {
      interactSay(key, `你聊起路上的见闻，夏阳却只是「嗯嗯」地点着头，明显兴致缺缺。<span class="lvlup">好感度+0</span>（消耗 1 行动力）`);
    }
  } else if(key === 'luyouyou'){
    const st = lyChatState();
    const curInt = Math.round(st.cur);
    const ok = curInt>=0 && Math.random()*100 < curInt;
    if(ok){
      const add = Math.round(2+Math.random()*2);
      st.cur = Math.max(0, Math.min(100, curInt+add));
      gainAffinity(key, 1);
      interactSay(key, `${c.name}：哈哈，你说话真有意思，我很受用。<span class="lvlup">好感度+1</span>（本日聊天成功率 +${add}%，消耗 1 行动力）`);
    } else {
      const sub = Math.round(2+Math.random()*2);
      st.cur = Math.max(0, Math.min(100, curInt-sub));
      interactSay(key, `${c.name}：嗯……这句就没那么有趣了。我再看下路线。<span class="lvlup">好感度+0</span>（本日聊天成功率 -${sub}%，消耗 1 行动力）`);
    }
  }
}

function interactFeed(key){
  if(key !== 'xiayang') return;
  const c = getChar(key);
  const foods = Object.keys(FOOD).filter(k=>(G.inventory[k]||0)>0);
  if(!foods.length){ interactSay(key, `你翻遍了背包，也没有任何可以投喂的食物。`); return; }
  let chosen=null, ch=null;
  for(const f of foods){ const h=foodHeal(f); if(chosen===null||h<ch){ chosen=f; ch=h; } }
  G.inventory[chosen]--;
  G.records = G.records || {};
  if(!G.records.feedDay) G.records.feedDay = {};
  const day = G.day || 1;
  const first = G.records.feedDay[key] !== day;
  if(first){ G.records.feedDay[key] = day; gainAffinity(key, 1); }
  refreshHUD();
  interactSay(key, first
    ? `${c.name}：你投喂了 ${itemName(chosen)}。夏阳眼睛一亮，几口就吃完了。<span class="lvlup">好感度+1</span>`
    : `${c.name}：你投喂了 ${itemName(chosen)}，但夏阳已经吃饱了，摆摆手。<span class="lvlup">好感度+0</span>（每天仅第一次投喂提升好感度）`);
}

/* 送礼相关 */
function giftCooldownLeft(key){
  G.records = G.records || {};
  const gd = (G.records.giftDay||{})[key];
  if(gd == null) return 0;
  return Math.max(0, 3 - ((G.day||1) - gd));
}
function giftableItems(){ return Object.keys(G.inventory).filter(k=>(G.inventory[k]||0)>0 && !GIFT_EXCLUDE.includes(k)); }

function openGift(key){
  giftOpenKey = key; giftSelItem = null; giftJustOpened = true;
  renderInteractBody(key);
  decorateGiftCells();
}

function decorateGiftCells(){
  const box = qs('#giftOverlay'); if(!box) return;
  if(giftCooldownLeft(giftOpenKey) > 0) return;
  box.querySelectorAll('.gift-cell').forEach(c => {
    c.onclick = () => {
      const k = c.dataset.k;
      const wasSel = c.classList.contains('sel');
      box.querySelectorAll('.gift-cell.sel').forEach(x=>x.classList.remove('sel'));
      if(!wasSel){ c.classList.add('sel'); giftSelItem = k; } else { giftSelItem = null; }
    };
  });
}

function confirmGift(){
  const key = giftOpenKey; if(!key || !giftSelItem) return;
  if(giftCooldownLeft(key) > 0) return;
  const it = giftSelItem;
  const lv = itemLoveLevel(key, it);
  const L = ITEM_LOVE[key] || {};
  let delta=0, talk='';
  if(lv===0){ delta=-1; talk = GIFT_TALK[key]?.lv0 || ''; }
  else if(lv===1){ delta=1; talk = GIFT_TALK[key]?.lv1 || ''; }
  else if(lv===2){ delta = (L.two && L.two[it]) || 0; talk = GIFT_TALK[key]?.lv2 || ''; }
  else { delta = ((L.three && L.three[it])||0) + 5; talk = GIFT_TALK[key]?.['lv3_'+it] || GIFT_TALK[key]?.lv2 || ''; }
  G.inventory[it]--;
  G.records = G.records || {};
  if(!G.records.giftDay) G.records.giftDay = {};
  G.records.giftDay[key] = G.day || 1;
  const overlay = document.getElementById('giftOverlay');
  if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  giftOpenKey = null; giftSelItem = null;
  if(delta !== 0){ gainAffinity(key, delta); refreshHUD(); }
  interactSay(key, `${talk} <span class="lvlup">好感度${delta>0?'+delta':delta}</span>`.replace('delta', delta));
}

function closeGift(){
  if(giftOpenKey == null) return;
  const overlay = document.getElementById('giftOverlay');
  if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  giftOpenKey = null; giftSelItem = null;
}

/* 渲染交互 tab 的内容（对话区 + 按钮），送礼时覆盖一个 giftOverlay */
function renderInteractBody(key){
  const c = getChar(key); if(!c) return '';
  // 恢复历史对话 DOM（interHist 里有节点引用的话直接保留，否则重新生成）
  let restoreHTML = '';
  const saved = interHist[key] || [];
  // 检查对话框是否已存在
  const oldDlg = qs('#interactDlg_'+key);
  // 构建操作按钮
  const feedBtn = (key==='xiayang')
    ? `<button class="mbtn small ilbtn" data-act="feed" onclick="interactAction('${key}','feed')">投喂</button>` : '';
  const chatLabel = (key==='luyouyou') ? (()=>{ try{ return `聊天（成功率 ${Math.max(0,Math.min(100,Math.round(lyChatState().cur)))}%）`; }catch(e){ return '聊天'; } })() : '聊天';
  // 渲染整个交互区替换当前 charPageSub 的内容
  const wrapper = qs('#charLayout .charPageSub');
  if(!wrapper) return;
  // 如果 gift 打开了，gift overlay 覆盖在对话框上
  const cd = giftCooldownLeft(key);
  const canGift = cd <= 0;
  const giftCdTxt = canGift ? '' : `<span style="margin-left:8px;color:#9aa0ac">送礼冷却 ${cd} 天</span>`;
  let giftGridHTML = '';
  if(giftOpenKey === key){
    const items = giftableItems();
    const cells = items.map(it =>
      `<div class="gift-cell ${giftSelItem===it?'sel':''}" data-k="${it}">
        <div class="gift-cname">${itemName(it)}</div>
        <div class="gift-count">×${G.inventory[it]}</div>
      </div>`).join('') || '<span class="nohint">背包里没有可送的物品。</span>';
    giftGridHTML = `<div id="giftOverlay">
      <div class="gift-head">选择礼物${giftCdTxt}</div>
      <div class="gift-grid">${cells}</div>
      <div class="gift-foot">
        <button class="mbtn small" onclick="confirmGift()" ${canGift?'':'disabled'}>确认送出</button>
        <button class="mbtn small" onclick="closeGift()">取消</button>
      </div>
    </div>`;
  }
  const newHTML = `
    <div class="interact-wrap">
      <div class="ilbtns">
        <button class="mbtn small ilbtn" data-act="chat" onclick="interactAction('${key}','chat')">${chatLabel}</button>
        ${feedBtn}
        <button class="mbtn small ilbtn" data-act="gift" onclick="interactAction('${key}','gift')">送礼${giftCdTxt}</button>
      </div>
      <div class="ilhint">消耗行动力聊天可以提升好感度。每天首次投喂/送礼也会提升。好感度每 10 点 = 羁绊升 1 级。</div>
      <div id="interactDlg_${key}" class="ilchat">${restoreHTML}</div>
      ${giftGridHTML}
    </div>`;
  wrapper.innerHTML = newHTML;
}

/* 角色页面"交互" tab 的渲染入口 */
function charInteractTab(key, c){
  c = c || getChar(key); if(!c) return '';
  if(key === 'pro') return '<p>主角没有交互 tab。</p>';
  // 用 MutationObserver + requestAnimationFrame 确保 DOM 渲染完成后再挂送礼 overlay
  setTimeout(()=>renderInteractBody(key), 0);
  // 先返回一个空容器（实际内容由 renderInteractBody 填充）
  return `<div class="interact-wrap"><div class="nohint">加载中…</div></div>`;
}

/* ---- 多队列编队系统 ---- */
function ensureFormations(){
  if(!G.formations || G.formations.length<4){
    G.formations = [
      { team:['pro','xiayang','luyouyou'], skillGroup: buildDefaultSkillGroup(['pro','xiayang','luyouyou']) },
      { team:[], skillGroup:[] },
      { team:[], skillGroup:[] },
      { team:[], skillGroup:[] },
    ];
  }
  G.activeFormation = G.activeFormation || 0;
}

let teamEditorIdx = -1;   // 当前正在编辑的队列序号（-1 表示关闭角色选择页面）
let teamEditorSlots = []; // 编辑中临时的 team 数组（最多 3 格，空位 null）

function openFormation(){
  if(isInFlow()){ log(`${flowLabel()}中无法使用该功能。`); return; }
  ensureFormations();
  teamEditorIdx = -1;
  renderFormation();
}

function toggleTeamChar(i, k){
  /* 角色选择页面：点击=选中/取消，不检查合法性，最多 3 人 */
  const idx = teamEditorSlots.indexOf(k);
  if(idx>=0){ teamEditorSlots[idx] = null; }
  else {
    const empty = teamEditorSlots.indexOf(null);
    if(empty>=0){ teamEditorSlots[empty] = k; }
    else { log('队列最多 3 人，请先取消再选择。'); return; }
  }
  renderFormation();
}

function applyTeamEdit(){
  if(teamEditorIdx<0) return;
  const cleaned = teamEditorSlots.filter(Boolean);
  G.formations[teamEditorIdx].team = cleaned.slice();
  // 技能组默认用 buildDefaultSkillGroup（只包含队伍角色的默认技能）
  G.formations[teamEditorIdx].skillGroup = buildDefaultSkillGroup(cleaned);
  teamEditorIdx = -1;
  renderFormation();
}

function openTeamEditor(i){
  ensureFormations();
  teamEditorIdx = i;
  const cur = G.formations[i].team || [];
  teamEditorSlots = [ cur[0]||null, cur[1]||null, cur[2]||null ];
  renderFormation();
}

function activateFormation(i){
  ensureFormations();
  const f = G.formations[i];
  if(!f.team.includes('pro')){ log('该队列不含主角，无法启用。'); return; }
  G.team = f.team.slice();
  // 若队列已有 skillGroup 则用它，否则 buildDefaultSkillGroup
  G.skillGroup = (f.skillGroup && f.skillGroup.length)
    ? f.skillGroup.slice()
    : buildDefaultSkillGroup(G.team);
  G.activeFormation = i;
  log(`已启用 <b>队列 ${i+1}</b>：${G.team.map(k=>getChar(k).name).join('、')}。`);
  refreshHUD();
  renderFormation();
}

function renderFormation(){
  ensureFormations();
  const ELEM_BG = { fire:'#e74c3c', water:'#4a9bff', grass:'#5fd96b', thunder:'#c05bff', ice:'#4fd8d8', wind:'#78c7f2', rock:'#b09a73' };
  const rows = G.formations.map((f,i)=>{
    const isActive = (G.activeFormation===i);
    // ---- 角色格（3 个正方形 tile）----
    const charsHTML = [];
    const slotLabels = ['主','2','3'];
    const allCharKeys = ['pro', ...Object.keys(ALLIES)];
    for(let s=0;s<3;s++){
      const k = f.team[s];
      if(k){
        const c = getChar(k);
        const eleKey = c?.element;
        const bg = c?.color || (eleKey && ELEM_BG[eleKey]) || '#555';
        const label = k==='pro' ? '主' : (c?.name ? c.name[0] : '?');
        const posInAll = allCharKeys.indexOf(k);
        charsHTML.push(`<div class="fm-char-tile ${isActive?'active':''}" style="background:${bg}" data-i="${s}" data-k="${k}" onclick="openTeamEditor(${i})">
          <span class="fm-char-init">${label}</span>
        </div>`);
      } else {
        charsHTML.push(`<div class="fm-char-tile fm-empty" data-i="${s}" onclick="openTeamEditor(${i})">
          <span class="fm-empty-hint">+</span>
        </div>`);
      }
    }
    // ---- 技能组预览（扁平一行，边框颜色辨 kind，不显示 kind 文字标签）----
    const kindBrdF = { active:'#ff6b6b', auto:'#5c9bff', link:'#ffcc4d' };
    const fGroup = (f.skillGroup||[]).slice();
    fGroup.sort((a,b) => {
      const oa = a.kind==='active' ? 0 : a.kind==='auto' ? 1 : 2;
      const ob = b.kind==='active' ? 0 : b.kind==='auto' ? 1 : 2;
      return oa !== ob ? oa-ob : 0;
    });
    let skillGroupHTML = '';
    if(!fGroup.length){
      skillGroupHTML = `<span class="fm-sg-empty">（空）</span>`;
    } else {
      skillGroupHTML = `<div class="fm-sg-flat">` + fGroup.map(s => {
        const ck = s.charKey; const c = getChar(ck); if(!c) return '';
        const sk = (c.skills||[]).find(x=>x.id===s.skillId); if(!sk) return '';
        const brd = kindBrdF[sk.kind] || '#888';
        const ic = getSkillIcon(s.skillId);
        return `<div class="fm-sg-tile" style="border:2px solid ${brd}" title="${sk.name}">
          <div class="sg-tile-icon" style="background-image:url('assets/skills/${ic.file}')"></div>
          <div class="sg-tile-label">${sk.name}</div>
        </div>`;
      }).join('') + `</div>`;
    }

    // ---- 每队一行 HTML ----
    const activeTag = isActive ? `<span style="color:#d9b64a;font-size:11px;font-weight:700;margin-left:4px">● 启用中</span>` : '';
    return `<div class="fm-row ${isActive?'fm-row-on':''}">
      <div class="fm-row-head"><b>队列 ${i+1}</b>${activeTag}</div>
      <div class="fm-chars">${charsHTML.join('')}</div>
      <div class="fm-skill-group">${skillGroupHTML}</div>
      <div class="fm-actions">
        <button onclick="openTeamEditor(${i})">快捷编队</button>
        <button onclick="openSkillGroupEditor(${i})">编辑技能组</button>
        <button class="fm-activate" onclick="activateFormation(${i})">启用</button>
      </div>
    </div>`;
  }).join('');

  /* ---- 角色选择覆盖层 ---- */
  let pickerHTML = '';
  if(teamEditorIdx>=0){
    const allKeys = ['pro', ...Object.keys(ALLIES)];
    const pickCells = allKeys.map(k=>{
      const c = getChar(k);
      const eleZh = k==='pro' ? '无属性' : (ELEM[c.element]?.zh||'');
      const pos = teamEditorSlots.indexOf(k);
      const inTeam = pos>=0;
      const badge = inTeam ? `<div class="fpnum">${pos+1}</div>` : '';
      const eleCls = (k==='pro' || !c.element) ? '' : (ELEM[c.element]?.c || '');
      return `<div class="fpchar ${inTeam?'in':''} ${eleCls}" onclick="toggleTeamChar(${teamEditorIdx},'${k}')">
        ${badge}
        <div class="fpchar-icon" style="background:${c.color||'#444'}"></div>
        <div class="fpchar-name">${c.name}</div>
        <div class="fpchar-ele">${eleZh}</div>
      </div>`;
    }).join('');
    pickerHTML = `<div class="f-picker">
      <div class="f-picker-head">队列 ${teamEditorIdx+1} · 角色选择（点击=选中/取消，不检查合法性）</div>
      <div class="f-picker-slots">
        ${teamEditorSlots.map(k=>{
          if(k){ const c=getChar(k); return `<div class="fp-slot filled"><div class="fpchar-icon" style="background:${c.color||'#444'}"></div><div>${c.name}</div></div>`; }
          return `<div class="fp-slot empty">空位</div>`;
        }).join('')}
      </div>
      <div class="f-picker-grid">${pickCells}</div>
      <div class="f-picker-foot">
        <button class="mbtn small" onclick="teamEditorIdx=-1; renderFormation();">取消</button>
        <button class="mbtn small primary" onclick="applyTeamEdit()">确认</button>
      </div>
    </div>`;
  }

  openModal('编队',
    `<div class="form-head">
       <span class="form-title">多队列编队（4 队）</span>
     </div>
     <div class="form-wrap"><div class="formation-list">${rows}</div></div>
     ${pickerHTML}`,
    'full', {replace:true});
}

/* ---- 技能组编辑器（按队列打开） ---- */
function openSkillGroupEditor(i){
  ensureFormations();
  window.__sgIdx = i;
  window.__sgSel = null;
  openModal(`技能组编辑器 · 队列 ${i+1}`, sgEditorHTML(i), 'full', {replace:true});
  _bindSkillGroupEditorEvents();
}

let sgEditorCache = null;   // { group, queueIdx }
let sgEditorSel = null;     // { skillId, charKey } 当前选中的可选/已装备技能，用于右上详细描述

window.sgNewEditor = function(queueIdx){
  ensureFormations();
  sgEditorCache = {
    group: (G.formations[queueIdx].skillGroup || []).map(s => ({...s})),
    queueIdx,
  };
  sgEditorSel = null;
};

function sgEditorHTML(qIdx){
  const F = G.formations[qIdx] || (ensureFormations(), G.formations[qIdx]);
  const team = F.team || [];
  const teamSize = team.length;
  const maxSlots = Math.min(10, 4 + teamSize);
  const group = (F.skillGroup || []).slice();
  // active→auto→link 先排
  group.sort((a,b) => {
    const oa = a.kind==='active' ? 0 : a.kind==='auto' ? 1 : 2;
    const ob = b.kind==='active' ? 0 : b.kind==='auto' ? 1 : 2;
    return oa !== ob ? oa-ob : 0;
  });
  const curSel = window.__sgSel || null;
  const kindBrd = { active:'#ff6b6b', auto:'#5c9bff', link:'#ffcc4d' };

  // 右上：选中技能描述（照抄原文，不加工）
  let descHTML = '<div class="sg-desc-empty">点任意技能查看描述</div>';
  if(curSel){
    const [ck, sid] = curSel.split(':');
    const c = getChar(ck);
    const sk = c ? (c.skills||[]).find(x => x.id===sid) : null;
    if(sk){
      descHTML = `
        <div class="sg-desc-name">${c.name} · ${sk.name}</div>
        <div class="sg-desc-text">${sk.desc||''}</div>
      `;
    }
  }

  // 左上：可选技能（按角色分块）
  let pickHTML = '';
  const picked = new Set(group.map(s => s.charKey + '::' + s.skillId));
  for(const ck of team){
    const c = getChar(ck); if(!c) continue;
    const owned = (c.skills||[]).filter(s => (s.kind==='active'||s.kind==='auto'||s.kind==='link') && !picked.has(ck+'::'+s.id));
    if(!owned.length) continue;
    pickHTML += `<div class="sg-pick-char-block">
      <div class="sg-pick-char-name">${c.name}</div>
      <div class="sg-pick-tiles-row">
        ${owned.map(s => {
          const brd = kindBrd[s.kind] || '#888';
          const isSel = curSel === `${ck}:${s.id}`;
          const ic = getSkillIcon(s.id);
          return `<div class="sg-tile sg-pick${isSel?' sg-sel':''}"
            data-ck="${ck}" data-sid="${s.id}" data-kind="${s.kind}"
            style="border:2px solid ${brd}" title="${s.name}">
            <div class="sg-tile-icon" style="background-image:url('assets/skills/${ic.file}')"></div>
            <div class="sg-tile-label">${s.name}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // 下方：扁平一行技能组
  let groupHTML = '';
  if(!group.length){
    groupHTML = `<div class="sg-group-empty">（技能组为空，点左上技能直接加入）</div>`;
  } else {
    groupHTML = `<div class="sg-group-flat-row">` + group.map((s, idx) => {
      const c = getChar(s.charKey); const sk = (c?.skills||[]).find(x=>x.id===s.skillId);
      if(!sk) return '';
      const brd = kindBrd[sk.kind] || '#888';
      const isSel = curSel === `${s.charKey}:${s.skillId}`;
      const ic = getSkillIcon(s.skillId);
      return `<div class="sg-tile sg-group${isSel?' sg-sel':''}"
        data-idx="${idx}" data-kind="${sk.kind}"
        draggable="true" style="border:2px solid ${brd}" title="${sk.name}（${c?.name||''}）">
        <div class="sg-tile-icon" style="background-image:url('assets/skills/${ic.file}')"></div>
        <div class="sg-tile-label">${sk.name}</div>
      </div>`;
    }).join('') + `</div>`;
  }

  return `
    <div class="sg-root">
      <div class="sg-top-panes">
        <div class="sg-pane sg-pane-pick">
          <div class="sg-pane-head">可选技能</div>
          <div class="sg-pane-body">${pickHTML || '<div class="sg-empty">没有可用技能。</div>'}</div>
        </div>
        <div class="sg-pane sg-pane-desc">
          <div class="sg-pane-head">详细描述</div>
          <div class="sg-pane-body">${descHTML}</div>
        </div>
      </div>
      <div class="sg-bottom">
        <div class="sg-bottom-head">当前技能组（${group.length}/${maxSlots}）</div>
        ${groupHTML}
      </div>
    </div>
  `;
}

/* 可选技能 tile（不可拖，加 kind 边框颜色） */
function _sgPickTile(skill, charKey, selected, kindBrd){
  if(!skill) return '';
  const kind = skill.kind || 'auto';
  const icon = getSkillIcon(skill.id);
  const bgImg = `background-image:url('assets/skills/${icon.file}')`;
  const selCls = selected ? ' sg-sel' : '';
  const borderColor = (kindBrd && kindBrd[kind]) || '#999';
  return `<div class="sg-tile sg-${kind}${selCls}" data-skill-id="${skill.id}" data-char-key="${charKey}"
    style="border:2px solid ${borderColor}"
    onclick="sgPickClick('${charKey}','${skill.id}')">
      <div class="sg-tile-icon" style="${bgImg}"></div>
      <div class="sg-tile-label">${skill.name.replace(/^(自动|主动|连携)·/,'')}</div>
    </div>`;
}

/* 已装备技能 tile（可拖、可点击；加 kind 边框颜色；带 data-kind + data-group-idx） */
function _sgGroupTile(skill, charKey, opts){
  if(!skill) return '';
  const kind = skill.kind || 'auto';
  const icon = getSkillIcon(skill.id);
  const bgImg = `background-image:url('assets/skills/${icon.file}')`;
  const selCls = opts && opts.sel ? ' sg-sel' : '';
  const borderColor = (opts && opts.borderColor) || '#999';
  const groupIdx = (opts && opts.groupIdx) != null ? opts.groupIdx : 0;
  return `<div class="sg-tile sg-${kind}${selCls}" draggable="true"
    data-skill-id="${skill.id}" data-char-key="${charKey}"
    data-kind="${kind}" data-group-idx="${groupIdx}"
    style="border:2px solid ${borderColor}"
    title="${skill.name}（点击切换选中/卸下 · 同 kind 内拖拽排序）"
    onclick="sgGroupClick('${charKey}','${skill.id}')">
      <div class="sg-tile-icon" style="${bgImg}"></div>
      <div class="sg-tile-label">${skill.name.replace(/^(自动|主动|连携)·/,'')}</div>
      <div class="sg-tile-owner" style="font-size:9px;color:#9aa0ac;">${getChar(charKey)?.name||''}</div>
    </div>`;
}

/* 点击可选技能：设选中 + 加入技能组 + 重绘 */
window.sgPickClick = function(charKey, skillId){
  const E = sgEditorCache;
  if(!E) return;
  const exists = E.group.some(s => s.charKey===charKey && s.skillId===skillId);
  if(exists){ log('该技能已在技能组。'); return; }
  const c = getChar(charKey); const sk = (c?.skills||[]).find(x=>x.id===skillId);
  if(!sk) return;
  // 同 kind 内部保持顺序；新技能直接 push（保存时再统一按 kind 重排）
  E.group.push({ charKey, skillId });
  sgEditorSel = { charKey, skillId };
  _renderSG();
};

/* 点击已装备 tile：
   - 如果当前 selected 就是这个 → 卸下 + 清空 selected
   - 否则 → 设 selected（显示右上详细描述）+ 重绘 */
window.sgGroupClick = function(charKey, skillId){
  const E = sgEditorCache; if(!E) return;
  const isSel = sgEditorSel && sgEditorSel.charKey===charKey && sgEditorSel.skillId===skillId;
  if(isSel){
    // 已选中 → 卸下
    E.group = E.group.filter(s => !(s.charKey===charKey && s.skillId===skillId));
    sgEditorSel = null;
  } else {
    // 未选中 → 设为选中（右上显示详细描述）
    sgEditorSel = { charKey, skillId };
  }
  _renderSG();
};

function _renderSG(){
  const qIdx = window.__sgIdx || 0;
  qs('#modalBody').innerHTML = sgEditorHTML(qIdx);
  _bindSkillGroupEditorEvents();
}

function _bindSkillGroupEditorEvents(){
  const root = document.getElementById('modalBody'); if(!root) return;
  const qIdx = window.__sgIdx || 0;
  ensureFormations();
  const F = G.formations[qIdx];
  const team = F.team || [];
  const teamSize = team.length;
  const maxSlots = Math.min(10, 4 + teamSize);

  // 左上品可加入
  root.querySelectorAll('.sg-pick').forEach(tile => {
    tile.onclick = () => {
      const ck = tile.dataset.ck; const sid = tile.dataset.sid; const kind = tile.dataset.kind;
      let g = (F.skillGroup||[]).slice();
      g.sort((a,b) => {
        const oa = a.kind==='active' ? 0 : a.kind==='auto' ? 1 : 2;
        const ob = b.kind==='active' ? 0 : b.kind==='auto' ? 1 : 2;
        return oa !== ob ? oa-ob : 0;
      });
      // 点第一次 = 设选中；点第二次（同一个已选中的）= 加入
      if(window.__sgSel === `${ck}:${sid}`){
        // 已选中 → 执行合法性检查 + 加入
        if(g.length >= maxSlots){ log(`技能组已满（最多 ${maxSlots} 个）。`); return; }
        if(g.some(s=>s.charKey===ck && s.skillId===sid)){ log('已在技能组里。'); window.__sgSel=null; return; }
        const ac = g.filter(s=>s.kind==='active').length;
        if(kind==='active' && ac >= 4){ log('最多 4 个主动技能。'); return; }
        g.push({ charKey:ck, skillId:sid, kind });
        F.skillGroup = g;
        // 加入后仍然保持选中（不自动清）
      } else {
        window.__sgSel = `${ck}:${sid}`;
      }
      qs('#modalBody').innerHTML = sgEditorHTML(qIdx);
      _bindSkillGroupEditorEvents();
    };
  });

  // 下方已装备 tile
  root.querySelectorAll('.sg-group').forEach(tile => {
    tile.onclick = () => {
      const idx = +tile.dataset.idx;
      let g = (F.skillGroup||[]).slice();
      const cur = g[idx]; if(!cur) return;
      const thisKey = `${cur.charKey}:${cur.skillId}`;
      if(window.__sgSel === thisKey){
        g.splice(idx, 1);   // 直接按 idx 卸任意位置，不卡顺序
        F.skillGroup = g;
        window.__sgSel = g.length ? `${g[0].charKey}:${g[0].skillId}` : null;
      } else {
        window.__sgSel = thisKey;
      }
      qs('#modalBody').innerHTML = sgEditorHTML(qIdx);
      _bindSkillGroupEditorEvents();
    };
  });

  // 拖拽：同 kind 内
  let dragState = null;
  root.querySelectorAll('.sg-group').forEach(tile => {
    tile.setAttribute('draggable','true');
    tile.addEventListener('dragstart', e => {
      dragState = { idx: +tile.dataset.idx, kind: tile.dataset.kind };
    });
    tile.addEventListener('dragover', e => {
      e.preventDefault();
      if(dragState && dragState.kind === tile.dataset.kind){
        tile.style.outline = '2px dashed #d9b64a';
      }
    });
    tile.addEventListener('dragleave', () => { tile.style.outline = ''; });
    tile.addEventListener('drop', e => {
      e.preventDefault();
      tile.style.outline = '';
      if(!dragState) return;
      if(dragState.kind !== tile.dataset.kind){ log('只能在同类型技能内拖拽排序。'); dragState=null; return; }
      const from = dragState.idx;
      const to = +tile.dataset.idx;
      if(from === to){ dragState = null; return; }
      let g = (F.skillGroup||[]).slice();
      // 先确保 kind 分块
      g.sort((a,b) => {
        const oa = a.kind==='active' ? 0 : a.kind==='auto' ? 1 : 2;
        const ob = b.kind==='active' ? 0 : b.kind==='auto' ? 1 : 2;
        return oa !== ob ? oa-ob : 0;
      });
      const [moved] = g.splice(from, 1);
      g.splice(to, 0, moved);
      F.skillGroup = g;
      dragState = null;
      qs('#modalBody').innerHTML = sgEditorHTML(qIdx);
      _bindSkillGroupEditorEvents();
    });
    tile.addEventListener('dragend', () => { dragState=null; tile.style.outline=''; });
  });

  // 保存按钮
  const saveBtn = root.querySelector('.sg-save-btn');
  if(saveBtn) saveBtn.onclick = () => {
    const g = normalizeSkillGroup(F.skillGroup, teamSize);
    F.skillGroup = g;
    const n = normalizeSkillGroup(F.skillGroup, teamSize);
    const g2 = (F.skillGroup||[]).slice();
    n.forEach((s,i) => { if(g2[i]) { /* ok */ } });
    // 如果当前是 activeFormation，同步到 G.skillGroup
    if(G.activeFormation === qIdx) G.skillGroup = F.skillGroup.slice();
    closeModal();
  };
}

window.sgResetDefault = function(qIdx){
  ensureFormations();
  const f = G.formations[qIdx];
  sgEditorCache.group = buildDefaultSkillGroup(f.team);
  _renderSG();
};

window.sgSave = function(qIdx){
  const E = sgEditorCache; if(!E) return;
  // 按 kind 重排
  const kindsOrder = ['active','auto','link'];
  const kindBuckets = {};
  for(const s of E.group){
    const sk = (getChar(s.charKey)?.skills||[]).find(x => x.id===s.skillId);
    const k = sk?.kind || 'auto';
    if(!kindBuckets[k]) kindBuckets[k] = [];
    kindBuckets[k].push({ charKey: s.charKey, skillId: s.skillId });
  }
  const final = [];
  let slot = 1;
  for(const k of kindsOrder){
    for(const s of (kindBuckets[k] || [])){ final.push({ slot: slot++, charKey: s.charKey, skillId: s.skillId }); }
  }
  if(!final.length){ log('技能组不能为空。'); return; }
  G.formations[qIdx].skillGroup = final;
  // 如果正在编辑的是 activeFormation，同步更新 G.skillGroup
  if(G.activeFormation===qIdx){ G.skillGroup = final.slice(); }
  sgEditorCache = null;
  sgEditorSel = null;
  closeModal();
  renderFormation();
};

/* ---- 旧 sg 函数保留兼容（转发到 sgEditorCache） ---- */
window.renderSkillGroupEditor = function(){
  ensureFormations();
  const i = G.activeFormation || 0;
  openSkillGroupEditor(i);
};
window.sgRemoveSlotByData = function(btn){
  const wrap = btn.closest('.sg-group-wrap'); if(!wrap) return;
  const charKey = wrap.dataset.char, skillId = wrap.dataset.skill;
  sgEditorCache.group = sgEditorCache.group.filter(s => !(s.charKey===charKey && s.skillId===skillId));
  _renderSG();
};
window.sgRemoveSlot = function(n){
  // 旧 slot 号按已失效
  if(!sgEditorCache) return;
  sgEditorCache.group = sgEditorCache.group.slice();
  _renderSG();
};
window.sgAddToSlot = function(charKey, skillId){
  if(!sgEditorCache) return;
  if(sgEditorCache.group.some(s => s.charKey===charKey && s.skillId===skillId)) return;
  sgEditorCache.group.push({ charKey, skillId });
  _renderSG();
};
window.sgAddNewSlot = function(){};
window.sgSelectSlot = function(){};
window.sgMoveSlotUp = function(){};
window.sgMoveSlotDown = function(){};




function openTasks(){ openModal('任务', renderTasksHTML(), 'full', {replace:true}); }
window.selectTask=function(id){ if(id!==taskSel && TASKS.some(t=>t.id===id)){ taskSel=id; openTasks(); } };
let shopQty={}; let shopMsg='';
function openShop(){ if(isInFlow()){ log(`${flowLabel()}中无法使用该功能。`); return; } if(G){ shopMsg=''; renderShop(); } }
function shopSellPrice(it){ return Math.floor(it.buy*0.5); }
function renderShop(){ const list=SHOP_ITEMS.map(it=>{ const have=G.inventory[it.key]||0; const buyPrice=itemBuyPrice(it.key); const buyMax=Math.floor((G.inventory.coin||0)/Math.max(1,buyPrice)); const sellMax = it.sellable? have : 0; const maxN=Math.max(buyMax,sellMax,1); let q=Math.max(1, shopQty[it.key]||1); q=Math.min(q, maxN); shopQty[it.key]=q; const buy=buyPrice; const sell=shopSellPrice(it); const sellBtn = it.sellable ? `<button class="mbtn tiny" onclick="shopTrade('${it.key}','sell')">卖出</button>` : `<span class="nohint">不可出售</span>`; const growNote = it.priceGrow? `<span class="rnote">每获得1个，此物价+${it.priceGrow}</span>` : ''; return `<div class="sitem"><div class="shead"><span class="craftlink" data-key="${it.key}">${itemName(it.key)}</span><span class="sprice">${it.sellable?`买入 <b>${buy}</b> · 卖出 <b>${sell}</b> 金币`:`买入 <b>${buy}</b> 金币（不可出售）`}</span></div><div class="sown">持有 <b>${have}</b> · 金币 <b>${G.inventory.coin}</b></div>${growNote}<div class="rcCtl"><span class="craftQty">×${q}</span><input type="range" class="craftRange" min="1" max="${maxN}" value="${q}" oninput="shopSet('${it.key}',this.value)"><button class="mbtn tiny craftDo" onclick="shopTrade('${it.key}','buy')">购买</button>${sellBtn}</div></div>`; }).join(''); openModal('商店', `<p class="mhint">点击物品可查看说明。购买与卖出共用同一滑块设定数量；卖出价为买入价的一半。</p><div class="shopmsg ${shopMsg?'show':''}">${shopMsg}</div><div class="cwrapper">${list}</div>`, 'full', {replace:true}); }
window.shopSet=function(key,v){ shopQty[key]=Math.max(1,(+v||1)); shopMsg=''; renderShop(); };
window.shopTrade=function(key,act){ const it=SHOP_ITEMS.find(x=>x.key===key); if(!it) return; if(combatState){ log('战斗中无法访问商店。'); return; } const q=Math.max(1,shopQty[key]||1); if(act==='buy'){ const price=itemBuyPrice(key); const cost=price*q; if(G.inventory.coin<cost){ shopMsg='金币不足，无法完成该笔购买。'; refreshHUD(); renderShop(); return; } G.inventory.coin-=cost; if(it.permanent){ for(let i=0;i<q;i++) grantPermanentItem(key); } else { G.inventory[key]=(G.inventory[key]||0)+q; } shopMsg=`已购买 <b>${itemName(key)} ×${q}</b>，花费 <b>${cost}</b> 金币。`; } else { if(!it.sellable){ shopMsg='该物品不可出售。'; refreshHUD(); renderShop(); return; } const sell=shopSellPrice(it), gain=sell*q; if((G.inventory[key]||0)<q){ shopMsg='你要卖出的数量超出当前持有。'; refreshHUD(); renderShop(); return; } G.inventory[key]-=q; G.inventory.coin+=gain; shopMsg=`已卖出 <b>${itemName(key)} ×${q}</b>，获得 <b>${gain}</b> 金币。`; } log(shopMsg.replace(/<[^>]+>/g,'')); refreshHUD(); renderShop(); };
let mapDragMoved=false;
(function initMapViewport(){ const vp=qs('#mapViewport'); const grid=qs('#mapGrid'); let scale=1; vp.addEventListener('wheel', e=>{ e.preventDefault(); scale=Math.min(2, Math.max(0.5, scale + (e.deltaY>0?-0.12:0.12))); grid.style.transform=`scale(${scale})`; }, {passive:false}); let down=false,sx=0,sy=0,sl=0,st=0; vp.addEventListener('mousedown',e=>{ down=true; mapDragMoved=false; sx=e.clientX; sy=e.clientY; sl=vp.scrollLeft; st=vp.scrollTop; vp.classList.add('dragging'); }); document.addEventListener('mousemove',e=>{ if(down){ const dx=e.clientX-sx, dy=e.clientY-sy; if(Math.abs(dx)>5||Math.abs(dy)>5) mapDragMoved=true; vp.scrollLeft=sl-dx; vp.scrollTop=st-dy; } }); document.addEventListener('mouseup',()=>{ down=false; vp.classList.remove('dragging'); }); })();
function openPopoverNear(el, html){ const tip=qs('#popover'); tip.innerHTML=html; tip.style.display='block'; bringToFront(tip); tip.style.visibility='hidden'; const r=el.getBoundingClientRect(); const w=tip.offsetWidth||260, h=tip.offsetHeight||60; tip.style.visibility='visible'; let x=r.left; if(x+w>window.innerWidth-8) x=Math.max(8, window.innerWidth-8-w); let y=r.bottom+6; if(y+h>window.innerHeight-8) y=Math.max(8, r.top-h-6); tip.style.left=x+'px'; tip.style.top=y+'px'; }
document.addEventListener('click',ev=>{ if(giftOpenKey){ if(giftJustOpened){ giftJustOpened=false; } else if(!ev.target.closest('#giftOverlay')){ closeGift(); return; } } if(swapOpen){ if(swapJustOpened){ swapJustOpened=false; } else if(!ev.target.closest('.swap-overlay')){ applySwap(); } } clickActionOnly(ev); });
function clickActionOnly(ev){ const st=ev.target.closest('.stchip'); if(st){ const rounds=st.textContent.match(/·(\d+)回合/); openPopoverNear(st, `<b>${st.dataset.name}</b>${rounds?`（${rounds[1]}回合）`:''}<br>${st.dataset.desc||''}`); return; } const tg=ev.target.closest('.talentTag'); if(tg){ const owner=tg.dataset.k; const c=getChar(owner); const t=c.passives[+tg.dataset.i]; if(t){ const name=t.scal? talentDisplayName(owner,t) : t.name; const desc=t.scal? lvDescText(t, entryLevel(owner,t)) : t.desc; openPopoverNear(tg, `<b>${name}</b><br>${desc}`); } return; } const cl=ev.target.closest('.craftlink'); if(cl){ const key=cl.dataset.key; openPopoverNear(cl, `<b>${itemName(key)}</b><br>${itemDetailHTML(key)}`); return; } qs('#popover').style.display='none'; }
