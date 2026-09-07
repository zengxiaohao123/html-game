/* ============================================================
   js/event.js —— 模块：随机事件系统
   真正可选择的选项交互（选中→确认→延迟→结果）。
   事件标题/正文放剧情区，选项放信息区，结果回剧情区。
   事件激活时：地图可缩放平移但不可移动；编队/商店/睡觉/合成禁用。
   随机值在事件生成时（进入事件格）决定并存于格子，读档不变。
   ============================================================ */
"use strict";

let eventState = null;

/* 基准售价（非商店品的参考价，用于流浪商人）。商店品直接用 SHOP_ITEMS 的买入价。 */
const TRADER_REF_PRICE = { club:12, cloth:14, wood:2, flax:3, dagger:32, leather:20 };
/* 流浪商人可选商品：每项 [inventoryKey, 数量, 标题] */
const TRADER_GOODS = [
  { key:'wood',   n:4, label:'木材×4' },
  { key:'flax',   n:4, label:'麻布×4' },
  { key:'club',   n:1, label:'木棒'    },
  { key:'cloth',  n:1, label:'布衣'    },
  { key:'dagger', n:1, label:'匕首'    },
  { key:'leather',n:1, label:'皮衣'    },
];

/* 事件定义。body 支持 {全参} 占位；options 在事件生成时动态求值。 */
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

/* 从 grid 事件格开始事件（格子必须 content.type==='event' 且未完成）。
   若格子已生成过事件（slot.evId 存在），则复用其随机值，保证读档不影响本次值。 */
function startEvent(cell){
  const cs=cell.content;
  let slot=cs.slot;
  if(!slot){ slot={}; cs.slot=slot; }
  let ev;
  if(slot.evId){
    ev=EVENTS.find(e=>e.id===slot.evId)||null;
  } else {
    const pool=EVENTS.slice(); ev=pool[Math.floor(Math.random()*pool.length)];
  }
  if(!ev){ ev=EVENTS[0]; }
  slot.evId=ev.id;
  cs.done=false;
  cs.type='event';
  eventState={ ev, slot, selected:-1, resolving:false, cell };
  renderEvent();
}

/* 在当前事件格渲染标题到剧情区、选项到信息区 */
function renderEvent(){
  const s=eventState; if(!s) return;
  const options=typeof s.ev.options==='function' ? s.ev.options(s.slot) : s.ev.options;
  s.options=options;
  const body=typeof s.ev.getBody==='function' ? s.ev.getBody(s.slot) : s.ev.getBody;
  clearStory();
  $('#bottom').classList.add('mode-event-lock');
  $('#goBtn').style.display='none';
  renderIconbar();
  $('#storyBody').insertAdjacentHTML('beforeend', `<div class="ev-card"><div class="ev-title">${s.ev.title}</div><div class="ev-body">${body}</div></div>`);
  renderEventOptions();
}

/* 渲染信息区选项 */
function renderEventOptions(){
  const s=eventState; if(!s||!s.options) return;
  const html=s.options.map((o,i)=>{
    const usable=o.req();
    const sel = i===s.selected;
    return `<div class="ev-opt ${sel?'sel':''} ${usable?'':'dis'}" data-i="${i}">
      <div class="ev-opt-name">${o.name}</div>
      <div class="ev-opt-desc">${o.desc}</div>
      ${sel?'<div class="ev-confirm">你确定这么做？</div>':''}
    </div>`;
  }).join('');
  prompt(html);
  $('#promptZone').querySelectorAll('.ev-opt').forEach(b=>{
    b.onclick=()=>{ if(s.resolving) return; const i=+b.dataset.i; const usable=s.options[i].req(); if(!usable){ log('当前无法选择该选项。'); return; } selectEventOption(i); };
  });
}

function selectEventOption(i){
  const s=eventState; if(!s||s.resolving) return;
  if(s.selected===i){
    confirmEventOption(i);
  } else {
    s.selected=i; renderEventOptions();
  }
}

function confirmEventOption(i){
  const s=eventState; if(!s) return;
  const opt=s.options[i]; if(!opt) return;
  s.resolving=true;
  // 确认：选项变金
  prompt(s.options.map((o,j)=> j===i
    ? `<div class="ev-opt confirmed"><div class="ev-opt-name">${o.name}</div><div class="ev-opt-desc">${o.desc}</div></div>`
    : `<div class="ev-opt dim"><div class="ev-opt-name">${o.name}</div><div class="ev-opt-desc">${o.desc}</div></div>`
  ).join(''));
  // 短暂延迟后应用结果、清空选项、事件结束
  setTimeout(()=>{
    if(!eventState) return;
    const result=opt.resolve(s.slot) || '（事件继续……）';
    finishEvent(result);
  }, 600);
}

/* 事件结束：结果写入剧情区，事件格变空地，恢复交互 */
function finishEvent(result){
  const s=eventState;
  if(!s) return;
  const body='<div class="ev-card"><div class="ev-title">'+s.ev.title+'</div><div class="ev-body">'+result+'</div></div>';
  clearStory(); $('#storyBody').insertAdjacentHTML('beforeend', body);
  // 事件格变空地
  const c=s.cell&&s.cell.content;
  if(c){ c.type='empty'; c.done=false; delete c.slot; }
  eventState=null;
  $('#bottom').classList.remove('mode-event-lock');
  prompt('');
  $('#goBtn').style.display='none';
  renderMap(); refreshHUD(); renderIconbar();
}

/* 事件内进入战斗（讨伐熊 / 穷追不舍）：把事件格转为战斗格再进入，战斗结束自动清空为空地 */
function enterEventBattle(enemyKey){
  const s=eventState;
  const cell=s? s.cell : null;
  const x=cell?cell.x:G.px, y=cell?cell.y:G.py;
  if(G.map.cells[y*G.map.n+x]) G.map.cells[y*G.map.n+x].content={type:'battle', sub:'event', key:enemyKey};
  eventState=null;
  $('#bottom').classList.remove('mode-event-lock');
  startCombat({ content:{ key:enemyKey } });
}

/* 事件是否激活（供 UI/存档/输入判定） */
function inEvent(){ return !!eventState; }