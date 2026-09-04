/* ============================================================
   js/vehicle.js —— 模块：载具系统
   无论探索/战斗都可打开；选择当前移动方式；格子式逐一展示每个载具。
   默认「徒步跋涉」无限次；同种载具可有多个、独立存储于不同槽位；
   每次真实移动消耗 1 个已选载具；次数耗尽自动切回徒步跋涉。快捷键 T 打开。
   ============================================================ */
"use strict";

/* 载具库：infinite=true 次数无限；uses=初始次数（有限时显示） */
const VEHICLES = {
  walk:{name:'徒步跋涉', icon:'🚶', infinite:true, desc:'徒步移动至相邻一格，如平日赶路一般。次数无限。'},
  raft:{name:'木筏', icon:'🛶', uses:3, desc:'乘木筏渡水，移动至相邻一格（本次仍视作一次移动）。'},
  bike:{name:'山地车', icon:'🚲', uses:2, desc:'蹬车赶路，移动至相邻一格（本次仍视作一次移动）。'},
  torch:{name:'提灯', icon:'🏮', uses:5, desc:'昏暗处前行时提灯照明，移动至相邻一格（本次仍视作一次移动）。'},
};

function getVehicles(){ return (G&&G.vehicles)||[]; }
function getSelVehicle(){ const vs=getVehicles(); return (vs[G.vehicleSel])||vs[0]; }
function vehicleDef(k){ return VEHICLES[k]||{name:k, icon:'❓', desc:''}; }

function openVehicles(){ if(G) renderVehicles(); }

function renderVehicles(){
  const vs=getVehicles();
  const sel=G.vehicleSel||0;
  const grid=vs.map((v,i)=>{
    const def=vehicleDef(v.key);
    const finite = !(def.infinite || v.uses==null || v.uses===Infinity);
    const usesTxt = finite ? `<div class="vuses">剩 ${v.uses} 次</div>` : '';
    return `<div class="vslot ${i===sel?'sel':''}" onclick="selVehicle(${i})">
      <div class="vicon">${def.icon}</div>
      <div class="vname">${def.name}</div>
      ${usesTxt}
    </div>`;
  }).join('');
  openModal('载具',
    `<p class="mhint">点击选择当前移动方式（浅黄背景为已选用）。每次移动消耗 1 个已选载具，次数耗尽自动切回徒步跋涉。</p>`+
    `<div class="vgrid">${grid||'<span class="stempty">暂无载具</span>'}</div>`, 'full', {replace:true});
}

window.selVehicle=function(i){
  if(!getVehicles()[i]) return;
  G.vehicleSel=i;
  log(`当前装载了 <b>${vehicleDef(getVehicles()[i].key).name}</b>。`);
  renderVehicles();
};

/* 每次真实移动（探索/战斗）后调用：消耗 1 个已选载具，耗尽则切回徒步跋涉。
   无限次载具不提示使用/剩余。 */
function useVehicleOnMove(){
  if(!G) return;
  const v=getSelVehicle(); if(!v) return;
  const def=vehicleDef(v.key);
  if(def.infinite || v.uses==null || v.uses===Infinity) return;
  v.uses-=1;
  log(`使用了 <b>${def.name}</b> 移动，该载具剩余 ${Math.max(0,v.uses)} 次。`);
  if(v.uses<=0){
    const i=(G.vehicleSel||0), vs=getVehicles();
    vs.splice(i,1);
    G.vehicleSel=0;
    log(`${def.name} 使用次数耗尽，已自动切换回徒步跋涉。`);
  }
}

/* 快捷键 T：打开载具（探索/战斗均可） */
document.addEventListener('keydown', ev=>{
  if(ev.key.toLowerCase()==='t' && !ev.repeat){
    if($('#menuOverlay').classList.contains('show')) return;
    openVehicles();
  }
});
