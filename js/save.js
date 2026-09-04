/* ============================================================
   js/save.js —— 模块：存档与进度
   基于浏览器 localStorage 的存档位读写。
   战斗中存档：一律以「本次战斗开始时」那一瞬间为存档点（敌我状态
   与载具/生命都回到战斗开始时）。resume 用：无任何后端，纯本地。
   ============================================================ */
"use strict";

const SAVE_KEY='yysw_saves';

/* 把当前全局状态写入指定存档位（自动附加时间戳） */
function saveGame(slot){
  if(!G) return;
  const saves=loadSaves();
  const snap=JSON.parse(JSON.stringify(G));
  if(combatState && combatState.startSnapshot){
    // 战斗中存档：以战斗开始瞬间为准（生命/载具回退，敌我状态重置已由 startSnapshot 保证）
    const s=combatState.startSnapshot;
    snap.hero.hp=s.heroHp;
    snap.vehicles=s.vehicles;
    snap.vehicleSel=s.vehicleSel;
    snap.combat={ enemyKey:s.enemyKey, enemyPos:s.enemyPos, enemyHp:s.enemyHp };
  } else {
    snap.combat=null;
  }
  snap._ts=Date.now();
  saves[slot]=snap;
  localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
}

/* 读取全部存档（损坏时回退为空对象） */
function loadSaves(){ try{ return JSON.parse(localStorage.getItem(SAVE_KEY))||{}; }catch(e){ return {}; } }

/* 从指定存档位载入到全局 G（失败返回 false） */
function loadGame(slot){
  const saves=loadSaves();
  if(!saves[slot]) return false;
  G=JSON.parse(JSON.stringify(saves[slot]));
  return true;
}
