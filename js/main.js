/* ============================================================
   js/main.js —— 模块：总览与入口
   全局运行状态、主界面菜单、启动流程、新游戏/读档进世界、
   睡觉进下一天、词条悬浮提示。本文件最后加载。
   ============================================================ */
"use strict";
let G=null; let combatState=null; let gameMode='story'; let previewCell=null;
function newGame(){
  const bonds={}; for(const k in ALLIES){ bonds[k]={level:1, affinity:0}; }
  return { day:1, region:'wild', hero:{atk:10,maxHp:100,hp:100,def:0,escapeSpeed:100,health:30,actionPoint:5,apCap:5,facing:'up'},
    inventory:{wood:0,fruit:0,flax:0,rawMeat:0,coin:20,emptyBottle:0,iron:0}, records:{slain:{}, wins:0, losses:0},
    team:['pro','xiayang','luyouyou'], proLevels:{}, bonds,
    vehicles:[{key:'walk'},{key:'dash'},{key:'dragon',uses:3},{key:'mushroom',uses:3},{key:'carriage',uses:2},{key:'carpet',uses:1},{key:'qiaoyu'}], vehicleSel:0, map:null, px:0, py:0, st:null, lootLog:[] };
}
function standardVehicles(){ return [{key:'walk'},{key:'dash'},{key:'dragon',uses:3},{key:'mushroom',uses:3},{key:'carriage',uses:2},{key:'carpet',uses:1},{key:'qiaoyu'}]; }
function showMenu(){ $('#menuOverlay').classList.add('show'); $('#menuBtns').innerHTML=`<button class="mbtn" onclick="startNew()">新的游戏</button>`+`<button class="mbtn" onclick="openReadSave()">读取存档</button>`+`<button class="mbtn" onclick="openTutorial()">玩法简介</button>`; }
function openTutorial(){ openModal('玩法简介', `探索：<b>点击地图格子再点「前往」</b>（信息区），或用 <b>WASD</b> 键移动。<br>进入下一天：点上方 <b>睡觉</b> 按钮。<br>遇敌进入回合战斗：点下方 <b>角色卡</b>（<b>F1/F2/F3</b>）切换角色；点 <b>技能</b>（<b>1/2/3</b>）选中，再点一次即主动使用（或按 <b>Q</b>）；移动（WASD/点击相邻格）后各角色自动释放已选技能。<br>战斗中点敌人可在右侧信息区查看<b>属性/意图/状态</b>，并可切到「详细技能」页查看其技能介绍。<br>状态栏记录单位身上的增益/减益（正面黄框、负面红框），<b>点击状态</b>可查看详情；技能描述中的【词条】<b>悬浮</b>可查看解释。<br>地图可<b>滚轮缩放</b>、<b>拖拽平移</b>（仅视觉）。`, 'small'); }
window.addEventListener('load',()=>{ bindTooltip(); switchMode('story'); if(loadSaves()[1]) loadGame(1); showMenu(); });
function showGameOver(){ $('#goMsg').innerHTML='你的健康已归零，流浪在此终结。你仍可读取存档重新开始。'; $('#gameoverOverlay').classList.add('show'); }
function loadAfterGameOver(){ $('#gameoverOverlay').classList.remove('show'); openReadSaveMenu(); }
function backToMenu(){ combatState=null; $('#gameoverOverlay').classList.remove('show'); showMenu(); }
function startNew(){ $('#menuOverlay').classList.remove('show'); G=newGame(); G.map=generateMap(G.day); G.px=G.map.px; G.py=G.map.py; loadIntoWorld(); }
function loadIntoWorld(){ $('#menuOverlay').classList.remove('show'); combatState=null; if(!G.map) G.map=generateMap(G.day); if(G.px===undefined||G.py===undefined){ G.px=G.map.px; G.py=G.map.py; } if(!G.vehicles||!G.vehicles.some(v=>v&&v.key==='dash')){ G.vehicles=standardVehicles(); G.vehicleSel=0; } refreshHUD(); renderIconbar(); if(G.combat){ const c=G.combat; G.combat=null; reenterCombat(c); return; } switchMode('story'); renderMap(); story('你又一次在异世界醒来。这一次，你决定无论如何都要活下去。'); ensureKeyFocus(); }
function ensureKeyFocus(){ try{ if(document.body) document.body.setAttribute('tabindex','-1'); window.focus(); if(document.body) document.body.focus({preventScroll:true}); }catch(e){} }
function handleKeys(ev){
  if($('#menuOverlay').classList.contains('show') || $('#gameoverOverlay').classList.contains('show')) return;
  if(combatState){
    const cs=combatState; const k=ev.key.toLowerCase();
    if(k==='q'){ if(cs.ally[cs.currentChar] && cs.ally[cs.currentChar].selSkill==='flee'){ tryFlee(); } else { castSkill(cs.currentChar, true); } }
    else if(k==='w'){ combatMove(0,-1); } else if(k==='s'){ combatMove(0,1); } else if(k==='a'){ combatMove(-1,0); } else if(k==='d'){ combatMove(1,0); }
    else if(ev.key==='1'||ev.key==='2'||ev.key==='3'||ev.key==='4'){ const cur=getChar(cs.currentChar); const skills=cur.skills.filter(s=>cur.selectedSkillIds.includes(s.id)); const idx=+ev.key-1; if(idx<skills.length) selectSkill(cs.currentChar, skills[idx].id); else if(idx===skills.length) selectSkill(cs.currentChar, 'flee'); }
    else if(ev.key==='f1'||ev.key==='f2'||ev.key==='f3'){ const chars=getTeamChars(); const idx=+ev.key.slice(1)-1; if(chars[idx]){ cs.currentChar=chars[idx].key; updateCombatUI(); renderCombatMap(); } }
    return;
  }
  if(!G||!G.map) return; if($('#modalOverlay').classList.contains('show')) return; if(ev.repeat) return;
  const k=ev.key.toLowerCase(); let dx=0,dy=0;
  if(k==='w'){dy=-1;} else if(k==='s'){dy=1;} else if(k==='a'){dx=-1;} else if(k==='d'){dx=1;} else return;
  const nx=G.px+dx, ny=G.py+dy; if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n) return; moveExplore(nx,ny,1);
}
document.addEventListener('keydown', handleKeys, true);
function sleep(){
  if(!G) return; if(combatState){ log('战斗中无法使用该功能。'); return; }
  if(G.hero.actionPoint>0 && !confirm('行动力尚未耗尽，仍确定直接「睡觉」进入下一天吗？')) return;
  const inTeam=k=>G.team.indexOf(k)>=0;
  G.hero.actionPoint=G.hero.apCap; G.day+=1;
  const nm=generateMap(G.day); G.map=nm; G.px=nm.px; G.py=nm.py; G.hero.facing='up';
  const lines=[`你睡了一觉，进入第 ${G.day} 天。`];
  let healGain=0, healthGain=0;
  if((G.inventory.quilt||0)>0) healGain += 30*(G.inventory.quilt||0);
  if(inTeam('xiayang')){ healGain*=2; healthGain*=2; }
  if(healGain>0){ const before=G.hero.hp; G.hero.hp=Math.min(heroDisplayMaxHp(), G.hero.hp+healGain); const got=G.hero.hp-before; if(got>0) lines.push(`被子为你<span class="lvlup">回复 ${got}</span> 点生命。`); }
  if(healthGain>0){ G.hero.health+=healthGain; lines.push(`健康 +${healthGain}。`); }
  const trapN=G.inventory.trap||0; const trapGain={};
  for(let i=0;i<trapN;i++){ if(Math.random()<0.5){ const k=NATURAL_RESOURCES[Math.floor(Math.random()*NATURAL_RESOURCES.length)]; G.inventory[k]=(G.inventory[k]||0)+1; trapGain[k]=(trapGain[k]||0)+1; } }
  if(trapN>0){ const keys=Object.keys(trapGain); lines.push(keys.length? `陷阱收获自然资源：${keys.map(k=>RES_ZH[k]+'×'+trapGain[k]).join('，')}。` : '陷阱一无所获，风平浪静。'); }
  if(inTeam('luyouyou')){ const sk=getChar('luyouyou').passives.find(p=>p.id==='skillful'); const pr=vTier(sk,'sleep',entryLevel('luyouyou',sk)); if(Math.random()*100<pr){ const k=NATURAL_RESOURCES[Math.floor(Math.random()*NATURAL_RESOURCES.length)]; G.inventory[k]=(G.inventory[k]||0)+1; lines.push(`巧手：获得 ${RES_ZH[k]}×1。`); } }
  saveGame(2); clearLog(); clearStory(); prompt('');
  for(const l of lines) log(l);
  story(`夜色褪去，新的一天开始了。今天是第 ${G.day} 天。`); refreshHUD(); renderMap(); renderIconbar();
}
function bindTooltip(){
  document.addEventListener('mouseover',ev=>{ const t=ev.target.closest('.term'); if(!t)return; const tip=$('#tooltip'); tip.style.display='block'; tip.textContent=t.title||TERMS[t.dataset.term]||''; positionTip(tip,ev); });
  document.addEventListener('mouseout',ev=>{ if(ev.target.closest('.term')) $('#tooltip').style.display='none'; });
  document.addEventListener('mousemove',ev=>{ positionTip($('#tooltip'),ev); });
}
function positionTip(tip,ev){ const x=Math.min(ev.clientX+14, window.innerWidth-300); const y=ev.clientY+14; tip.style.left=x+'px'; tip.style.top=y+'px'; }