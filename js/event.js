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
const TRADER_REF_PRICE = { club:12, cloth:14, wood:2, flax:3, dagger:32, leather:20,
  luckyCoin:40, deadwoodSprout:30, kuiZuo:35, windChime:25, broom:60, clearMind:15, amethyst:20 };
const TRADER_GOODS = [
  { key:'wood',   n:4, label:'木材×4' },
  { key:'flax',   n:4, label:'麻布×4' },
  { key:'club',   n:1, label:'木棒'    },
  { key:'cloth',  n:1, label:'布衣'    },
  { key:'dagger', n:1, label:'匕首'    },
  { key:'leather',n:1, label:'皮衣'    },
  /* === 新物品 === */
  { key:'clearMind', n:1, label:'明心浆' },
  { key:'amethyst', n:1, label:'紫水晶' },
  { key:'luckyCoin', n:1, label:'幸运硬币' },
  { key:'deadwoodSprout', n:1, label:'枯木新枝' },
  { key:'kuiZuo', n:1, label:'《愧怍》' },
  { key:'broom', n:1, label:'魔法扫帚' },
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
        resolve:(slot)=>{ G.records=G.records||{}; G.records.oldLadyHelped=(G.records.oldLadyHelped||0)+1; if(typeof afterQuestProgress==='function') afterQuestProgress(); if(slot.case){ const k=slot.giftKey, n=slot.giftN; G.inventory[k]=(G.inventory[k]||0)+n; return `老奶奶十分感激，送给你<b>${RES_ZH[k]}×${n}</b>。`; } G.inventory.coin=Math.floor((G.inventory.coin||0)/2); return '你被老奶奶摸走了一半的钱！你的金币减半。'; } },
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
      { name:'请村民领路找到狗熊', desc:'你在山洞里睡懒觉的日子结束了！', req:()=>true,
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
          resolve:()=>{ G.inventory.coin-=slot.price;
            /* broom/luckyCoin/deadwoodSprout/kuiZuo/windChime 走 grantPermanentItem 让它们生效 */
            const goGrant = ['club','cloth','dagger','leather','ironSword','broom','luckyCoin','deadwoodSprout','kuiZuo','windChime'].includes(g.key);
            if(g.n===1 && goGrant){ grantPermanentItem(g.key); }
            else if(g.key==='clearMind'){ G.inventory.clearMind=(G.inventory.clearMind||0)+1; }
            else { G.inventory[g.key]=(G.inventory[g.key]||0)+g.n; }
            return '“欢迎下次再来！”流浪商人笑眯眯地对你说。'; } },
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
        resolve:()=>{ if(Math.random()*100<slot.y){ G.inventory.coin=(G.inventory.coin||0)+slot.x; for(const k in ALLIES) gainAffinity(k,-2); return `你拿到了钱，但良心上受到了谴责，金币+<b>${slot.x}</b>，所有同伴好感度-2。`; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'bread', title:'临时起意·面包',
    getBody:(slot)=>{ if(slot.y==null){ slot.y=10+Math.floor(Math.random()*86); } return '<p>走在前面的小孩手里攥着一长条面包，你决定。</p>'; },
    options:(slot)=>[
      { name:`抢了（成功率${slot.y}%）`, desc:'这也是生存所迫……', req:()=>true,
        resolve:()=>{ if(Math.random()*100<slot.y){ G.hero.actionPoint=(G.hero.actionPoint||0)+4; for(const k in ALLIES) gainAffinity(k,-2); return '你拿到了面包，但良心上受到了谴责，行动力+<b>4</b>，所有同伴好感度-2。'; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  /* === 新事件 === */
  {
    id:'nun', title:'山间修女',
    getBody:(slot)=>{ if(slot.b==null){ slot.b=100; } return `<p>一位穿着素衣的修女在山间修行，她看了你一眼，目光温柔。</p>`; },
    options:[
      { name:'忏悔', desc:'倾诉内心的压力', req:()=>true,
        resolve:(slot)=>{
          const pct=Math.max(50, slot.b);
          slot.b=Math.max(50, slot.b-5);
          if(Math.random()*100 < pct){
            G.hero.psyStress=Math.max(-100, (G.hero.psyStress||0)-15);
            return `修女静静地听你诉说，你感到心中负担减轻了许多。心理压力 <span style="color:#2e9b40">-15</span>（下一次忏悔成功率 <b>${slot.b}%</b>）。`;
          }
          G.hero.psyStress=Math.max(-100, (G.hero.psyStress||0)-5);
          return `你欲言又止，修女只是微笑。心理压力 <span style="color:#2e9b40">-5</span>（下一次忏悔成功率 <b>${slot.b}%</b>）。`;
        } },
      { name:'求助（消耗空瓶子×2）', desc:'需要空瓶子×2', req:()=>(G.inventory.emptyBottle||0)>=2,
        resolve:()=>{ G.inventory.emptyBottle-=2;
          if(Math.random()<0.5){ G.inventory.clearMind=(G.inventory.clearMind||0)+1; return '修女递给你一瓶<b>明心浆</b>。'; }
          return '修女分给你一些面包。获得<b>熟肉×2</b>。'; } },
      { name:'告辞', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你礼貌地告辞离开了。' },
    ],
  },
  {
    id:'fallIntoRiver', title:'翻车',
    getBody:(slot)=>{ if(slot.case==null){ slot.case=Math.random()<0.5; }
      if(slot.case) return `<p>前方的路泥泞不堪，你一脚踏空摔进了河里。</p>`;
      return `<p>前方的路看似有些泥泞，但你运气还不错。</p>`; },
    options:(slot)=> slot.case ? [
      { name:'爬起来（硬吃）', desc:'生命值下降', req:()=>true,
        resolve:()=>{ G.hero.hp=Math.max(1, G.hero.hp-30); G.hero.psyStress=Math.max(-100, (G.hero.psyStress||0)-3);
          return `你浑身湿透地爬起来，狼狈不堪。生命 -30，心理压力 <span style="color:#2e9b40">-3</span>。`; } },
      { name:'先看看河底', desc:'也许河底有什么', req:()=>true,
        resolve:()=>{ G.hero.hp=Math.max(1, G.hero.hp-15);
          if(Math.random()<0.3){ G.inventory.coin=(G.inventory.coin||0)+12; return '你在河底摸到了一些掉落的<b>12金币</b>！生命 -15。'; }
          G.inventory.emptyBottle=(G.inventory.emptyBottle||0)+3; return '你在河底摸到了<b>3个空瓶子</b>。生命 -15。'; } },
    ] : [
      { name:'继续赶路', desc:'无', req:()=>true,
        resolve:()=>'你顺利走过了那段泥泞的路。' },
    ],
  },
  {
    id:'garden', title:'废弃菜园',
    getBody:(slot)=>{ if(slot.f==null){ slot.f=['wood','flax','fruit','rawMeat','blueStar'][Math.floor(Math.random()*5)]; slot.fn=2+Math.floor(Math.random()*3); }
      return `<p>你路过一片废弃的菜园，里面似乎还残留着一些东西。</p>`; },
    options:(slot)=>[
      { name:'仔细搜索', desc:'消耗行动力', req:()=>(G.hero.actionPoint||0)>=1,
        resolve:()=>{ G.hero.actionPoint-=1; G.inventory[slot.f]=(G.inventory[slot.f]||0)+slot.fn;
          return `你翻了翻这片菜园，找到了 <b>${RES_ZH[slot.f]||itemName(slot.f)}×${slot.fn}</b>。`; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你没有在荒废的菜园前停留太久。' },
    ],
  },
  {
    id:'mine', title:'废弃矿洞',
    getBody:(slot)=>{ if(slot.loot==null){ slot.loot=Math.random()<0.5 ? 'iron' : 'blueStar'; slot.n=2+Math.floor(Math.random()*4); }
      return `<p>山壁上有一个半塌的矿洞入口，黑暗中似乎能看到矿石的微光。</p>`; },
    options:(slot)=>[
      { name:'进去看看', desc:'消耗行动力', req:()=>(G.hero.actionPoint||0)>=2,
        resolve:()=>{ G.hero.actionPoint-=2; G.inventory[slot.loot]=(G.inventory[slot.loot]||0)+slot.n;
          return `你从矿洞里挖出了 <b>${RES_ZH[slot.loot]}×${slot.n}</b>。`; } },
      { name:'算了', desc:'太危险了', req:()=>true,
        resolve:()=>'你没有进入这个看起来就不太安全的矿洞。' },
    ],
  },
  {
    id:'poker', title:'路边赌局',
    getBody:()=>`<p>路边的一个赌徒朝你招手：“来玩一把？猜大小，赌注 <b>10 金币</b>，赢了 <b>20 金币</b>！”</p>`,
    options:[
      { name:'猜大（下注10金币）', desc:'需要10金币', req:()=>(G.inventory.coin||0)>=10,
        resolve:()=>{ G.inventory.coin-=10; if(Math.random()<0.5){ G.inventory.coin+=20; return '你猜对了！赢得<b>20金币</b>。'; } G.inventory.psyStress=Math.max(-100,(G.hero.psyStress||0)+2);
          return '你猜错了，下注的10金币没了。心理压力 <span style="color:#d9534f">+2</span>。'; } },
      { name:'猜小（下注10金币）', desc:'需要10金币', req:()=>(G.inventory.coin||0)>=10,
        resolve:()=>{ G.inventory.coin-=10; if(Math.random()<0.5){ G.inventory.coin+=20; return '你猜对了！赢得<b>20金币</b>。'; } G.hero.psyStress=Math.max(-100,(G.hero.psyStress||0)+2);
          return '你猜错了，下注的10金币没了。心理压力 <span style="color:#d9534f">+2</span>。'; } },
      { name:'算了', desc:'别惹事', req:()=>true,
        resolve:()=>'你摇了摇头，离开了。' },
    ],
  },
  {
    id:'windChime', title:'风铃',
    getBody:()=>`<p>你在一棵树下发现了一个随风轻响的<b>风铃</b>，它的声音有一种说不清的魔力。</p>`,
    options:[
      { name:'收下', desc:'获得风铃', req:()=>true,
        resolve:()=>{ G.inventory.windChime=(G.inventory.windChime||0)+1; return '你把风铃挂在了腰间，心里好像轻快了一些。获得<b>风铃×1</b>。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你听着风铃的声音走远了。' },
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
