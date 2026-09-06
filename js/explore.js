/* ============================================================
   js/explore.js —— 模块：地图与探索（探索交互）
   点击预览 / 前往移动（载具规则）/ 战斗 / 事件 / 空地搜索 / 奖励格。
   探索移动按当前载具计算可达与行动力消耗；不可前往显示「无法前往」。
   ============================================================ */
"use strict";
let optionSelectedIdx=-1;
function onCellClick(x,y){
  if(combatState){ combatCellClick(x,y); return; }
  if(mapDragMoved) return;
  const m=G.map; const c=m.cells[y*m.n+x]; previewCell={x,y};
  let info=`<b>位置 (${x+1},${y+1})</b><br>`;
  if(c.terrain==='void'){ info+='不可通行（地图之外）。'; prompt(info); goBtnDisabled(); return; }
  if(c.terrain==='obstacle'){ info+='山脉障碍，无法通行。'; prompt(info); goBtnDisabled(); return; }
  const ct=c.content&&c.content.type;
  if(ct==='battle'){ const subTxt = c.content.sub==='hard' ? '一场艰难战斗' : (c.content.sub==='boss' ? '一场boss战' : '一场普通战斗'); info+=`前方遭遇${subTxt}<br>移动过去将进入战斗。`; }
  else if(ct==='loot' && !c.content.done) info+='此处有战利品可拾取。';
  else if(ct==='event' && !c.content.done) info+='此处有事件发生。';
  else if(ct==='loot'||ct==='event') info+='这里的东西已被取走，如今是空地。';
  else info+='空地。';
  prompt(info);
  goBtnForMove(x,y);
}
function goBtnDisabled(){ const go=$('#goBtn'); go.style.display='block'; go.disabled=true; go.classList.add('disabled'); go.textContent='无法前往'; go.onclick=null; }
function goBtnForMove(x,y){
  const go=$('#goBtn');
  const cost=exploreMoveHint(x,y);
  if(cost===null || (G.hero.actionPoint||0)<cost){ goBtnDisabled(); return; }
  go.style.display='block'; go.disabled=false; go.classList.remove('disabled'); go.textContent=`前往 · 消耗 ${cost} 行动力`; go.onclick=()=>{ go.style.display='none'; moveExplore(x,y,cost); };
}
function moveExplore(x,y,cost){
  if(combatState) return;
  if(cost===null) return;
  if(moveCostFor(x,y)===null){ goBtnDisabled(); return; }
  if((G.hero.actionPoint||0)<cost){ log('行动力不足。'); $('#goBtn').style.display='none'; return; }
  const m=G.map; const target=m.cells[y*m.n+x];
  const ox=G.px, oy=G.py;
  G.hero.facing=dirToFacing(x-ox, y-oy);
  G.px=x; G.py=y; G.hero.actionPoint-=cost;
  consumeVehicleForMove();
  $('#goBtn').style.display='none'; renderMap();
  if(G.team.indexOf('luyouyou')>=0){ const fl=getChar('luyouyou').passives.find(p=>p.id==='flutter'); const hv=vTier(fl,'move',entryLevel('luyouyou',fl)); const cap=heroDisplayMaxHp()||G.hero.maxHp; const nx=Math.min(cap, G.hero.hp+hv); if(nx>G.hero.hp){ const got=nx-G.hero.hp; G.hero.hp=nx; log(`【蹁跹】移动后回复 ${got} 点生命。`); } }
  const ct=target.content&&target.content.type;
  if(ct==='battle'){ log('遭遇敌人！进入战斗。'); startCombat(target); }
  else if(ct==='loot' && !target.content.done){ openLoot(target); }
  else if(ct==='event' && !target.content.done){ runEvent(target); }
  else if(ct==='empty'){ const got=searchEmpty(); if(got) log(`在空地搜到 <b>${got}</b>。`); else log('空地空空如也，一无所获。'); }
  else { log('这里没有什么特别的。'); }
  if(!combatState){ refreshHUD(); renderMap(); }
}
function dirToFacing(dx,dy){ if(dx>0)return 'right'; if(dx<0)return 'left'; if(dy>0)return 'down'; return 'up'; }
function searchEmpty(){
  const pool = G.region==='wild'? ['wood','fruit','flax','rawMeat'] : ['coin','emptyBottle'];
  const items={};
  for(let i=0;i<3;i++){ if(Math.random()<0.5){ const kind=pool[Math.floor(Math.random()*pool.length)]; items[kind]=(items[kind]||0)+2; } else { break; } }
  const keys=Object.keys(items); if(!keys.length) return null;
  for(const k of keys){ G.inventory[k]=(G.inventory[k]||0)+items[k]; }
  return keys.map(k=>`${RES_ZH[k]}×${items[k]}`).join('，');
}
function gainRandomResource(n){ const pool = G.region==='wild'? ['wood','fruit','flax','rawMeat'] : ['coin','emptyBottle']; const k=pool[Math.floor(Math.random()*pool.length)]; G.inventory[k]=(G.inventory[k]||0)+n; return `${RES_ZH[k]}×${n}`; }
function openLoot(target){
  target.content.done=true; const r=Math.random(); let txt='';
  if(r<0.40){ txt=gainRandomResource(2); }
  else if(r<0.90){ txt=gainRandomResource(4); }
  else if(r<0.97){ const g=4+Math.floor(Math.random()*7); G.inventory.coin+=g; txt=`金币×${g}`; }
  else if(r<0.997){ const k=Math.random()<0.5?'club':'cloth'; grantPermanentItem(k); txt=itemName(k)+'×1'; }
  else { const k=Math.random()<0.5?'dagger':'leather'; grantPermanentItem(k); txt=itemName(k)+'×1'; }
  log(`拾取战利品：<b>${txt}</b>。`); refreshHUD(); renderMap();
}
function runEvent(target){
  target.content.done=true; const ev=Math.random();
  if(ev<0.28){ const g=2+Math.floor(Math.random()*3); G.inventory.coin+=g; log(`你遇到商人的遗落行囊，获得 <b>${g}</b> 金币。`); }
  else if(ev<0.55){ const cap=heroDisplayMaxHp(); if(G.hero.hp<cap){ G.hero.hp=Math.min(cap, G.hero.hp+Math.floor(cap*0.15)+10); log('你在一处温泉旁歇脚，回复了部分生命。'); } else log('你在温泉旁歇脚，精神为之一振。'); }
  else if(ev<0.78){ G.hero.health=Math.max(0,G.hero.health-1); log('一场虚惊让健康有所消耗。'); }
  else { log('你遇到一位迷路的旅人，他向你求助。'); renderEventOptions([ {text:'慷慨相助，分他一些干粮（获得旅人的谢礼：5 金币）', act:()=>{ G.inventory.coin+=5; log('旅人感激不尽，赠你 5 金币作谢礼。'); refreshHUD(); }}, {text:'婉言谢绝，独自离开', act:()=>{ log('你婉言谢绝了旅人，独自继续前行。'); }} ]); }
  refreshHUD(); renderMap();
}
function renderEventOptions(options){
  optionSelectedIdx=-1;
  let html='<div style="margin-bottom:6px"><b>分歧选项：</b></div>';
  options.forEach((o,i)=>{ html+=`<div class="opt" data-i="${i}">${o.text}</div>`; });
  html+='<div style="margin-top:6px;color:var(--txt-dim);font-size:12px">单击选中，再单击同一选项确认。</div>';
  $('#promptZone').innerHTML=html;
  $('#promptZone').querySelectorAll('.opt').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; if(optionSelectedIdx===i){ optionSelectedIdx=-1; options[i].act(); $('#promptZone').innerHTML=''; $('#goBtn').style.display='none'; } else { optionSelectedIdx=i; renderEventOptions(options); } });
}