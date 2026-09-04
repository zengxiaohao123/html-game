/* ============================================================
   js/combat.js —— 模块：战斗系统
   回合制战斗：入场、移动即结束我方回合、多角色技能释放、
   攻击朝向判定、状态(buff/debuff)系统、伤害结算、暴击判定、
   元素附着/反应、敌人 AI、敌人意图/范围指示、胜负与失败后果。
   ============================================================ */
"use strict";

/* —— 状态系统 —— */
function addStatus(statuses, id, turns){
  if(!statuses) return;
  const meta=statusMeta(id);
  statuses[id]={ id, name:meta.name, kind:meta.kind, turns:(turns==null?null:turns), desc:meta.desc };
}
function tickStatuses(statuses){
  if(!statuses) return;
  for(const id of Object.keys(statuses)){
    const s=statuses[id];
    if(s.turns!=null){ s.turns--; if(s.turns<=0) delete statuses[id]; }
  }
}
function statusArr(statuses){ return Object.values(statuses||{}); }

/* 伤害类型中文（元素着色）；无元素=物理，特殊类型需说明 */
function elemText(type){
  if(type==='physical') return '物理伤害';
  if(type==='real'||type==='true') return '真实伤害';
  if(ELEM[type]) return `<span class="${ELEM[type].c}">${ELEM[type].zh}元素伤害</span>`;
  return '伤害';
}

/* 进入战斗：构建 combatState，并在主角旁生成一名敌人 */
function startCombat(cell){
  const key=cell.content.key, hp=cell.content.hp||ENEMIES[key].hp;
  const epos=placeEnemyNear(G.px,G.py,G.map.n);
  initCombatState({ enemyKey:key, enemyHp:hp, enemyPos:{x:epos.x,y:epos.y} });
  clearLog(); clearStory(); // 战斗开始时清空行动记录与剧情区
  log('进入战斗。你得击败所有敌人。');
  enterCombatMode();
}

/* 初始化战斗状态（进场 / 读档重回共用）。
   同时记录 startSnapshot：战斗中存档一律以「这次战斗开始瞬间」为准。 */
function initCombatState(o){
  const ally={};
  for(const k of G.team){ const c=getChar(k); ally[k]={statuses:{}, used:false, selSkill:c.selectedSkillIds[0]}; }
  combatState={
    hero:{x:G.px,y:G.py,facing:G.hero.facing,hp:G.hero.hp,maxHp:G.hero.maxHp,shield:0,auras:[]},
    enemies:[], ally, field:{},   // field = 全场结界/境界（显示在主角状态栏）
    playerMoved:false, playerOver:false,
    currentChar:G.team[0]||'pro',
    selectedEnemy:null, infoCell:null, enemyPage:0, pendingTarget:null,
    entryCell:G.px+','+G.py,
    day:G.day,
    startSnapshot:{
      heroHp:G.hero.hp,
      vehicles:JSON.parse(JSON.stringify(G.vehicles||[])),
      vehicleSel:G.vehicleSel!=null?G.vehicleSel:0,
      enemyKey:o.enemyKey, enemyHp:o.enemyHp, enemyPos:{x:o.enemyPos.x,y:o.enemyPos.y}
    }
  };
  combatState.enemies.push({
    x:o.enemyPos.x, y:o.enemyPos.y, facing:dirToFacing(G.px-o.enemyPos.x, G.py-o.enemyPos.y),
    def:ENEMIES[o.enemyKey], key:o.enemyKey, hp:o.enemyHp,
    aura:ENEMIES[o.enemyKey].aura||null, charge:0, shield:0, statuses:{}
  });
}

/* 读档重回战斗：以本次战斗开始瞬间的敌我状态直接进入战斗
   （剧情区随 mode='combat' 立即被角色技能区替换）。 */
function reenterCombat(snap){
  if(!snap || !G.map){ switchMode('story'); return; }
  const key=snap.enemyKey, hp=snap.enemyHp||ENEMIES[key].hp;
  let ex=snap.enemyPos?snap.enemyPos.x:-1, ey=snap.enemyPos?snap.enemyPos.y:-1;
  if(!(ex>=0 && ey>=0 && ex<G.map.n && ey<G.map.n && G.map.cells[ey*G.map.n+ex].terrain==='ground')){
    const p=placeEnemyNear(G.px,G.py,G.map.n); ex=p.x; ey=p.y;
  }
  initCombatState({ enemyKey:key, enemyHp:hp, enemyPos:{x:ex,y:ey} });
  clearLog(); clearStory();
  log('读档回到本次战斗开始。你得击败所有敌人。');
  enterCombatMode();
}

/* 在主格周边找最近的空地放敌人 */
function placeEnemyNear(px,py,n){
  const cand=[[px+1,py],[px-1,py],[px,py+1],[px,py-1]];
  for(const [x,y] of cand){
    if(x<0||y<0||x>=n||y>=n) continue;
    if(G.map.cells[y*n+x].terrain==='ground') return {x,y};
  }
  return {x:px,y:py};
}

/* 切换到战斗模式并刷新战斗界面 */
function enterCombatMode(){
  switchMode('combat');
  $('#goBtn').style.display='none';
  updateCombatUI();
  refreshHUD();
  renderCombatMap();
  renderIconbar(); // 战斗态：图标行置灰「编队/睡觉/商店/合成」
  ensureKeyFocus(); // 确保战斗键盘（WASD/Q/数字/F键）可靠触发
}

/* 战斗地图渲染：主角 + 敌人(带朝向) + 障碍/地图外 + 范围指示 */
function renderCombatMap(){
  if(!combatState) return;
  const m=G.map; const grid=$('#mapGrid');
  grid.style.gridTemplateColumns=`repeat(${m.n},44px)`;
  grid.innerHTML='';
  const cs=combatState;
  const curChar=getChar(cs.currentChar);
  const selSkill=curChar.skills.find(s=>s.id===cs.ally[cs.currentChar].selSkill);
  const rangeKeys=new Set(selSkill?skillRangeCells(selSkill).map(c=>c.x+','+c.y):[]);
  // 敌方指示器：仅当正在查看该敌人所在格时显示其攻击范围（且不含不可通行格），点击其他格则不显示
  const enemyKeys=new Set();
  const selEnemy = cs.infoCell ? cs.enemies.find(en=>en.x===cs.infoCell.x&&en.y===cs.infoCell.y) : null;
  if(selEnemy){
    for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=selEnemy.x+a, y=selEnemy.y+b;
      if(passable(x,y)) enemyKeys.add(x+','+y);
    }
  }
  for(let y=0;y<m.n;y++)for(let x=0;x<m.n;x++){
    const c=m.cells[y*m.n+x];
    const cell=el('<div class="cell"></div>');
    if(c.terrain==='obstacle')cell.classList.add('obstacle');
    else if(c.terrain==='void')cell.classList.add('void');
    const key=x+','+y;
    if(enemyKeys.has(key)) cell.classList.add('range-enemy');
    else if(rangeKeys.has(key)) cell.classList.add('range-ally');
    if(cs.hero.x===x&&cs.hero.y===y){cell.classList.add('player');cell.classList.add('facing-'+cs.hero.facing);}
    for(const en of cs.enemies){
      if(en.x===x&&en.y===y){
        cell.textContent=ENEMIES[en.key].icon; cell.style.color=ENEMIES[en.key].color;
        cell.classList.add('efacing-'+en.facing);
        cell.title=ENEMIES[en.key].name;
        cell.innerHTML+=`<div class="hpbar"><i style="width:${Math.max(5,en.hp)/ENEMIES[en.key].hp*100}%"></i></div>`;
      }
    }
    cell.dataset.x=x;cell.dataset.y=y;
    cell.addEventListener('click',()=>combatCellClick(x,y));
    grid.appendChild(cell);
  }
}

/* 技能可作用的目标格子（也用于范围指示器）；仅包含可通行(空地)格 */
function passable(x,y){
  const n=G.map.n;
  if(x<0||y<0||x>=n||y>=n) return false;
  return G.map.cells[y*n+x].terrain==='ground';
}
function skillRangeCells(skill){
  const pos=combatState.hero; const n=G.map.n;
  const [dx,dy]=facingDir(pos.facing);
  const out=[];
  if(skill.target==='front'){ const x=pos.x+dx,y=pos.y+dy; if(passable(x,y))out.push({x,y}); }
  else if(skill.target==='adj'){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=pos.x+a,y=pos.y+b; if(passable(x,y))out.push({x,y}); } }
  else if(skill.target==='frontline'){ for(let i=1;i<=skill.range;i++){ const x=pos.x+dx*i,y=pos.y+dy*i; if(passable(x,y))out.push({x,y}); } }
  else if(skill.target==='nearest'){ for(let x=0;x<n;x++)for(let y=0;y<n;y++) if(passable(x,y)&&Math.abs(x-pos.x)+Math.abs(y-pos.y)<=skill.range) out.push({x,y}); }
  else { out.push({x:pos.x,y:pos.y}); }
  return out;
}
function facingDir(f){ return f==='up'?[0,-1]:f==='down'?[0,1]:f==='left'?[-1,0]:[1,0]; }
function skillEnemies(skill){
  const keys=new Set(skillRangeCells(skill).map(c=>c.x+','+c.y));
  return combatState.enemies.filter(en=>keys.has(en.x+','+en.y));
}
function hasValidTarget(skill){
  if(!combatState) return false;
  if(skill.kind!=='attack') return true;
  return skillEnemies(skill).length>0;
}

/* —— 数值 / 描述 —— */
function charBaseAtk(charKey){ return charKey==='pro'? G.hero.atk : (getChar(charKey).atk||0); }
function charAtk(charKey){
  const base=charBaseAtk(charKey); let a=base;
  if(combatState&&combatState.ally[charKey]){
    const sts=combatState.ally[charKey].statuses;
    if(sts.atkUp) a+=Math.round(base*0.25);
  }
  return a;
}
/* —— 暴击率 —— */
/* 基础暴击率：来自会加暴击的天赋（主角·暴击 / 陆悠悠·风息），随等级变化 */
function baseCritRate(charKey){
  const c=getChar(charKey); let crit=0;
  const pick=charKey==='pro'
    ? c.passives.find(p=>p.id==='crit')
    : (charKey==='luyouyou' ? c.passives.find(p=>p.id==='wind') : null);
  if(pick && pick.scal && pick.scal.crit) crit += tierValue(pick, entryLevel(charKey,pick), 'crit');
  return crit;
}
/* 实时暴击率：基础 + 临时加成（屏息/比翼等「下一次攻击暴击率+100%」），最终限幅0~100% */
function charCritRate(charKey){
  let r=baseCritRate(charKey);
  const sts=combatState && combatState.ally[charKey] && combatState.ally[charKey].statuses;
  if(sts && sts.crit) r+=100;
  return Math.max(0, Math.min(100, r));
}
function skillDamagePreview(charKey, skill){
  if(!skill||!skill.effect) return null;
  return Math.max(1, Math.round(charAtk(charKey)*skill.effect(1)));
}
/* 数值化技能描述：{DMG}=公式+当前数值；{Y}=治疗等当前数值；可升级数值黄字；词条转悬浮 */
function describeSkill(charKey, skill){
  if(!skill) return '';
  let d=skill.desc||'';
  const dmg=skillDamagePreview(charKey, skill);
  if(skill.scal){ // 有等级：等级=主角自身等级/队友羁绊等级，可升级数值黄色高亮
    const level=entryLevel(charKey, skill);
    const ext={};
    if(dmg!=null && skill.formula) ext.DMG=`${skill.formula}（当前约${dmg}点）`;
    const hp=healPreview(charKey, skill);
    if(hp) ext.Y=hp;
    d=lvDescText(skill, level, ext);
  } else {
    if(dmg!=null && skill.formula) d=d.replace(/\{DMG\}/g, `${skill.formula}（当前约${dmg}点）`);
    if(skill.healPct) d=d.replace(/\{Y\}/g, Math.round((getChar(charKey).atk||0)*skill.healPct));
  }
  return terms(d);
}
/* 治疗类辅助技能的预览治疗量 */
function healPreview(charKey, skill){
  if(skill && skill.id==='guwu'){
    const level=entryLevel(charKey, skill);
    const heal=vTier(skill,'heal',level); // %
    return Math.round((getChar(charKey).atk||0)*heal/100);
  }
  if(skill && skill.healPct) return Math.round((getChar(charKey).atk||0)*skill.healPct);
  return 0;
}
/* 读取某条目 scals 中 key 当前等级下的值（百分比返回 0~100 点数形式） */
function vTier(entry,key,level){ return (entry&&entry.scal&&entry.scal[key])? tierValue(entry,level,key):0; }

/* 战斗内点击格子：查看信息 / 选目标 / 选移动目标（需点「前往」确认，不会直接走） */
function combatCellClick(x,y){
  const cs=combatState; if(!cs) return;
  if(mapDragMoved) return;
  cs.infoCell={x,y};
  cs.pendingTarget={x,y};
  const enemy=cs.enemies.find(en=>en.x===x&&en.y===y);
  if(enemy){ cs.selectedEnemy=enemy; cs.enemyPage=0; }
  updateCombatInfo();
  bindCombatGo(x,y);
  renderCombatMap();
}

/* 信息区「前往」按钮（战斗）：确认移动到目标格 */
function bindCombatGo(x,y){
  const cs=combatState; const go=$('#goBtn');
  const dx=x-cs.hero.x, dy=y-cs.hero.y;
  if(cs.playerMoved || Math.abs(dx)+Math.abs(dy)!==1){ go.style.display='none'; return; }
  go.style.display='block';
  go.disabled=false;
  go.onclick=confirmCombatMove;
}
/* 确认移动：目标为障碍/实体/地图外时只转向，均视为本回合已移动 */
function confirmCombatMove(){
  const cs=combatState; if(!cs) return;
  if(cs.playerMoved) return;
  if(!cs.pendingTarget) return;
  const {x,y}=cs.pendingTarget;
  const dx=x-cs.hero.x, dy=y-cs.hero.y;
  if(Math.abs(dx)+Math.abs(dy)!==1){ log('只能移动到相邻一格。'); $('#goBtn').style.display='none'; return; }
  $('#goBtn').style.display='none';
  const c=G.map.cells[y*G.map.n+x];
  cs.hero.facing=dirToFacing(dx,dy);
  const moved=(c.terrain==='ground' && !cs.enemies.some(en=>en.x===x&&en.y===y));
  if(moved){ cs.hero.x=x; cs.hero.y=y; useVehicleOnMove(); }
  else { log('前方有阻挡，你只改变了朝向。'); }
  cs.playerMoved=true;
  autoCastAll(); if(!combatState) return;
  endPlayerPhase();
}

/* 战斗内 WASD 移动（直接走，不需确认；目标为障碍/实体/地图外时只转向并计已移动） */
function combatMove(dx,dy){
  const cs=combatState; if(!cs)return;
  if(cs.playerMoved) return;
  const nx=cs.hero.x+dx, ny=cs.hero.y+dy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n)return;
  const c=G.map.cells[ny*G.map.n+nx];
  cs.hero.facing=dirToFacing(dx,dy);
  const moved=(c.terrain==='ground' && !cs.enemies.some(en=>en.x===nx&&en.y===ny));
  if(moved){ cs.hero.x=nx; cs.hero.y=ny; useVehicleOnMove(); }
  else { log('前方有阻挡，你只改变了朝向。'); }
  cs.playerMoved=true; cs.infoCell={x:cs.hero.x,y:cs.hero.y}; cs.pendingTarget=null;
  autoCastAll(); if(!combatState) return;
  endPlayerPhase();
}

/* 选中技能：单击选中；再次点击同一技能=主动使用 */
function selectSkill(charKey, skillId){
  const cs=combatState; if(!cs) return;
  if(cs.ally[charKey].selSkill===skillId){ castSkill(charKey, true); }
  else { cs.ally[charKey].selSkill=skillId; updateCombatUI(); renderCombatMap(); }
}

/* 主动使用技能（Q 键 / 双击技能），必须在移动前 */
function castSkill(charKey, manual){
  const cs=combatState; if(!cs) return;
  if(cs.ally[charKey].used) return;
  if(cs.playerMoved){ if(manual) prompt('本回合已移动，技能请于移动前使用。'); return; }
  const char=getChar(charKey);
  const skill=char.skills.find(s=>s.id===cs.ally[charKey].selSkill);
  if(!skill) return;
  if(!hasValidTarget(skill)){
    if(manual) prompt(`「${skill.name}」当前没有可以命中的目标。`);
    return; // 移动前主动使用失败：不视为使用技能
  }
  resolveSkill(charKey, skill, manual);
  if(!combatState) return;
  cs.ally[charKey].used=true;
  updateCombatUI(); renderCombatMap();
}

/* 移动后自动释放所有尚未使用技能的角色（按队伍顺序） */
function autoCastAll(){
  if(!combatState) return;
  for(const k of G.team){ autoCastChar(k); if(!combatState) return; }
}
function autoCastChar(charKey){
  const cs=combatState; const char=getChar(charKey);
  if(cs.ally[charKey].used) return;
  const skill=char.skills.find(s=>s.id===cs.ally[charKey].selSkill);
  if(!skill) return;
  if(!hasValidTarget(skill)){
    cs.ally[charKey].used=true;
    log(`${char.name} 没有可命中的目标，本回合跳过不使用技能。`);
    return;
  }
  resolveSkill(charKey, skill, false);
  if(!combatState) return;
  cs.ally[charKey].used=true;
}

/* 技能结算：算伤害（含暴击）、应用效果与状态、记录行动记录、检查结束 */
function resolveSkill(charKey, skill, manual){
  if(!combatState) return;
  const char=getChar(charKey);
  if(skill.kind==='support'){ applySupport(charKey, skill); return; }
  let enemies=skillEnemies(skill);
  if(enemies.length===0) return;
  const enemy = combatState.selectedEnemy && enemies.includes(combatState.selectedEnemy) ? combatState.selectedEnemy : enemies[0];
  const base=charAtk(charKey);
  const critRate=charCritRate(charKey);
  const isCrit=Math.random()*100 < critRate;
  let dmg=base*(1-(ENEMIES[enemy.key].dmgReduc||0))*(skill.effect?skill.effect(1):1);
  dmg=Math.max(1,Math.round(dmg));
  if(isCrit) dmg*=2; // 暴击伤害固定+100%（即×2）
  const critTxt=isCrit?'<span class="crit-hint">暴击！</span>':'';
  log(`${char.name} 使用 <b>${skill.name}</b>，对${ENEMIES[enemy.key].name}造成 ${critTxt}<b>${dmg}</b> 点${elemText(skill.type)}。`);
  applyEnemyDamage(enemy,dmg,skill);
  // 使用了一次攻击型技能 → 消耗「下一次攻击暴击率+100%」效果（屏息/比翼，提前失效）
  consumeCritBuff(charKey);
  // 陆悠悠·比翼：自身暴击后，其余我方角色下一次攻击暴击率+100%
  if(isCrit && charKey==='luyouyou'){ triggerBiyi(); }
  if(skill.burn){ addStatus(enemy.statuses,'burn',skill.burn); log(`${ENEMIES[enemy.key].name} 进入【燃烧】状态。`); }
  if(skill.alert) applyAlert(enemy);
  if(skill.type!=='physical' && AURA_ELEMS.includes(skill.type)) setAura(enemy, skill.type);
  if(charKey==='pro'){
    if(skill.selfDrain){ const lost=Math.min(G.hero.hp, Math.floor(G.hero.maxHp*skill.selfDrain)); G.hero.hp-=lost; combatState.hero.hp=G.hero.hp; log(`自身流失${lost}生命。`); }
    if(skill.selfHeal){ const h=Math.min(G.hero.maxHp,G.hero.hp+Math.floor(G.hero.maxHp*skill.selfHeal)); const healed=h-G.hero.hp; G.hero.hp=h; combatState.hero.hp=G.hero.hp; if(healed>0) log(`回复 ${healed} 点生命。`); }
    if(skill.dr){ addStatus(combatState.ally.pro.statuses,'dr',1); log('获得【伤害减免】。'); }
  }
  checkCombatEnd();
}
/* 使用攻击型技能后，消耗该单位的「下一次攻击暴击率+100%」标记 */
function consumeCritBuff(charKey){
  const sts=combatState && combatState.ally[charKey] && combatState.ally[charKey].statuses;
  if(sts && sts.crit){ delete sts.crit; log(`${getChar(charKey).name} 消耗了【屏息】，暴击加成已生效。`); }
}
/* 陆悠悠·比翼：自身暴击后，其余我方角色下一次攻击暴击率+100% */
function triggerBiyi(){
  for(const k of G.team){
    if(k==='luyouyou') continue;
    const sts=combatState.ally[k] && combatState.ally[k].statuses;
    if(sts) addStatus(sts,'crit',null);
  }
  log('【比翼】触发：其余我方角色下一次攻击暴击率+100%。');
}

/* 设置【重点目标】（单一目标） */
function applyAlert(enemy){
  for(const e of combatState.enemies) delete e.statuses.alert;
  addStatus(enemy.statuses,'alert',null);
  log(`${ENEMIES[enemy.key].name} 成为【重点目标】。`);
}

/* 辅助技能 */
function applySupport(charKey, skill){
  const cs=combatState;
  if(skill.id==='guwu'){
    const level=entryLevel(charKey, skill);
    const healPct=vTier(skill,'heal',level)/100;   // 鼓舞·治疗%，随等级
    const atkBuff=vTier(skill,'buff',level)/100;   // 鼓舞·攻击增益%，随等级
    const heal=Math.max(1,Math.round((getChar(charKey).atk||0)*healPct));
    if(cs.hero.hp<G.hero.maxHp){ cs.hero.hp=Math.min(G.hero.maxHp, cs.hero.hp+heal); G.hero.hp=cs.hero.hp; log(`主角回复 ${heal} 点生命。`); }
    let top=null, topAtk=-1;
    for(const k of G.team){ const a=charAtk(k); if(a>topAtk){topAtk=a; top=k;} }
    if(top){ addStatus(cs.ally[top].statuses,'atkUp',2); log(`${getChar(top).name} 攻击力+${Math.round(atkBuff*100)}%（持续2回合）。`); }
  } else if(skill.id==='bixi'){
    addStatus(cs.ally[charKey].statuses,'crit',2);
    log(`${getChar(charKey).name} 屏息凝神，下一次攻击暴击率+100%。`);
  } else {
    log(`${getChar(charKey).name} 施展「${skill.name}」。`);
  }
  checkCombatEnd();
}

/* 对敌人造成伤害（含击杀移除） */
function applyEnemyDamage(enemy,dmg,skill){
  enemy.hp-=dmg;
  if(enemy.hp>0 && skill.type!=='physical' && skill.type!=='wind' && skill.type!=='rock') checkReaction(enemy, skill.type);
  if(enemy.hp<=0){ log(`${ENEMIES[enemy.key].name} 被击败！`); combatState.enemies=combatState.enemies.filter(e=>e!==enemy); }
}

function setAura(enemy,elem){
  if(!AURA_ELEMS.includes(elem)) return;
  enemy.aura=elem;
  enemy.statuses.aura={id:'aura', name:'附着·'+ELEM[elem].zh, kind:'neutral', turns:null,
    desc:'元素附着：该目标受到'+ELEM[elem].zh+'元素伤害时可能触发元素反应。附着会顶替旧附着。'};
}

/* 元素反应（MVP） */
function checkReaction(enemy, elementHit){
  if(!enemy.aura || enemy.aura===elementHit) return;
  const a=enemy.aura, h=elementHit;
  if(a==='fire'&&h==='water'){ enemy.hp-=Math.max(1,Math.round(enemy.hp*0.15)); log(`<span class="e-water">蒸发</span>！${ENEMIES[enemy.key].name}受额外伤害。`); }
  else if(a==='water'&&h==='grass'){ spawnSlime(); log(`${termHTML('zone','绽放')}生成一只草史莱姆援军。`); }
  else if(a==='fire'&&h==='grass'){ addStatus(enemy.statuses,'burn',3); log(`<span class="e-grass">燃烧</span>！${ENEMIES[enemy.key].name}将持续灼烧。`); }
  enemy.aura=null;
  delete enemy.statuses.aura; // 附着随反应消失，改由状态栏表示
}

function spawnSlime(){ const e=combatState.enemies[0]; if(e){ e.hp-=4; log('草史莱姆助战，施加草系冲击。'); } }

/* 判定战斗结束 */
function checkCombatEnd(){
  if(!combatState) return;
  if(combatState.enemies.length===0){ G.records.wins=(G.records.wins||0)+1; log('战斗胜利！'); endCombat(true); return; }
  if(combatState.hero.hp<=0){ endCombatByDefeat(); }
}

/* 敌人回合：燃烧流失、靠近或贴身攻击 */
function enemyTurn(){
  const cs=combatState; if(!cs) return;
  const enemy=cs.enemies[0];
  if(!enemy) return;
  if(enemy.statuses.burn){ const burn=Math.max(1,Math.round(enemy.hp*0.02)); enemy.hp-=burn; log(`${ENEMIES[enemy.key].name}受【燃烧】流失${burn}生命。`); }
  const dx=cs.hero.x-enemy.x, dy=cs.hero.y-enemy.y;
  enemy.facing=dirToFacing(dx,dy);
  const dist=Math.abs(dx)+Math.abs(dy);
  if(dist===1){
    const eDef=ENEMIES[enemy.key];
    let dmg=eDef.atk*eDef.skillMult;
    const shield=cs.hero.shield;
    if(shield>0){ const absorb=Math.min(shield,dmg); cs.hero.shield-=absorb; dmg-=absorb; }
    dmg=Math.max(1,Math.round(dmg));
    cs.hero.hp-=dmg; G.hero.hp=cs.hero.hp;
    log(`${ENEMIES[enemy.key].name} 攻击你，造成 ${dmg} 点${elemText('physical')}。`);
    if(eDef.aura){ cs.hero.aura=eDef.aura;
      cs.ally.pro.statuses.aura={id:'aura', name:'附着·'+ELEM[eDef.aura].zh, kind:'neutral', turns:null,
        desc:'元素附着：受到'+ELEM[eDef.aura].zh+'元素伤害时可能触发元素反应。附着会顶替旧附着。'};
    }
  } else {
    let nx=enemy.x, ny=enemy.y;
    if(Math.abs(dx)>Math.abs(dy)) nx += dx>0?1:-1; else ny += dy>0?1:-1;
    const inb=nx>=0&&ny>=0&&nx<G.map.n&&ny<G.map.n;
    if(inb && G.map.cells[ny*G.map.n+nx].terrain!=='obstacle' && G.map.cells[ny*G.map.n+nx].terrain!=='void' && !cs.enemies.some(e2=>e2!==enemy&&e2.x===nx&&e2.y===ny)){
      if(!(nx===cs.hero.x&&ny===cs.hero.y)){ enemy.x=nx; enemy.y=ny; log(`${ENEMIES[enemy.key].name} 逼近。`); }
    }
  }
  cs.hero.shield=0;
  tickStatuses(enemy.statuses); // 敌人状态按回合推进
  checkCombatEnd();
}

/* 我方回合结束：敌人行动 → 状态推进 → 重置回合状态 → 刷新界面 */
function endPlayerPhase(){
  const cs=combatState; if(!cs) return;
  if(cs.enemies.length===0){ return; }
  enemyTurn();
  if(!combatState) return;
  for(const k of G.team) tickStatuses(cs.ally[k].statuses);
  tickStatuses(cs.field);
  cs.hero.shield=0; cs.playerMoved=false; cs.playerOver=false;
  for(const k of G.team) cs.ally[k].used=false;
  $('#goBtn').style.display='none'; // 新回合开始时隐藏「前往」
  renderCombatMap(); updateCombatUI(); refreshHUD();
}

/* —— 状态栏 HTML：状态需鼠标【点击】查看详情（非悬浮） —— */
function statusChipHTML(s){
  const safe=(s.desc||'').replace(/\"/g,'&quot;');
  return `<span class="stchip st-${s.kind}" data-st="${s.id}" data-name="${s.name}" data-desc="${safe}">${s.name}${s.turns!=null?` ·${s.turns}回合`:''}</span>`;
}
function statusBarHTML(statuses, extraField){
  let chips='';
  chips += statusArr(statuses).map(statusChipHTML).join('');
  if(extraField && Object.keys(extraField).length){
    chips += `<span class="stlabel">全场</span>`+statusArr(extraField).map(statusChipHTML).join('');
  }
  return `<div class="stbar">${chips||'<span class="stempty">无状态</span>'}</div>`;
}

/* 刷新战斗 UI：角色卡 / 属性 / 状态栏 / 技能 / 天赋 / 技能详情 / 信息区 */
function updateCombatUI(){
  if(!combatState){ switchMode('story'); return; }
  const cs=combatState;
  const chars=getTeamChars();
  const cur=chars.find(c=>c.key===cs.currentChar)||chars[0];
  $('#allyBar').innerHTML=chars.map((c,i)=>`<div class="allyCard ${c.key===cs.currentChar?'active':''}" data-k="${c.key}">
      <div class="allyName">${c.name}</div>
      <div class="allyElem">${c.element?ELEM[c.element].zh:'无属性'} · ${i+1}号位</div>
    </div>`).join('');
  $('#allyBar').querySelectorAll('.allyCard').forEach(b=>b.onclick=()=>{ cs.currentChar=b.dataset.k; updateCombatUI(); renderCombatMap(); });
  $('#charAttrs').innerHTML=charAttrsHTML(cur.key);
  $('#statusBar').innerHTML = cur.key==='pro'
    ? statusBarHTML(cs.ally.pro.statuses, cs.field)
    : statusBarHTML(cs.ally[cur.key].statuses, null);
  const skills=cur.skills.filter(s=>cur.selectedSkillIds.includes(s.id));
  $('#skillList').innerHTML=skills.map((s,i)=>`<div class="skillTag ${s.kind==='attack'?'attack':'skill'} ${cs.ally[cur.key].selSkill===s.id?'active':''}" data-s="${s.id}">
      <span class="skillNum">${i+1}</span>${skillDisplayName(cur.key,s)}${cs.ally[cur.key].used?' <span class="usedMark">已用</span>':''}
    </div>`).join('');
  $('#skillList').querySelectorAll('.skillTag').forEach(b=>b.onclick=()=>selectSkill(cur.key, b.dataset.s));
  $('#talentBox').innerHTML=`<span class="talentLabel">天赋</span>`+cur.passives.map((p,i)=>`<span class="talentTag" data-k="${cur.key}" data-i="${i}">${talentDisplayName(cur.key,p)}</span>`).join('');
  const sel=cur.skills.find(s=>s.id===cs.ally[cur.key].selSkill);
  $('#skillDetail').innerHTML= sel? `<div class="skillDetailName">${skillDisplayName(cur.key,sel)}</div><div class="skillDetailText">${describeSkill(cur.key, sel)}</div>` : '';
  updateCombatInfo();
}

/* 技能/天赋带等级的展示名：在尾部附加「·等级N」 */
function skillDisplayName(ownerKey, s){ return s.scal ? `${s.name}·等级${entryLevel(ownerKey,s)}` : s.name; }
function talentDisplayName(ownerKey, p){ return p.scal ? `${p.name}·等级${entryLevel(ownerKey,p)}` : p.name; }

/* 数值行：攻防血、逃跑速度、暴击率等写在这独立一行（角色卡内不显示数值） */
function charAttrsHTML(key){
  if(key==='pro'){
    const h=G.hero;
    return `<span class="attr"><b>攻击</b> ${h.atk}</span>
      <span class="attr"><b>生命</b> ${Math.round(combatState.hero.hp)}/${h.maxHp}</span>
      <span class="attr"><b>防御</b> ${h.def}</span>
      <span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span>
      <span class="attr"><b>逃跑速度</b> ${h.escapeSpeed}</span>`;
  }
  const c=getChar(key);
  return `<span class="attr"><b>攻击</b> ${c.atk}</span>
    <span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span>`; // 元素属性随角色名展示，不放进数值行
}

/* —— 信息区 —— */
function updateCombatInfo(){
  const cs=combatState; if(!cs) return;
  if(!cs.infoCell) cs.infoCell={x:cs.hero.x,y:cs.hero.y};
  const {x,y}=cs.infoCell;
  const en=cs.enemies.find(en=>en.x===x&&en.y===y);
  if(en){ prompt(enemyInfo(en)); return; }
  if(x===cs.hero.x&&y===cs.hero.y){ prompt(heroInfoHTML()); return; }
  const c=G.map.cells[y*G.map.n+x];
  const tname = c.terrain==='void'?'不可通行':c.terrain==='obstacle'?'山脉障碍':'空地';
  prompt(`<b>${tname}</b>（${x+1},${y+1}）`);
}
function heroInfoHTML(){
  const cs=combatState;
  return `<b>主角</b><br>攻击 ${G.hero.atk} · 防御 ${G.hero.def} · 生命 ${Math.round(cs.hero.hp)}/${G.hero.maxHp}${cs.hero.shield?`<br>护盾 ${Math.round(cs.hero.shield)}`:''}<br><div class="sec">状态</div>${statusBarHTML(cs.ally.pro.statuses, cs.field)}`;
}
/* 敌人信息：两个页面（属性 / 详细技能） */
function enemyInfo(en){
  const cs=combatState;
  const tabs=`<div class="infotabs">
      <button class="infotab ${cs.enemyPage===0?'on':''}" onclick="switchEnemyPage(0)">属性</button>
      <button class="infotab ${cs.enemyPage===1?'on':''}" onclick="switchEnemyPage(1)">详细技能</button>
    </div>`;
  if(cs.enemyPage===1) return tabs+enemySkillsHTML(en);
  return tabs+enemyAttrsHTML(en);
}
window.switchEnemyPage=function(p){ if(combatState){ combatState.enemyPage=p; updateCombatInfo(); } };
function enemyAttrsHTML(en){
  const eDef=ENEMIES[en.key];
  const it=enemyIntent(en);
  return `<b>${eDef.name}</b>（${eDef.icon}）<br>
    ${it.text}<br>
    攻击 ${eDef.atk} · 生命 ${Math.round(en.hp)}/${eDef.hp}<br>
    <div class="sec">状态</div>${statusBarHTML(en.statuses, null)}`;
}
function enemySkillsHTML(en){
  const eDef=ENEMIES[en.key];
  const move = eDef.move || '移动：向主角方向移动，每次一格。';
  const list=(eDef.skills||[]).map(s=>`<div class="eskill"><b>${s.name}</b>（${s.kind==='attack'?'攻击':'特殊'}）<br>${s.desc}</div>`).join('');
  return `<b>${eDef.name}</b> 的技能 / 特殊效果：
    <div class="eskill"><b>移动</b>（移动）<br>${move}</div>${list||'暂无'}`;
}
/* 敌人本回合意图（详细）：是否移动、如何移动、是否攻击、用哪个技能 */
function enemyIntent(en){
  const dx=combatState.hero.x-en.x, dy=combatState.hero.y-en.y;
  const dist=Math.abs(dx)+Math.abs(dy);
  const eDef=ENEMIES[en.key];
  const atkSkill=(eDef.skills||[]).find(s=>s.kind==='attack');
  if(dist===1){
    return {text:`意图：<b>攻击</b>（将使用「${atkSkill?atkSkill.name:'普通攻击'}」攻击主角）`};
  }
  const dir = Math.abs(dx)>=Math.abs(dy) ? (dx>0?'向右':'向左') : (dy>0?'向下':'向上');
  return {text:`意图：<b>移动</b>（向主角方向（${dir}）移动逼近，贴身后再攻击）`};
}

/* 键盘处理（探索 WASD / 战斗 移动/技能/切人）已统一移至 js/main.js 的 handleKeys
   （capture 阶段监听，焦点更可靠，弹窗打开时不误移）。 */

/* 战斗胜利 */
function endCombat(victory){
  const cs=combatState;
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey; G.hero.hp=Math.max(1,Math.round(cs.hero.hp||1));
  G.hero.facing='up';
  combatState=null;
  clearLog();
  const e=G.map.cells[ey*G.map.n+ex];
  if(e.content&&e.content.type==='enemy'&&victory){ e.content={type:'empty'}; }
  switchMode('story');
  prompt(''); // 战斗结束时刷新（清空）信息区
  renderMap(); refreshHUD();
}

/* 战斗失败 */
function endCombatByDefeat(){
  const cs=combatState;
  const eDef=ENEMIES[cs.enemies[0].key];
  G.hero.health=Math.max(0,G.hero.health-(eDef.failureHealthPenalty||5));
  log(`战斗失败，健康值 -${eDef.failureHealthPenalty||5}。`);
  G.hero.hp=1;
  combatState=null;
  clearLog();
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey;
  // 战斗失败：保留该格敌人，使其可再次作战（防止任何情况下被误清空）
  const entry=G.map.cells[ey*G.map.n+ex];
  if(cs.enemies[0] && entry.content && entry.content.type!=='enemy'){
    entry.content={type:'enemy', key:cs.enemies[0].key, id:0};
  }
  switchMode('story');
  prompt(''); // 战斗结束时刷新（清空）信息区
  renderMap(); refreshHUD();
  if(G.hero.health<=0){ showGameOver(); }
  else { alertDialog('战斗失败','你损失了部分健康。'); }
}