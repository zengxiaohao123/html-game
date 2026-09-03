/* ============================================================
   js/combat.js —— 模块：战斗系统
   回合制战斗：入场、移动即结束我方回合、技能释放、
   伤害结算、元素附着/反应、敌人 AI、胜负与失败后果。
   ============================================================ */
"use strict";

/* 进入战斗：构建 combatState，并在主角旁生成一名敌人 */
function startCombat(cell){
  combatState={
    hero:{x:G.px,y:G.py,facing:G.hero.facing,hp:G.hero.hp,maxHp:G.hero.maxHp,shield:0,auras:[]},
    enemies:[],
    playerMoved:false, heroUsedSkill:false, playerOver:false,
    selectedSkillId:'slash', selectedEnemy:null,
    entryCell:G.px+','+G.py,
    day:G.day
  };
  const epos=placeEnemyNear(G.px,G.py,G.map.n);
  combatState.enemies.push({
    x:epos.x, y:epos.y,
    def:ENEMIES[cell.content.key], key:cell.content.key, hp:cell.content.hp||ENEMIES[cell.content.key].hp,
    aura:ENEMIES[cell.content.key].aura||null, charge:0, shield:0
  });
  story('战斗开始！');
  log('进入战斗。你得击败所有敌人。');
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
  updateCombatUI();
  refreshHUD();
  renderCombatMap();
}

/* 渲染战斗地图（主角 + 敌人 + 障碍 + 血条） */
function renderCombatMap(){
  if(!combatState) return;
  const m=G.map; const grid=$('#mapGrid');
  grid.style.gridTemplateColumns=`repeat(${m.n},44px)`;
  grid.innerHTML='';
  for(let y=0;y<m.n;y++)for(let x=0;x<m.n;x++){
    const c=m.cells[y*m.n+x];
    const cell=el('<div class="cell"></div>');
    if(c.terrain==='obstacle')cell.classList.add('obstacle');
    const cs=combatState;
    if(cs.hero.x===x&&cs.hero.y===y){cell.classList.add('player');cell.classList.add('facing-'+cs.hero.facing);}
    for(const en of cs.enemies){
      if(en.x===x&&en.y===y){
        cell.textContent=ENEMIES[en.key].icon; cell.style.color=ENEMIES[en.key].color;
        cell.title=ENEMIES[en.key].name;
        cell.innerHTML+=`<div class="hpbar"><i style="width:${Math.max(5,en.hp)/ENEMIES[en.key].hp*100}%"></i></div>`;
        if(en.aura)cell.innerHTML+=`<div class="aura-tag">${ELEM[en.aura].zh}</div>`;
      }
    }
    cell.dataset.x=x;cell.dataset.y=y;
    cell.addEventListener('click',()=>combatCellClick(x,y));
    grid.appendChild(cell);
  }
}

/* 战斗内点格子：选敌人为目标 / 移动结束我方回合 */
function combatCellClick(x,y){
  const cs=combatState;
  if(!cs) return;
  const enemy=cs.enemies.find(en=>en.x===x&&en.y===y);
  if(enemy){ cs.selectedEnemy=enemy; prompt(`已选定目标：${ENEMIES[enemy.key].name}`); updateCombatUI(); return; }
  const dx=x-cs.hero.x, dy=y-cs.hero.y;
  if(Math.abs(dx)+Math.abs(dy)!==1){ prompt('只能移动到相邻一格。'); return; }
  const c=G.map.cells[y*G.map.n+x];
  if(c.terrain==='obstacle'){ prompt('山脉阻挡。'); return; }
  if(cs.enemies.some(en=>en.x===x&&en.y===y)){ prompt('有敌人占据该格。'); return; }
  if(cs.playerMoved){ prompt('本回合已移动，请先结算敌人行动。'); return; }
  cs.hero.facing=dirToFacing(dx,dy);
  cs.hero.x=x; cs.hero.y=y;
  cs.playerMoved=true;
  autoCastHero();
  endPlayerPhase();
}

/* 主动释放已选技能（Q 键，移动前） */
function castSelectedSkill(){
  if(!combatState) return;
  if(combatState.playerMoved){ prompt('本回合已移动，技能请于移动前使用。'); return; }
  if(combatState.heroUsedSkill||combatState.playerOver){ return; }
  const skill=PROTAGONIST.skills.find(s=>PROTAGONIST.selectedSkillIds.includes(s.id)&&s.id===combatState.selectedSkillId)||PROTAGONIST.skills.find(s=>s.id===combatState.selectedSkillId);
  if(!skill){ return; }
  resolveSkill(PROTAGONIST, skill, true);
  if(!combatState) return;
  combatState.heroUsedSkill=true;
  updateCombatUI();
}

/* 技能结算：算伤害、记录日志与剧情、处理副作用与元素、检查结束 */
function resolveSkill(actor, skill, manual){
  if(!combatState) return;
  const enemy=combatState.selectedEnemy || combatState.enemies[0];
  if(!enemy) return;
  let dmg=computeDamageActor(actor, skill, enemy);
  const txt=e(`${skill.name}对${ENEMIES[enemy.key].name}造成${Math.round(dmg)}点伤害。`);
  log(txt); story(`<b>${actor.name}</b>：${txt}`);
  applyEnemyDamage(enemy,dmg,skill);
  if(skill.selfDrain){ const lost=Math.min(G.hero.hp, Math.floor(G.hero.maxHp*skill.selfDrain)); G.hero.hp-=lost; log(`自身流失${lost}生命。`); }
  if(skill.selfHeal){ G.hero.hp=Math.min(G.hero.maxHp,G.hero.hp+Math.floor(G.hero.maxHp*skill.selfHeal)); }
  if(skill.type!=='physical' && AURA_ELEMS.includes(skill.type)){ setAura(enemy, skill.type); }
  checkCombatEnd();
}

/* 伤害公式（MVP 简化版）：攻击力 × 减伤 × 技能倍率 */
function computeDamageActor(actor, skill, enemy){
  let base = actor.base ? actor.base.atk : (actor.atk||0);
  let dmg = base;
  dmg *= (1 - (ENEMIES[enemy.key].dmgReduc||0));
  dmg *= skill.effect ? skill.effect(1) : 1;
  return dmg;
}

/* 移动后自动释放已选技能 */
function autoCastHero(){
  if(!combatState||combatState.heroUsedSkill) return;
  const skill=PROTAGONIST.skills.find(s=>s.id===combatState.selectedSkillId);
  if(!skill) return;
  resolveSkill(PROTAGONIST, skill, false);
  if(!combatState) return;
  combatState.heroUsedSkill=true;
}

/* 对敌人造成伤害（含击杀移除） */
function applyEnemyDamage(enemy,dmg,skill){
  enemy.hp-=dmg;
  if(enemy.hp>0 && skill.type!=='physical' && skill.type!=='wind' && skill.type!=='rock'){
    checkReaction(enemy, skill.type);
  }
  if(enemy.hp<=0){
    log(`${ENEMIES[enemy.key].name} 被击败！`);
    combatState.enemies=combatState.enemies.filter(e=>e!==enemy);
  }
}

/* 施加元素附着 */
function setAura(enemy,elem){ if(AURA_ELEMS.includes(elem)) enemy.aura=elem; }

/* 元素反应（MVP：蒸发 / 绽放 / 燃烧） */
function checkReaction(enemy, elementHit){
  if(!enemy.aura || enemy.aura===elementHit) return;
  const a=enemy.aura, h=elementHit;
  if(a==='fire'&&h==='water'){ enemy.hp-=Math.max(1,Math.round(enemy.hp*0.15)); log(`<span class="e-water">蒸发</span>！${ENEMIES[enemy.key].name}受额外伤害。`); }
  else if(a==='water'&&h==='grass'){ spawnSlime(); log(`${termHTML('zone','绽放')}生成一只草史莱姆援军。`); }
  else if(a==='fire'&&h==='grass'){ enemy.burn=3; log(`<span class="e-grass">燃烧</span>！${ENEMIES[enemy.key].name}将持续灼烧。`); }
  enemy.aura=null;
}

/* 绽放援军（草史莱姆助战） */
function spawnSlime(){
  const e=combatState.enemies[0];
  if(e){ e.hp-=4; log('草史莱姆助战，施加草系冲击。'); }
}

/* 判定战斗结束：全灭胜利 / 主角阵亡失败 */
function checkCombatEnd(){
  if(!combatState) return;
  if(combatState.enemies.length===0){
    G.records.wins=(G.records.wins||0)+1;
    log('战斗胜利！');
    story('战斗胜利，你收起了武器。');
    endCombat(true);
    return;
  }
  if(combatState.hero.hp<=0){
    endCombatByDefeat();
  }
}

/* 敌人回合：燃烧流失、靠近或贴身攻击 */
function enemyTurn(){
  const cs=combatState; if(!cs) return;
  const enemy=cs.enemies[0];
  if(!enemy) return;
  if(enemy.burn){ enemy.burn--; const burn=Math.max(1,Math.round(enemy.hp*0.02)); enemy.hp-=burn; log(`${ENEMIES[enemy.key].name}受燃烧流失${burn}生命。`); }
  const dx=cs.hero.x-enemy.x, dy=cs.hero.y-enemy.y;
  enemy.facing=dirToFacing(dx,dy);
  const dist=Math.abs(dx)+Math.abs(dy);
  if(dist===1){
    const eDef=ENEMIES[enemy.key];
    let dmg=eDef.atk*eDef.skillMult;
    const shield=cs.hero.shield;
    if(shield>0){ const absorb=Math.min(shield,dmg); cs.hero.shield-=absorb; dmg-=absorb; }
    dmg=Math.max(1,Math.round(dmg));
    cs.hero.hp-=dmg;
    log(`${ENEMIES[enemy.key].name} 攻击你，造成 ${dmg} 点伤害。`);
    if(eDef.aura){ cs.hero.aura=eDef.aura; }
  } else {
    let nx=enemy.x, ny=enemy.y;
    if(Math.abs(dx)>Math.abs(dy)) nx += dx>0?1:-1; else ny += dy>0?1:-1;
    if(G.map.cells[ny*G.map.n+nx].terrain!=='obstacle' && !cs.enemies.some(e2=>e2!==enemy&&e2.x===nx&&e2.y===ny)){
      if(!(nx===cs.hero.x&&ny===cs.hero.y)){ enemy.x=nx; enemy.y=ny; log(`${ENEMIES[enemy.key].name} 逼近。`); }
    }
  }
  cs.hero.shield=0;
  checkCombatEnd();
}

/* 我方回合结束：敌人行动 → 重置回合状态 → 刷新界面 */
function endPlayerPhase(){
  const cs=combatState; if(!cs) return;
  if(cs.enemies.length===0){ return; }
  enemyTurn();
  if(!combatState) return;
  cs.hero.shield=0; cs.playerMoved=false; cs.heroUsedSkill=false; cs.playerOver=false;
  renderCombatMap(); updateCombatUI(); refreshHUD();
}

/* 刷新战斗 UI：状态 / 队友页签 / 技能列表 / 技能详情 */
function updateCombatUI(){
  if(!combatState){ $('#combatZone').classList.remove('active'); switchMode('story'); return; }
  const cs=combatState;
  prompt(
    `主角 生命 ${Math.round(cs.hero.hp)}/${Math.round(cs.hero.maxHp)}${cs.hero.shield>0?` 护盾${Math.round(cs.hero.shield)}`:''}<br>`+
    cs.enemies.map(en=>`<span style="color:${ENEMIES[en.key].color}">${ENEMIES[en.key].name}</span> 生命 ${Math.round(en.hp)}${en.aura?`（附着·${ELEM[en.aura].zh}）`:''}${cs.selectedEnemy===en?' <b>←目标</b>':''}<br>`).join('')+
    `<br><b>操作</b>：点选下方技能，再按 <b>Q</b> 释放；或先 <b>移动</b>（点击相邻格 / WASD），移动后会 自动攻击最近的敌人。`
  );
  $('#allyBar').innerHTML=G.team.map(t=>`<div class="allyTab ${t==='pro'?'active':''}" data-t="${t}">${t==='pro'?PROTAGONIST.name:''}</div>`).join('');
  $('#allyBar').querySelectorAll('.allyTab').forEach(b=>b.onclick=()=>selectAlly(b.dataset.t));
  const skills=PROTAGONIST.skills.filter(s=>PROTAGONIST.selectedSkillIds.includes(s.id));
  $('#skillList').innerHTML=skills.map(s=>`<div class="skillTag ${s.kind==='attack'?'attack':'skill'} ${cs.selectedSkillId===s.id?'active':''}" data-s="${s.id}" title="${s.desc}">${s.name}</div>`).join('');
  $('#skillList').querySelectorAll('.skillTag').forEach(b=>b.onclick=()=>{ cs.selectedSkillId=b.dataset.s; updateCombatUI(); });
  const cur=PROTAGONIST.skills.find(s=>s.id===cs.selectedSkillId);
  $('#skillDetail').innerHTML=(cur?`<b>${cur.name}</b>：${e(cur.desc)}`:'');
}
function selectAlly(key){ log('当前阶段：仅主角可操作。'); }

/* 战斗内键盘：WASD 移动 / Q 释放技能 */
document.addEventListener('keydown',ev=>{
  const k=ev.key.toLowerCase();
  if(combatState){
    if(k==='q'){ castSelectedSkill(); }
    if(k==='w'){ combatMove(0,-1); }
    if(k==='s'){ combatMove(0,1); }
    if(k==='a'){ combatMove(-1,0); }
    if(k==='d'){ combatMove(1,0); }
    return;
  }
  if(!G||!G.map) return;
  if(ev.repeat) return;
  let dx=0,dy=0;
  if(k==='w'){dy=-1;} else if(k==='s'){dy=1;} else if(k==='a'){dx=-1;} else if(k==='d'){dx=1;} else {return;}
  const nx=G.px+dx, ny=G.py+dy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n) return;
  moveExplore(nx,ny);
});

/* 战斗内 WASD 移动（移动即结束我方回合） */
function combatMove(dx,dy){
  const cs=combatState; if(!cs)return;
  if(cs.playerMoved) return;
  const nx=cs.hero.x+dx, ny=cs.hero.y+dy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n)return;
  const c=G.map.cells[ny*G.map.n+nx];
  if(c.terrain==='obstacle')return;
  if(cs.enemies.some(en=>en.x===nx&&en.y===ny))return;
  cs.hero.facing=dirToFacing(dx,dy);
  cs.hero.x=nx;cs.hero.y=ny; cs.playerMoved=true;
  autoCastHero();
  if(!combatState) return;
  renderCombatMap(); updateCombatUI(); refreshHUD();
  endPlayerPhase();
}

/* 战斗胜利：回传进入格、清空伏击敌人的残留、回探索模式 */
function endCombat(victory){
  const cs=combatState;
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey; G.hero.hp=Math.max(1,Math.round(cs.hero.hp||1));
  G.hero.facing='up';
  combatState=null;
  const e=G.map.cells[ey*G.map.n+ex];
  if(e.content&&e.content.type==='enemy'&&victory){ e.content={type:'empty'}; }
  switchMode('story');
  renderMap(); refreshHUD();
}

/* 战斗失败：health 扣减、hp 置 1、回安全处；health 归零则全局失败 */
function endCombatByDefeat(){
  const cs=combatState;
  const eDef=ENEMIES[cs.enemies[0].key];
  G.hero.health=Math.max(0,G.hero.health-(eDef.failureHealthPenalty||5));
  log(`战斗失败，健康值 -${eDef.failureHealthPenalty||5}。`);
  story('你败下阵来，狼狈退回安全处。');
  G.hero.hp=1;
  combatState=null;
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey;
  switchMode('story');
  renderMap(); refreshHUD();
  if(G.hero.health<=0){ showGameOver(); }
  else { alertDialog('战斗失败','你损失了部分健康。'); }
}