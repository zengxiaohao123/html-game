/* ============================================================
   js/explore.js —— 模块：地图与探索（探索交互）
   点击预览 / 前往移动 / 资源拾取 / 宝箱 / 事件（含选项双击确认）。
   信息区 = 右侧，只显示被点击格子的信息与「前往」按钮。
   地形命名：空地=可通行；山脉/地图外=不可通行。
   ============================================================ */
"use strict";

/* 事件选项：记录当前选中的下标（单击选中、再单击同项确认） */
let optionSelectedIdx=-1;

/* 点击格子：预览信息 + 启用「前往」按钮；战斗中则转战斗处理 */
function onCellClick(x,y){
  if(combatState){ combatCellClick(x,y); return; }
  if(mapDragMoved) return;
  const m=G.map;
  const c=m.cells[y*m.n+x];
  previewCell={x,y};
  let info=`<b>位置 (${x+1},${y+1})</b><br>`;
  if(c.terrain==='void'){ info+='不可通行（地图之外）。'; prompt(info); $('#goBtn').style.display='none'; return; }
  if(c.terrain==='obstacle'){ info+='山脉障碍，无法通行。'; prompt(info); $('#goBtn').style.display='none'; return; }
  const ct=c.content&&c.content.type;
  if(ct==='enemy') info+=`前方遭遇 <b>${ENEMIES[c.content.key].name}</b><br>移动过去将进入战斗。`;
  else if(ct==='loot' && !c.content.done) info+='此处有一个宝箱。';
  else if(ct==='event' && !c.content.done) info+='此处有事件发生。';
  else if(ct==='loot'||ct==='event') info+='这里的东西已被取走，如今是空地。';
  else info+='空地。';
  prompt(info);
  activateGo(x,y);
}

/* 「前往」按钮（位于信息区）：绑定本次移动 */
function activateGo(x,y){
  const go=$('#goBtn');
  go.style.display='block';
  go.disabled=false;
  go.classList.remove('disabled');
  go.onclick=()=>{ go.style.display='none'; moveExplore(x,y); };
}

/* 移动到相邻格：扣 AP、改朝向、触发拾取 / 敌人 / 宝箱 / 事件。
   朝障碍/不可通行移动：只改变朝向、不移动、不消耗行动力（返还）。
   真实移动才会消耗当前所选载具的一个次数。 */
function moveExplore(x,y){
  if(combatState) return;
  const m=G.map;
  const dx=x-G.px, dy=y-G.py;
  if(Math.abs(dx)+Math.abs(dy)!==1){ log('只能移动到相邻一格（上下左右）。'); return; }
  const target=m.cells[y*m.n+x];
  // 不可通行：转向但不移动、不消耗行动力
  if(target.terrain==='obstacle' || target.terrain==='void'){
    G.hero.facing=dirToFacing(dx,dy);
    log('前方有阻挡，你转身面向那边，行动力并未消耗。');
    $('#goBtn').style.display='none';
    renderMap();
    return;
  }
  if(G.hero.actionPoint<1){ log('行动力不足，请先「睡觉」进入下一天。'); return; }
  $('#goBtn').style.display='none';
  G.hero.actionPoint-=1;
  G.hero.facing = dirToFacing(dx,dy);
  G.px=x; G.py=y;
  useVehicleOnMove(); // 真实移动：消耗已选载具一个次数（耗尽自动切回徒步）
  const drops=dropResources();
  if(drops){ G.inventory[drops.kind]+=drops.amount; log(`获得 <b>${drops.amount}</b> 份 ${RES_ZH[drops.kind]}。`); }
  if(target.content && target.content.type==='enemy'){ log(`遭遇 <b>${ENEMIES[target.content.key].name}</b>！进入战斗。`); startCombat(target); }
  else if(target.content && target.content.type==='loot' && !target.content.done){ openLoot(target); }
  else if(target.content && target.content.type==='event' && !target.content.done){ runEvent(target); }
  else { log('这里空无一物。'); }
  if(!combatState){ refreshHUD(); renderMap(); }
}

/* 移动增量 → 朝向名 */
function dirToFacing(dx,dy){
  if(dx>0)return 'right'; if(dx<0)return 'left'; if(dy>0)return 'down'; return 'up';
}

/* 随机资源掉落：50% 递减档，最多 3 档 = 6 个同种资源 */
function dropResources(){
  const pool = G.region==='wild'? ['wood','fruit','flax','rawMeat'] : ['coin','emptyBottle'];
  const kind=pool[Math.floor(Math.random()*pool.length)];
  let n=0, p=0.5;
  while(n<3 && Math.random()<p){ n++; p=0.5; }
  if(n===0) return null;
  return {kind, amount:n*2};
}

/* 开启宝箱 */
function openLoot(target){
  target.content.done=true;
  const kinds = G.region==='wild'? ['wood','fruit','flax','rawMeat']:['coin','emptyBottle'];
  const k=kinds[Math.floor(Math.random()*kinds.length)];
  const amt=k==='coin'?1+Math.floor(Math.random()*3):1;
  G.inventory[k]+=amt;
  log(`开启宝箱，获得 <b>${amt}</b> 份 ${RES_ZH[k]}。`);
  refreshHUD(); renderMap();
}

/* 事件：掉金币 / 温泉回血 / 虚惊耗健康 / 分歧选项（选项在信息区双击确认） */
function runEvent(target){
  target.content.done=true;
  const ev=Math.random();
  if(ev<0.28){
    const g=2+Math.floor(Math.random()*3);
    G.inventory.coin+=g; log(`你遇到商人的遗落行囊，获得 <b>${g}</b> 金币。`);
  } else if(ev<0.55){
    if(G.hero.hp<G.hero.maxHp){ G.hero.hp=Math.min(G.hero.maxHp, G.hero.hp+Math.floor(G.hero.maxHp*0.15)+10); log('你在一处温泉旁歇脚，回复了部分生命。'); }
    else log('你在温泉旁歇脚，精神为之一振。');
  } else if(ev<0.78){
    G.hero.health=Math.max(0,G.hero.health-1); log('一场虚惊让健康有所消耗。');
  } else {
    // 分歧选项事件：选项放信息区，单击选中、再单击同一项确认
    log('你遇到一位迷路的旅人，他向你求助。');
    renderEventOptions([
      {text:'慷慨相助，分他一些干粮（获得旅人的谢礼：5 金币）', act:()=>{ G.inventory.coin+=5; log('旅人感激不尽，赠你 5 金币作谢礼。'); refreshHUD(); }},
      {text:'婉言谢绝，独自离开', act:()=>{ log('你婉言谢绝了旅人，独自继续前行。'); }}
    ]);
  }
  refreshHUD(); renderMap();
}

/* 在信息区渲染分歧选项（单击选中，再单击同项确认） */
function renderEventOptions(options){
  optionSelectedIdx=-1;
  let html='<div style="margin-bottom:6px"><b>分歧选项：</b></div>';
  options.forEach((o,i)=>{
    html+=`<div class="opt" data-i="${i}">${o.text}</div>`;
  });
  html+='<div style="margin-top:6px;color:var(--txt-dim);font-size:12px">单击选中，再单击同一选项确认。</div>';
  $('#promptZone').innerHTML=html;
  $('#promptZone').querySelectorAll('.opt').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i;
    if(optionSelectedIdx===i){ // 确认
      optionSelectedIdx=-1;
      options[i].act();
      $('#promptZone').innerHTML='';
      $('#goBtn').style.display='none';
    } else {
      optionSelectedIdx=i;
      renderEventOptions(options);
    }
  });
}