/* ============================================================
   js/save.js —— 模块：存档与进度
   基于浏览器 localStorage 的存档位读写。
   ============================================================ */
"use strict";

/* 把当前全局状态 G 写入指定存档位（自动附加时间戳） */
function saveGame(slot){
  if(!G) return;
  const saves=loadSaves();
  const snap=JSON.parse(JSON.stringify(G));
  snap._ts=Date.now();
  saves[slot]=snap;
  localStorage.setItem('yysw_saves', JSON.stringify(saves));
}

/* 读取全部存档（损坏时回退为空对象） */
function loadSaves(){try{return JSON.parse(localStorage.getItem('yysw_saves'))||{};}catch(e){return {};}}

/* 从指定存档位载入到全局 G（失败返回 false） */
function loadGame(slot){
  const saves=loadSaves();
  if(!saves[slot]) return false;
  G=JSON.parse(JSON.stringify(saves[slot]));
  return true;
}