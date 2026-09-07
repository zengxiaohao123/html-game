/* ============================================================
   js/event.js —— 模块：随机事件系统
   真正可选择的选项交互（选中→确认→2s淡出→结果）。
   事件标题/正文按自然段打字机逐段显示，段间点击剧情区推进；
   打完最后一段才显示选项。结果同样打字机显示。
   事件激活时：地图可缩放平移但不可移动；编队/商店/睡觉/合成禁用。
   随机值在事件生成时（进入事件格）决定并存于格子，读档不变。
   ============================================================ */
"use strict";

let eventState = null;

/* 基准售价（非商店品的参考价，用于流浪商人）。商店品直接用 SHOP_ITEMS 的买入价。 */
const TRADER_REF_PRICE = { club:12, cloth:14, wood:2, flax:3, dagger:32, leather:20 };
const TRADER_GOODS = [
  { key:'wood',   n:4, label:'木材×4' },
  { key:'flax',   n:4, label:'麻布×4' },
  { key:'club',   n:1, label:'木棒'    },
  { key:'cloth',  n:1, label:'布衣'    },
  { key:'dagger', n:1, label:'匕首'    },
  { key:'leather',n:1, label:'皮衣'    },
];

const EVENTS = [
  {
    id:'coin', title:'无主之物',
    getBody:()=>'<p>在路上，你见到2枚遗落的金币，要不要捡起来呢？</p>',
    options:[
      { name:'捡起', desc:'没人看见……大概吧？', req:()=>true,
        resolve:()=>{ G.inventory.coin=(G.inventory.coin||0)+2; return '你获得了<b>2金币</b>。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'oldLady', title:'摔倒的老人',
    getBody:(slot)=>{ if(slot.case==null){ slot.case=Math.random()<0.85; const pool=['wood','flax','fruit','rawMeat']; slot.giftKey=slot.case? pool[Math.floor(Math.random()*pool.length)] : null; slot.giftN=slot.case? {wood:3,flax:3,fruit:3,rawMeat:2}[slot.giftKey] : 0; } return '<p>你见到一位跌倒在地的老奶奶。</p>'; },
    options:[
      { name:'扶', desc:'无', req:()=>true,
        resolve:(slot)=>{ if(slot.case){ const k=slot.giftKey, n=slot.giftN; G.inventory[k]=(G.inventory[k]||0)+n; return `老奶奶十分感激，送给你<b>${RES_ZH[k]}×${n}</b>。`; } G.inventory.coin=Math.floor((G.inventory.coin||0)/2); return '你被老奶奶摸走了一半的钱！你的金币减半。'; } },
      { name:'不扶', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'spring', title:'山野温泉',
    getBody:()=>'<p>在山中发现了一处隐秘的温泉，热气弥漫。</p>',
    options:[
      { name:'泡个温泉', desc:'无', req:()=>true,
        resolve:()=>{ const cap=heroineMaxHp(); const cur=G.hero.hp; if(cur<cap){ G.hero.hp=Math.min(cap, cur+Math.round(cap*0.75)); return '神清气爽，回复了<b>'+(G.hero.hp-cur)+'</b>点生命值。'; } return '你在温泉里泡了会，浑身舒畅。'; } },
      { name:'休息一下', desc:'无', req:()=>true,
        resolve:()=>{ G.hero.actionPoint=(G.hero.actionPoint||0)+2; return '整备了随身物品，行动力+<b>2</b>。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'bearQuest', title:'讨伐任务·暴躁的熊',
    getBody:(slot)=>{ const started=!!(G.records&&G.records.bearQuestStarted); slot.started=started;
      return started ? '<p>你再次从村民处听说了狗熊最近的行踪。你决定。</p>' : '<p>从附近村民的描述中，你得知附近山中蛰居着一头狗熊，此熊力大无穷且狂躁无比，让村民们十分头疼。好消息是，它最近在冬眠，稍微安分了点。</p>'; },
    options:(slot)=> slot.started ? [
      { name:'请村民领路找到狗熊', desc:'你在山洞里睡懒觉的日记结束了！', req:()=>true,
        resolve:()=>{ enterEventBattle('bear'); return ''; } },
      { name:'请村民标注地点但暂不前往', desc:'小心为上', req:()=>true,
        resolve:()=>{ G.inventory.roadmap=(G.inventory.roadmap||0)+1; return '村民给了你一张路线图，上面标注着狗熊最近栖息的位置。获得<b>路线图×1</b>。'; } },
    ] : [
      { name:'我了解了', desc:'贸然前去会被拍成肉饼吧？', req:()=>true,
        resolve:()=>{ G.records=G.records||{}; G.records.bearQuestStarted=true; return '你记下了信息后，离开了此地。接取了支线任务·讨伐暴躁的熊。'; } },
    ],
  },
  {
    id:'hounds', title:'穷追不舍',
    getBody:()=>'<p>在野外，几条狗一路狂吠追着你跑了一公里。你气喘吁吁……</p>',
    options:[
      { name:'别太嚣张', desc:'几条野狗，竟敢在我面前狺狺狂吠', req:()=>true,
        resolve:()=>{ enterEventBattle('houndPro'); return ''; } },
      { name:'丢块肉', desc:'试试人类的计谋（需要生肉×1）', req:()=>(G.inventory.rawMeat||0)>=1,
        resolve:()=>{ G.inventory.rawMeat-=1; return '野狗们马上抛下你，去争夺那块肉了。你趁此机会离开了。'; } },
    ],
  },
  {
    id:'trader', title:'流浪商人',
    getBody:()=>'<p>“瞧一瞧看一看哩！”，你在路上遇到一位流浪商人，要看看吗？</p>',
    options:(slot)=>{ if(!slot.good){ const g=TRADER_GOODS[Math.floor(Math.random()*TRADER_GOODS.length)]; const base=TRADER_REF_PRICE[g.key]; const total=Math.round(base*Math.max(0.2,Math.min(1.6,(0.2+Math.random()*1.4)))*g.n); slot.good=g; slot.price=total; } const g=slot.good, total=slot.price;
      return [
        { name:'看看货', desc:`花费<b>${total}</b>金币，购买<b>${g.label}</b>`, req:()=>(G.inventory.coin||0)>=total,
          resolve:()=>{ G.inventory.coin-=slot.price; if(g.n===1&&(g.key==='club'||g.key==='cloth'||g.key==='dagger'||g.key==='leather'||g.key==='ironSword')){ grantPermanentItem(g.key); } else { G.inventory[g.key]=(G.inventory[g.key]||0)+g.n; } return '“欢迎下次再来！”流浪商人笑眯眯地对你说。'; } },
        { name:'不感兴趣', desc:'路边摊不可信', req:()=>true,
          resolve:()=>{ G.hero.actionPoint=(G.hero.actionPoint||0)+1; return '你没有理会。趁此时间休息了会，行动力+<b>1</b>。'; } },
      ]; },
  },
  {
    id:'coinPurse', title:'临时起意·钱袋',
    getBody:(slot)=>{ if(slot.x==null){ slot.x=2+Math.floor(Math.random()*14); slot.y=10+Math.floor(Math.random()*86); } const x=slot.x, y=slot.y;
      return `<p>走在前面的路人，裤袋露出了钱袋（装有<b>${x}</b>金币），他似乎没注意到，你决定。</p>`; },
    options:(slot)=>[
      { name:`偷偷拿走（成功率${slot.y}%）`, desc:'这也是生存所迫……', req:()=>true,
        resolve:()=>{ if(Math.random()*100<slot.y){ G.inventory.coin=(G.inventory.coin||0)+slot.x; return `你拿到了钱，但良心上受到了谴责，金币+<b>${slot.x}</b>，心理压力+1，所有同伴好感度-2。`; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'bread', title:'临时起意·面包',
    getBody:(slot)=>{ if(slot.y==null){ slot.y=10+Math.floor(Math.random()*86); } return '<p>走在前面的小孩手里攥着一长条面包，你决定。</p>'; },
    options:(slot)=>[
      { name:`抢了（成功率${slot.y}%）`, desc:'这也是生存所迫……', req:()=>true,
        resolve:()=>{ if(Math.random()*100<slot.y){ G.hero.actionPoint=(G.hero.actionPoint||0)+4; return '你拿到了面包，但良心上受到了谴责，行动力+<b>4</b>，心理压力+1，所有同伴好感度-2。'; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
];

function startEvent(x, y, slotOverride){
  // 需求1：进入事件格即把该格变为空地（防止事件内战斗结束后格子残留）
  const gcell=G.map.cells[y*G.map.n+x];
  if(gcell && gcell.content) gcell.content={type:'empty'};
  let slot = slotOverride || (gcell && gcell.content.slot) || {};
  let ev;
  if(slot.evId){ ev=EVENTS.find(e=>e.id===slot.evId)||null; }
  else { ev=EVENTS[Math.floor(Math.random()*EVENTS.length)]; }
  if(!ev) ev=EVENTS[0];
  slot.evId=ev.id;
  // 先求值 body（内部会初始化随机值），再求值 options
  const body=typeof ev.getBody==='function' ? ev.getBody(slot) : ev.getBody;
  const options=typeof ev.options==='function' ? ev.options(slot) : ev.options;
  eventState={ ev, slot, body, options, selected:-1, resolving:false, cell:{x,y}, phase:'body' };
  // 事件状态存到 G.activeEvent，供读档恢复（格子已清空不影响重开）
  if(G){ G.activeEvent={ x, y, slot }; }
  lockEventUI();
  showEventBody();
}

function lockEventUI(){
  $('#bottom').classList.add('mode-event-lock');
  $('#goBtn').style.display='none';
  renderIconbar();
}
function unlockEventUI(){
  $('#bottom').classList.remove('mode-event-lock');
  renderIconbar();
}

/* 事件正文：按自然段打字机逐段，段间点击剧情区推进；打完最后一段才显示选项 */
function showEventBody(){
  const s=eventState; if(!s) return;
  storyClear();
  // 标题单独一行（不参与打字机，直接显示），正文随后逐段打字
  const box=$('#storyBody');
  box.insertAdjacentHTML('beforeend', `<div class="ev-title">${s.ev.title}</div>`);
  const paras=splitParas(s.body);
  s.bodyParas=paras;
  s.bodyIdx=0;
  typeNextBodyPara();
}
function typeNextBodyPara(){
  const s=eventState; if(!s) return;
  if(s.bodyIdx>=s.bodyParas.length){ s.phase='choose'; renderEventOptions(); return; }
  const seg=s.bodyParas[s.bodyIdx]; s.bodyIdx++;
  s.phase='body';
  // 段打完：若还有下一段，等待点击推进；若是最后一段，直接进入选择
  const isLast = s.bodyIdx>=s.bodyParas.length;
  storyPush(seg, ()=>{ if(eventState && isLast){ eventState.phase='choose'; renderEventOptions(); } });
}
function splitParas(html){
  const clean=String(html).trim();
  // 以 </p> 或 <br> 为段落结束，保留完整标签
  const paras=clean.split(/(?=<\/?p>|<br\s*\/?>)/).filter(x=>x&&x.trim());
  // 合并：将 "<p>正文" 与 "</p>" 重新拼成完整 "<p>正文</p>"
  const merged=[];
  for(let i=0;i<paras.length;i++){
    let seg=paras[i];
    if(/^<p[^>]*>/.test(seg) && !/<\/p>$/.test(seg) && i+1<paras.length){
      seg += paras[i+1]; i++;
    }
    if(seg && seg.trim()) merged.push(seg);
  }
  return merged.length? merged : [clean];
}

/* 渲染信息区选项 */
function renderEventOptions(){
  const s=eventState; if(!s||!s.options) return;
  const html=s.options.map((o,i)=>{
    const usable=o.req();
    const sel=i===s.selected;
    const descHtml = (o.desc==null||o.desc===''||o.desc==='无') ? '' : `<div class="ev-opt-desc">${o.desc}</div>`;
    const confirm = sel? '<span class="ev-confirm">你确定这么做？</span>' : '';
    return `<div class="ev-opt ${sel?'sel':''} ${usable?'':'dis'}" data-i="${i}">
      <div class="ev-opt-name"><span>${o.name}</span>${confirm}</div>
      ${descHtml}
    </div>`;
  }).join('');
  prompt(`<div class="ev-opt-wrap">${html}</div>`);
  $('#promptZone').querySelectorAll('.ev-opt').forEach(b=>{
    b.onclick=()=>{ if(s.resolving) return; const i=+b.dataset.i; if(!s.options[i].req()){ log('当前无法选择该选项。'); return; } selectEventOption(i); };
  });
}

function selectEventOption(i){
  const s=eventState; if(!s||s.resolving) return;
  if(s.selected===i){ confirmEventOption(i); }
  else { s.selected=i; renderEventOptions(); }
}

function confirmEventOption(i){
  const s=eventState; if(!s) return;
  const opt=s.options[i]; if(!opt) return;
  s.resolving=true;
  // 确认：选中项变金，其余淡化；整体 2s 内淡出
  const wrap=$('#promptZone .ev-opt-wrap');
  $('#promptZone').querySelectorAll('.ev-opt').forEach((el,j)=>{
    if(j===i) el.classList.add('confirmed');
    else el.classList.add('dim');
  });
  const result=opt.resolve(s.slot) || '';
  s.result=result;
  if(wrap) wrap.style.opacity='0';
  setTimeout(()=>{ finishEvent(s.result); }, 2000);
}

/* 事件结束：结果打字机显示，清空活动事件，恢复交互（格子已在进入时变空地） */
function finishEvent(result){
  const s=eventState; if(!s) return;
  const title=s.ev.title;
  // 格子进入事件时已清空；这里仅清除活动事件状态
  if(G) delete G.activeEvent;
  eventState=null;
  unlockEventUI();
  prompt('');
  $('#goBtn').style.display='none';
  renderMap(); refreshHUD();
  // 结果打字机显示；标题保留，正文为结果
  storyClear();
  const box=$('#storyBody');
  box.insertAdjacentHTML('beforeend', `<div class="ev-title">${title}</div>`);
  const paras=splitParas(result);
  let idx=0;
  const typeNext=()=>{
    if(idx>=paras.length){ /* 全部结果段打完，等点击清空 */ return; }
    const seg=paras[idx]; idx++;
    storyPush(seg, ()=>{ /* 段打完 */ if(idx<paras.length){ typeNext(); } });
  };
  typeNext();
}

/* 事件内进入战斗：把事件格转为战斗格再进入，战斗结束自动清空为空地 */
function enterEventBattle(enemyKey){
  const s=eventState;
  const cell=s? s.cell : null;
  const x=cell?cell.x:G.px, y=cell?cell.y:G.py;
  // 该格已为空地，转为战斗格；战斗结束 endCombat 会清空 entryCell(=当前格)
  if(G.map.cells[y*G.map.n+x]) G.map.cells[y*G.map.n+x].content={type:'battle', sub:'event', key:enemyKey};
  if(G) delete G.activeEvent;
  eventState=null;
  unlockEventUI();
  startCombat({ content:{ key:enemyKey } });
}

function inEvent(){ return !!eventState; }

/* 剧情区点击（全局，由 ui.js 绑定）：
   1) 正在打字 → 立即显示本段全部文字（不推进，符合要求10情况1）
   2) 已打完且事件正文还有下一段 → 推进到下一段（要求8：快速跳下一段）
   3) 已打完且是事件正文最后一段 / 结果 → 剧情区清空（要求8） */
function onStoryClick(){
  if(storyIsTyping()){ storySkipToEnd(); return; }
  // 已打完
  const s=eventState;
  if(s && s.phase==='body' && s.bodyIdx < s.bodyParas.length){
    typeNextBodyPara();
    return;
  }
  if(s && s.phase==='choose') return; // 等待选择，不可跳过（点击不处理）
  // 非事件普通剧情 / 结果：若有待打段落→推进到下一段；否则（最后一段）→清空
  if(storyHasMore()){ storyAdvance(); return; }
  storyClear();
}
document.addEventListener('click', ev=>{
  if(ev.target.closest('#storyBody')) onStoryClick();
  // 选中某选项后点击别处（非选项）→ 取消选中（要求3）
  const s=eventState;
  if(s && s.phase==='choose' && !s.resolving && s.selected>=0 && !ev.target.closest('.ev-opt')){
    s.selected=-1; renderEventOptions();
  }
});
