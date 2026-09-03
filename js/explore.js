/* ============================================================
   js/explore.js —— 模块：地图与探索（探索交互）
   点击预览 / 前往移动 / 资源拾取 / 宝箱 / 事件。
   ============================================================ */
"use strict";

/* 点击格子：预览信息 + 启用「前往」按钮；战斗中则转战斗处理 */
function onCellClick(x,y){
  if(combatState){ combatCellClick(x,y); return; }
  const m=G.map;
  const c=m.cells[y*m.n+x];
  if(c.terrain==='obstacle'){ prompt('这是一片无法通行的山脉。'); return; }
  previewCell={x,y};
  let info=`位置 (${x+1},${y+1})<br>`;
  if(c.content && c.content.type==='enemy') info+=`前方遭遇 <b>${ENEMIES[c.content.key].name}</b><br>移动过去将进入战斗。`;
  else if(c.content && c.content.type==='loot') info+='此处有一个宝箱。';
  else if(c.content && c.content.type==='event') info+='此处有事件发生。';
  else info+='空地。';
  prompt(info);
  activateGo(x,y);
}

/* 「前往」按钮：绑定本次移动 */
function activateGo(x,y){
  const go=$('#goBtn');
  go.style.display='block';
  go.disabled=false;
  go.classList.remove('disabled');
  go.onclick=()=>{ go.style.display='none'; moveExplore(x,y); };
}

/* 移动到相邻格：扣 AP、改朝向、触发拾取 / 敌人 / 宝箱 / 事件 */
function moveExplore(x,y){
  if(combatState) return;
  const m=G.map;
  const dx=x-G.px, dy=y-G.py;
  if(Math.abs(dx)+Math.abs(dy)!==1){ log('只能移动到相邻一格（上下左右）。'); return; }
  const target=m.cells[y*m.n+x];
  if(target.terrain==='obstacle'){ log('有山脉阻挡，无法通行。'); return; }
  if(G.hero.actionPoint<1){ log('行动力不足，请先「睡觉」进入下一天。'); return; }
  $('#goBtn').style.display='none';
  G.hero.actionPoint-=1;
  G.hero.facing = dirToFacing(dx,dy);
  G.px=x; G.py=y;
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

/* 简单事件：掉金币 / 温泉回血 / 虚惊耗健康 */
function runEvent(target){
  target.content.done=true;
  const ev=Math.random();
  if(ev<0.4){
    const g=2+Math.floor(Math.random()*3);
    G.inventory.coin+=g; log(`你遇到商人的遗落行囊，获得 <b>${g}</b> 金币。`);
  } else if(ev<0.7){
    if(G.hero.hp<G.hero.maxHp){ G.hero.hp=Math.min(G.hero.maxHp, G.hero.hp+Math.floor(G.hero.maxHp*0.15)+10); log('你在一处温泉旁歇脚，回复了部分生命。'); }
    else log('你在温泉旁歇脚，精神为之一振。');
  } else {
    G.hero.health=Math.max(0,G.hero.health-1); log('一场虚惊让健康有所消耗。');
  }
  refreshHUD(); renderMap();
}