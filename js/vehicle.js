/* ============================================================
   js/vehicle.js —— 模块：载具系统
   探索/战斗均可打开；选择当前移动方式；三列排版展示每个载具。
   默认「徒步跋涉」无限次；同种载具可多个；每次移动消耗次数/规则；
   次数耗尽自动切回徒步跋涉。快捷键 T 打开。
   载具均用「点击格子 + 点前往」移动（WASD 仅徒步）。
   ============================================================ */
"use strict";

const VEHICLES = {
  walk:     {name:'徒步跋涉', icon:'🚶', infinite:true, cost:1, mode:{type:'step'}, desc:'徒步移动至相邻一格，如平日赶路一般。次数无限。每次消耗1行动力。'},
  dash:     {name:'疾行',     icon:'💨', infinite:true, exploreOnly:true, cost:'steps', mode:{type:'dash'}, desc:'一次性驰往任意一格（可越过途中格子），消耗等于移动距离的行动力。仅探索使用。次数无限。'},
  dragon:   {name:'地龙',     icon:'🐲', uses:3, cost:1, mode:{type:'axis',n:2}, desc:'移动至上下左右四个方向之一的直线 1~2 格（不可走斜线），可越过中间障碍。每次消耗1行动力。'},
  mushroom: {name:'会走路的蘑菇', icon:'🍄', uses:3, cost:1, mode:{type:'oct'}, desc:'移动至周围8格中任意1格。每次消耗1行动力。'},
  carriage: {name:'马车',     icon:'🛞', uses:2, cost:1, mode:{type:'m2'}, desc:'移动至2格距离内的任意1格。每次消耗1行动力。'},
  carpet:   {name:'魔法飞毯', icon:'🪄', uses:1, cost:0, mode:{type:'any'}, desc:'移动至地图上任意1格。探索中不消耗行动力。'},
  qiaoyu:   {name:'巧遇',     icon:'✨', daily:true, cost:1, mode:{type:'any'}, desc:'夏阳天赋【心想事成】赋予。移动至地图上任意1格。每天限1次。每次消耗1行动力。'},
};

function vehicleDef(k){ return VEHICLES[k]||{name:k, icon:'❓', cost:1, desc:'', mode:{type:'step'}}; }
function getVehicles(){ return (G&&G.vehicles)||[]; }
function getSelVehicle(){ const vs=getVehicles(); return vs[G.vehicleSel]||vs[0]; }
function curVehicleDef(){ const v=getSelVehicle(); return v? vehicleDef(v.key) : VEHICLES.walk; }

function curVehicleUsable(){
  const v=getSelVehicle(); if(!v) return false;
  const def=vehicleDef(v.key);
  if(def.daily && (G.qiaoyuUsedDay===(G.day||1))) return false;
  if(!(def.infinite||v.uses==null||v.uses===Infinity) && v.uses<=0) return false;
  return true;
}
function _inMap(x,y){ const m=G.map; return x>=0&&y>=0&&x<m.n&&y<m.n; }
function _entAt(x,y){ return !!(combatState && combatState.enemies.some(e=>e.x===x&&e.y===y)); }
function _free(x,y){ return _inMap(x,y) && G.map.cells[y*G.map.n+x].terrain==='ground' && !_entAt(x,y); }

function vehicleTargetCost(def, from, tx, ty){
  if(!def || !def.mode) return null;
  if(!_inMap(tx,ty) || G.map.cells[ty*G.map.n+tx].terrain!=='ground') return null;
  if(_entAt(tx,ty)) return null;
  const dx=tx-from.x, dy=ty-from.y;
  if(dx===0&&dy===0) return null;
  const m=def.mode;
  if(m.type==='step'){ if(Math.abs(dx)+Math.abs(dy)!==1) return null; return 1; }
  if(m.type==='dash'){ return Math.abs(dx)+Math.abs(dy); }
  if(m.type==='line'){ if(dx!==0&&dy!==0) return null; const st=Math.abs(dx)+Math.abs(dy); const sx=dx===0?0:(dx>0?1:-1), sy=dy===0?0:(dy>0?1:-1); for(let k=1;k<=st;k++){ const nx=from.x+sx*k, ny=from.y+sy*k; if(!_free(nx,ny)) return null; } return st; }
  if(m.type==='axis'){ if((dx===0&&dy===0)||(dx!==0&&dy!==0)) return null; const d=Math.abs(dx)+Math.abs(dy); if(d<1||d>m.n) return null; return 1; }
  if(m.type==='oct'){ if(Math.max(Math.abs(dx),Math.abs(dy))!==1) return null; return 1; }
  if(m.type==='m2'){ const d=Math.abs(dx)+Math.abs(dy); if(d<1||d>2) return null; return 1; }
  if(m.type==='any'){ return 1; }
  return null;
}
function moveCostFor(tx,ty){
  const v=getSelVehicle(); if(!curVehicleUsable()) return null;
  const def=vehicleDef(v.key);
  if(def.exploreOnly && combatState) return null;
  const from={x: combatState?combatState.hero.x:G.px, y: combatState?combatState.hero.y:G.py};
  return vehicleTargetCost(def, from, tx, ty);
}
function consumeVehicleForMove(){
  const v=getSelVehicle(); if(!v) return;
  const def=vehicleDef(v.key);
  if(def.daily && G){ G.qiaoyuUsedDay=G.day||1; }
  if(!(def.infinite||v.uses==null||v.uses===Infinity)){
    v.uses-=1;
    log(`使用了 <b>${def.name}</b>（剩余 ${Math.max(0,v.uses)} 次）。`);
    if(v.uses<=0){ const vs=getVehicles(); vs.splice(G.vehicleSel,1); G.vehicleSel=0; log(`<b>${def.name}</b> 次数耗尽，已自动切回徒步跋涉。`); }
  }
  if(def.key!=='walk') G.vehicleSel=0;
}
function openVehicles(){ if(G) renderVehicles(); }
function renderVehicles(){
  const vs=getVehicles();
  const sel=G.vehicleSel||0;
  const grid=vs.map((v,i)=>{
    const def=vehicleDef(v.key);
    const finite = !(def.infinite || v.uses==null || v.uses===Infinity);
    const dailyPenalty = def.daily && (G.qiaoyuUsedDay===(G.day||1));
    const used = finite && v.uses<=0;
    const unusable = used || dailyPenalty;
    const usesTxt = finite ? `<div class="vuses">剩 ${v.uses} 次</div>` : (def.daily? `<div class="vuses">每天限1次</div>` : `<div class="vuses">无限</div>`);
    return `<div class="vslot ${i===sel?'sel':''} ${unusable?'dis':''}" style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border,#333);border-radius:8px;min-height:92px;cursor:pointer" onclick="selVehicle(${i})">
      <div style="width:33%;text-align:center">
        <div style="font-size:30px">${def.icon}</div>
        <div class="vname" style="font-weight:bold;margin-top:4px">${def.name}</div>
        ${usesTxt}
      </div>
      <div style="width:67%;font-size:13px;line-height:1.55;color:var(--txt-dim,#aaa)">${def.desc||''}</div>
    </div>`;
  }).join('');
  const selDef=curVehicleDef();
  openModal('载具',
    `<p class="mhint">点击选择当前移动方式。载具移动需先<i>点击目标格子</i>再点「前往」。探索按各载具规则消耗行动力；战斗中视为一次移动。${selDef.exploreOnly?'当前「疾行」仅探索可用。':''}</p>`+
    `<div class="vgrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:stretch">${grid||'<span class="stempty">暂无载具</span>'}</div>`, 'full', {replace:true});
}
window.selVehicle=function(i){
  const vs=getVehicles(); if(!vs[i]) return;
  const v=vs[i]; const def=vehicleDef(v.key);
  const finite = !(def.infinite || v.uses==null || v.uses===Infinity);
  if((finite && v.uses<=0) || (def.daily && (G.qiaoyuUsedDay===(G.day||1)))){ log('该载具当前无法使用。'); renderVehicles(); return; }
  G.vehicleSel=i;
  log(`当前装载了 <b>${def.name}</b>。`);
  renderVehicles();
};
function exploreMoveHint(tx,ty){
  if(G.hero.actionPoint<1){ return null; }
  const c=moveCostFor(tx,ty);
  if(c===null) return null;
  if(c>G.hero.actionPoint){ return null; }
  return c;
}
document.addEventListener('keydown', ev=>{
  if(ev.key.toLowerCase()==='t' && !ev.repeat){
    if($('#menuOverlay').classList.contains('show')) return;
    openVehicles();
  }
});