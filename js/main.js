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
  // 羁绊等级：除主角外每个队友独立（初始1级；升级需10好感，测试期无好感来源）
  const bonds={};
  for(const k in ALLIES){ bonds[k]={level:1, affinity:0}; }
  return {
    day:1, region:'wild',
    hero:{atk:10,maxHp:100,hp:100,def:0,escapeSpeed:100,health:30,actionPoint:5,apCap:5,facing:'up'},
    inventory:{wood:0,fruit:0,flax:0,rawMeat:0,coin:20,emptyBottle:0},
    records:{slain:{}, wins:0, losses:0},
    team:['pro','xiayang','luyouyou'],
    proLevels:{},  // 主角各可升级条目(天赋/技能)的等级库，初始缺省=1
    bonds,         // 队友羁绊：{ key:{level, affinity} }
    vehicles:[{key:'walk',uses:null},{key:'raft',uses:3},{key:'bike',uses:2},{key:'bike',uses:2}],
    vehicleSel:0,  // 当前选用的载具槽位（0=徒步跋涉）
    map:null, px:0, py:0, st:null,
    lootLog:[]
  };
}

/* 主界面菜单 */
function showMenu(){
  $('#menuOverlay').classList.add('show');
  $('#menuBtns').innerHTML=
    `<button class="mbtn" onclick="startNew()">新的游戏</button>`+
    `<button class="mbtn" onclick="openReadSave()">读取存档</button>`+
    `<button class="mbtn" onclick="openTutorial()">玩法简介</button>`;
}

/* 玩法简介弹窗 */
function openTutorial(){
  openModal('玩法简介',
    `探索：<b>点击地图格子再点「前往」</b>（信息区），或用 <b>WASD</b> 键移动。<br>
    进入下一天：点上方 <b>睡觉</b> 按钮。<br>
    遇敌进入回合战斗：点下方 <b>角色卡</b>（<b>F1/F2/F3</b>）切换角色；点 <b>技能</b>（<b>1/2/3</b>）选中，再点一次即主动使用（或按 <b>Q</b>）；移动（WASD/点击相邻格）后各角色自动释放已选技能。<br>
    战斗中点敌人可在右侧信息区查看<b>属性/意图/状态</b>，并可切到「详细技能」页查看其技能介绍。<br>
    状态栏记录单位身上的增益/减益（正面黄框、负面红框），<b>点击状态</b>可查看详情；技能描述中的【词条】<b>悬浮</b>可查看解释。<br>
    地图可<b>滚轮缩放</b>、<b>拖拽平移</b>（仅视觉）。<br>
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
/* 失败后读取存档 / 返回主界面（不存档） */
function loadAfterGameOver(){ $('#gameoverOverlay').classList.remove('show'); openReadSaveMenu(); }
function backToMenu(){
  combatState=null; // 返回主界面：清空任何进行中的战斗（不存档）
  $('#gameoverOverlay').classList.remove('show'); showMenu();
}

/* 开始新游戏 */
function startNew(){
  $('#menuOverlay').classList.remove('show');
  G=newGame();
  G.map=generateMap(G.day);
  G.px=G.map.px; G.py=G.map.py;
  loadIntoWorld();
}

/* 载入(新/旧)局并进入世界：刷 HUD / 图标行 / 地图 / 开场剧情。
   若读回的是战斗存档（G.combat 非空），则按战斗开始直接进入战斗。 */
function loadIntoWorld(){
  $('#menuOverlay').classList.remove('show');
  combatState=null; // 无论何种读档，先清除旧战斗（下方若需重进战斗会重建）
  if(!G.map) G.map=generateMap(G.day);
  if(G.px===undefined||G.py===undefined){ G.px=G.map.px; G.py=G.map.py; }
  refreshHUD(); renderIconbar();
  if(G.combat){ // 战斗存档：直接重回本次战斗开始
    const c=G.combat; G.combat=null;
    reenterCombat(c);
    return;
  }
  switchMode('story');
  renderMap();
  story('你又一次在异世界醒来。这一次，你决定无论如何都要活下去。');
  ensureKeyFocus(); // 确保页面持有键盘焦点，WASD 才可靠触发
}

/* 让页面持有键盘焦点（避免焦点被按钮/宿主/预览 iframe 抢走后键盘失效） */
function ensureKeyFocus(){
  try{
    if(document.body) document.body.setAttribute('tabindex','-1');
    window.focus();
    if(document.body) document.body.focus({preventScroll:true});
  }catch(e){}
}

/* 统一键盘处理（capture 阶段，最外层最可靠）：
   探索：WASD 移动（弹窗打开时不误移）；战斗：WASD 移动 / Q 主动技能 / 1·2·3 选技能 / F1·F2·F3 切人。 */
function handleKeys(ev){
  // 主菜单 / 游戏结束 / 弹窗叠层是否打开（弹窗内仍允许 ESC 等由各处自行处理）
  if($('#menuOverlay').classList.contains('show') || $('#gameoverOverlay').classList.contains('show')) return;
  if(combatState){
    const cs=combatState;
    const k=ev.key.toLowerCase();
    if(k==='q'){ castSkill(cs.currentChar, true); }
    else if(k==='w'){ combatMove(0,-1); }
    else if(k==='s'){ combatMove(0,1); }
    else if(k==='a'){ combatMove(-1,0); }
    else if(k==='d'){ combatMove(1,0); }
    else if(ev.key==='1'||ev.key==='2'||ev.key==='3'){
      const cur=getChar(cs.currentChar);
      const skills=cur.skills.filter(s=>cur.selectedSkillIds.includes(s.id));
      const idx=+ev.key-1;
      if(skills[idx]) selectSkill(cs.currentChar, skills[idx].id);
    }
    else if(ev.key==='f1'||ev.key==='f2'||ev.key==='f3'){
      const chars=getTeamChars();
      const idx=+ev.key.slice(1)-1;
      if(chars[idx]){ cs.currentChar=chars[idx].key; updateCombatUI(); renderCombatMap(); }
    }
    return;
  }
  // 探索态
  if(!G||!G.map) return;
  if($('#modalOverlay').classList.contains('show')) return; // 弹窗打开时不误移
  if(ev.repeat) return; // 格子制：每次按键一步
  const k=ev.key.toLowerCase();
  let dx=0,dy=0;
  if(k==='w'){dy=-1;} else if(k==='s'){dy=1;} else if(k==='a'){dx=-1;} else if(k==='d'){dx=1;} else return;
  const nx=G.px+dx, ny=G.py+dy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n) return;
  moveExplore(nx,ny);
}
/* capture 阶段监听（在 bubble 的目标层之前触发，宿主/控件最不易拦截） */
document.addEventListener('keydown', handleKeys, true);

/* 睡觉：二次确认 → 回满AP、进下一天、生成新地图、回血、自动存档 */
function sleep(){
  if(!G) return;
  if(combatState){ log('战斗中无法使用该功能。'); return; }
  if(G.hero.actionPoint>0 && !confirm('行动力尚未耗尽，仍确定直接「睡觉」进入下一天吗？')) return;
  G.hero.actionPoint=G.hero.apCap;
  G.day+=1;
  const nm=generateMap(G.day);
  G.map=nm; G.px=nm.px; G.py=nm.py; G.hero.facing='up';
  G.hero.hp=Math.max(1, Math.min(G.hero.maxHp, Math.round(G.hero.hp+G.hero.maxHp*0.2)));
  saveGame(2);
  clearLog(); clearStory(); // 睡觉时清空行动记录与剧情区
  prompt(''); // 睡觉时刷新（清空）信息区
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
  const x=Math.min(ev.clientX+14, window.innerWidth-300);
  const y=ev.clientY+14;
  tip.style.left=x+'px'; tip.style.top=y+'px';
}