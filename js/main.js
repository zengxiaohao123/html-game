/* ============================================================
   js/main.js —— 模块：总览与入口
   全局运行状态、主界面菜单、启动流程、新游戏/读档进世界、
   睡觉进下一天、词条悬浮提示。本文件最后加载。
   ============================================================ */
"use strict";

/* 全局运行状态（被各模块共享读写） */
let G=null;          // 当前局游戏数据
let combatState=null; // 当前战斗状态（null = 探索态）
let gameMode='story'; // 'story' | 'combat'
let previewCell=null; // 点击预览的格子

/* 初始游戏数据 */
function newGame(){
  return {
    day:1, region:'wild',
    hero:{atk:10,maxHp:100,hp:100,def:0,escapeSpeed:100,health:30,actionPoint:5,apCap:5,facing:'up'},
    inventory:{wood:0,fruit:0,flax:0,rawMeat:0,coin:0,emptyBottle:0},
    records:{slain:{}, wins:0, losses:0},
    team:[PROTAGONIST.key],
    map:null, px:0, py:0, st:null,
    lootLog:[]
  };
}

/* 主界面菜单 */
function showMenu(){
  if(G) saveGame(0);
  $('#menuOverlay').classList.add('show');
  $('#menuBtns').innerHTML=
    `<button class="mbtn" onclick="startNew()">新的游戏</button>`+
    `<button class="mbtn" onclick="openReadSave()">读取存档</button>`+
    `<button class="mbtn" onclick="openTutorial()">玩法简介</button>`;
}

/* 玩法简介弹窗 */
function openTutorial(){
  openModal('玩法简介',
    `探索：<b>点击地图格子再点「前往」</b>，或用 <b>WASD</b> 键移动。<br>
    进入下一天：点上方 <b>睡觉</b> 按钮。<br>
    遇敌进入回合战斗：先点选下方 <b>技能</b>，再按 <b>Q</b> 释放；或直接移动，移动后会自动攻击最近的敌人。<br>
    数值与系统依据《玩法机制介绍-总篇》。`, 'small');
}

/* 启动：绑定提示、切探索态、自动读进度、显示主界面 */
window.addEventListener('load',()=>{
  bindTooltip();
  switchMode('story');
  if(loadSaves()[1]) loadGame(1);
  showMenu();
});

/* 全局失败（健康归零）：弹出游戏结束面板 */
function showGameOver(){
  $('#goMsg').innerHTML='你的健康已归零，流浪在此终结。你仍可读取存档重新开始。';
  $('#gameoverOverlay').classList.add('show');
}
/* 失败后读取存档 / 返回主界面 */
function loadAfterGameOver(){ $('#gameoverOverlay').classList.remove('show'); openReadSaveMenu(); }
function backToMenu(){ $('#gameoverOverlay').classList.remove('show'); showMenu(); }

/* 开始新游戏 */
function startNew(){
  $('#menuOverlay').classList.remove('show');
  G=newGame();
  G.map=generateMap(G.day);
  G.px=0;G.py=0;
  loadIntoWorld();
}

/* 载入(新/旧)局并进入世界：刷 HUD / 图标行 / 地图 / 开场剧情 */
function loadIntoWorld(){
  $('#menuOverlay').classList.remove('show');
  if(!G.map) G.map=generateMap(G.day);
  if(G.px===undefined){G.px=0;G.py=0;}
  switchMode('story');
  refreshHUD(); renderIconbar(); renderMap();
  story('你又一次在异世界醒来。这一次，你决定无论如何都要活下去。');
}

/* 睡觉：二次确认 → 回满AP、进下一天、生成新地图、回血、自动存档 */
function sleep(){
  if(!G) return;
  if(G.hero.actionPoint>0 && !confirm('行动力尚未耗尽，仍确定直接「睡觉」进入下一天吗？')) return;
  G.hero.actionPoint=G.hero.apCap;
  G.day+=1;
  G.map=null;
  const nm=generateMap(G.day);
  G.map=nm; G.px=0; G.py=0; G.hero.facing='up';
  G.hero.hp=Math.max(1, Math.min(G.hero.maxHp, Math.round(G.hero.hp+G.hero.maxHp*0.2)));
  saveGame(2);
  log(`你睡了一觉，进入第 ${G.day} 天。`);
  story(`夜色褪去，新的一天开始了。今天是第 ${G.day} 天。`);
  refreshHUD(); renderMap(); renderIconbar();
}

/* 词条悬浮提示 */
function bindTooltip(){
  document.addEventListener('mouseover',ev=>{
    const t=ev.target.closest('.term'); if(!t)return;
    const tip=$('#tooltip'); tip.style.display='block';
    tip.textContent=t.title||TERMS[t.dataset.term]||'';
    positionTip(tip,ev);
  });
  document.addEventListener('mouseout',ev=>{ if(ev.target.closest('.term')) $('#tooltip').style.display='none'; });
  document.addEventListener('mousemove',ev=>{ positionTip($('#tooltip'),ev); });
}
function positionTip(tip,ev){
  const x=Math.min(ev.clientX+14, window.innerWidth-270);
  const y=ev.clientY+14;
  tip.style.left=x+'px'; tip.style.top=y+'px';
}