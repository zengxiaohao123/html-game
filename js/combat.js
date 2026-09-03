/* ============================================================
   js/combat.js —— 模块：战斗系统
   回合制战斗：入场、移动即结束我方回合、多角色技能释放、
   攻击朝向判定、伤害结算、元素附着/反应、敌人 AI、
   敌人朝向/范围指示、胜负与失败后果。
   ============================================================ */
"use strict";

/* 进入战斗：构建 combatState，并在主角旁生成一名敌人 */
function startCombat(cell){
  // 每个角色的默认选中技能 = 各自第一个携带技能
  const charSelSkill={}, charUsed={};
  for(const k of G.team){ const c=getChar(k); charSelSkill[k]=c.selectedSkillIds[0]; charUsed[k]=false; }
  combatState={
    hero:{x:G.px,y:G.py,facing:G.hero.facing,hp:G.hero.hp,maxHp:G.hero.maxHp,shield:0,auras:[]},
    enemies:[],
    playerMoved:false, playerOver:false,
    currentChar:G.team[0]||'pro',
    charSelSkill, charUsed,
    selectedEnemy:null, infoCell:null,
    entryCell:G.px+','+G.py,
    day:G.day
  };
  const epos=placeEnemyNear(G.px,G.py,G.map.n);
  combatState.enemies.push({
    x:epos.x, y:epos.y, facing:dirToFacing(G.px-epos.x, G.py-epos.y),
    def:ENEMIES[cell.content.key], key:cell.content.key, hp:cell.content.hp||ENEMIES[cell.content.key].hp,
    aura:ENEMIES[cell.content.key].aura||null, charge:0, shield:0
  });
  clearLog(); clearStory(); // 战斗开始时清空行动记录与剧情区
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
  $('#goBtn').style.display='none';
  updateCombatUI();
  refreshHUD();
  renderCombatMap();
}

/* 战斗地图渲染：主角 + 敌人(带朝向) + 障碍/地图外 + 范围指示 */
function renderCombatMap(){
  if(!combatState) return;
  const m=G.map; const grid=$('#mapGrid');
  grid.style.gridTemplateColumns=`repeat(${m.n},44px)`;
  grid.innerHTML='';
  const cs=combatState;
  // 选中技能的范围（浅橙色）
  const curChar=getChar(cs.currentChar);
  const selSkill=curChar.skills.find(s=>s.id===cs.charSelSkill[cs.currentChar]);
  const rangeKeys=new Set(selSkill?skillRangeCells(selSkill).map(c=>c.x+','+c.y):[]);
  // 敌人本回合要攻击时的攻击范围（浅红色）
  const enemyKeys=new Set();
  for(const en of cs.enemies){
    const dist=Math.abs(cs.hero.x-en.x)+Math.abs(cs.hero.y-en.y);
    if(dist===1){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=en.x+a,y=en.y+b; if(x>=0&&y>=0&&x<m.n&&y<m.n) enemyKeys.add(x+','+y); } }
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
        if(en.aura)cell.innerHTML+=`<div class="aura-tag">${ELEM[en.aura].zh}</div>`;
      }
    }
    cell.dataset.x=x;cell.dataset.y=y;
    cell.addEventListener('click',()=>combatCellClick(x,y));
    grid.appendChild(cell);
  }
}

/* 技能可作用的目标格子（也用于范围指示器） */
function skillRangeCells(skill){
  const pos=combatState.hero; const n=G.map.n;
  const [dx,dy]=facingDir(pos.facing);
  const out=[];
  if(skill.target==='front'){ const x=pos.x+dx,y=pos.y+dy; if(x>=0&&y>=0&&x<n&&y<n)out.push({x,y}); }
  else if(skill.target==='adj'){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=pos.x+a,y=pos.y+b; if(x>=0&&y>=0&&x<n&&y<n)out.push({x,y}); } }
  else if(skill.target==='frontline'){ for(let i=1;i<=skill.range;i++){ const x=pos.x+dx*i,y=pos.y+dy*i; if(x>=0&&y>=0&&x<n&&y<n)out.push({x,y}); } }
  else if(skill.target==='nearest'){ for(let x=0;x<n;x++)for(let y=0;y<n;y++) if(Math.abs(x-pos.x)+Math.abs(y-pos.y)<=skill.range) out.push({x,y}); }
  else { out.push({x:pos.x,y:pos.y}); }
  return out;
}
function facingDir(f){ return f==='up'?[0,-1]:f==='down'?[0,1]:f==='left'?[-1,0]:[1,0]; }
/* 技能范围内可命中的敌人列表 */
function skillEnemies(skill){
  const keys=new Set(skillRangeCells(skill).map(c=>c.x+','+c.y));
  return combatState.enemies.filter(en=>keys.has(en.x+','+en.y));
}
/* 该技能是否有可命中的目标（方向性技能必须方向上有敌人） */
function hasValidTarget(skill){
  if(!combatState) return false;
  if(skill.kind!=='attack') return true; // 辅助/增益类总是可释放
  return skillEnemies(skill).length>0;
}

/* 战斗内点击格子：查看信息 / 选目标 / 移动（含朝障碍转向） */
function combatCellClick(x,y){
  const cs=combatState; if(!cs) return;
  if(mapDragMoved) return;
  const c=G.map.cells[y*G.map.n+x];
  const enemy=cs.enemies.find(en=>en.x===x&&en.y===y);
  // 主角所在格：仅查看信息
  if(x===cs.hero.x&&y===cs.hero.y){ cs.infoCell={x,y}; updateCombatInfo(); renderCombatMap(); return; }
  // 敌人格（任意距离）：选为目标并查看信息
  if(enemy){ cs.selectedEnemy=enemy; cs.infoCell={x,y}; updateCombatInfo(); renderCombatMap(); return; }
  // 地图外：仅信息
  if(c.terrain==='void'){ cs.infoCell={x,y}; updateCombatInfo(); renderCombatMap(); return; }
  const dx=x-cs.hero.x, dy=y-cs.hero.y;
  // 非相邻：仅查看信息
  if(Math.abs(dx)+Math.abs(dy)!==1){ cs.infoCell={x,y}; updateCombatInfo(); renderCombatMap(); return; }
  if(cs.playerMoved){ return; }
  // 相邻且被障碍/敌人占据：转向但不移动，视为本回合已移动
  if(c.terrain==='obstacle' || cs.enemies.some(en=>en.x===x&&en.y===y)){
    cs.hero.facing=dirToFacing(dx,dy); cs.playerMoved=true;
    log('前方被阻挡，你只改变了朝向。');
    cs.infoCell={x,y};
    autoCastAll(); if(!combatState) return;
    endPlayerPhase(); return;
  }
  // 相邻空地：移动
  cs.hero.facing=dirToFacing(dx,dy);
  cs.hero.x=x; cs.hero.y=y; cs.playerMoved=true; cs.infoCell={x,y};
  autoCastAll(); if(!combatState) return;
  endPlayerPhase();
}

/* 战斗内 WASD 移动（移动即结束我方回合；朝障碍转向亦计为本回合已移动） */
function combatMove(dx,dy){
  const cs=combatState; if(!cs)return;
  if(cs.playerMoved) return;
  const nx=cs.hero.x+dx, ny=cs.hero.y+dy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n)return;
  const c=G.map.cells[ny*G.map.n+nx];
  if(c.terrain==='void')return;
  if(c.terrain==='obstacle' || cs.enemies.some(en=>en.x===nx&&en.y===ny)){
    cs.hero.facing=dirToFacing(dx,dy); cs.playerMoved=true;
    log('前方被阻挡，你只改变了朝向。');
    cs.infoCell={x:nx,y:ny};
    autoCastAll(); if(!combatState) return;
    endPlayerPhase(); return;
  }
  cs.hero.facing=dirToFacing(dx,dy);
  cs.hero.x=nx;cs.hero.y=ny; cs.playerMoved=true; cs.infoCell={x:nx,y:ny};
  autoCastAll(); if(!combatState) return;
  endPlayerPhase();
}

/* 选中技能：单击选中；再次点击同一技能=主动使用 */
function selectSkill(charKey, skillId){
  const cs=combatState; if(!cs) return;
  if(cs.charSelSkill[charKey]===skillId){
    castSkill(charKey, true);
  } else {
    cs.charSelSkill[charKey]=skillId;
    updateCombatUI(); renderCombatMap();
  }
}

/* 主动使用技能（Q 键 / 双击技能），必须在移动前 */
function castSkill(charKey, manual){
  const cs=combatState; if(!cs) return;
  if(cs.charUsed[charKey]) return;
  if(cs.playerMoved){ if(manual) prompt('本回合已移动，技能请于移动前使用。'); return; }
  const char=getChar(charKey);
  const skill=char.skills.find(s=>s.id===cs.charSelSkill[charKey]);
  if(!skill) return;
  if(!hasValidTarget(skill)){
    if(manual) prompt(`「${skill.name}」当前没有可以命中的目标。`);
    return; // 移动前主动使用失败：不视为使用技能
  }
  resolveSkill(charKey, skill, manual);
  if(!combatState) return;
  cs.charUsed[charKey]=true;
  updateCombatUI(); renderCombatMap();
}

/* 移动后自动释放所有尚未使用技能的角色（按队伍顺序） */
function autoCastAll(){
  if(!combatState) return;
  for(const k of G.team){ autoCastChar(k); if(!combatState) return; }
}
function autoCastChar(charKey){
  const cs=combatState; const char=getChar(charKey);
  if(cs.charUsed[charKey]) return;
  const skill=char.skills.find(s=>s.id===cs.charSelSkill[charKey]);
  if(!skill) return;
  if(!hasValidTarget(skill)){
    // 自动释放失败：不视为使用技能，该角色本回合跳过
    cs.charUsed[charKey]=true;
    log(`${char.name} 没有可命中的目标，本回合跳过不使用技能。`);
    return;
  }
  resolveSkill(charKey, skill, false);
  if(!combatState) return;
  cs.charUsed[charKey]=true;
}

/* 技能结算：算伤害、记录行动记录、处理副作用与元素、检查结束 */
function resolveSkill(charKey, skill, manual){
  if(!combatState) return;
  const char=getChar(charKey);
  if(skill.kind==='support'){ applySupport(char, skill); return; }
  let enemies=skillEnemies(skill);
  if(enemies.length===0) return;
  const enemy = combatState.selectedEnemy && enemies.includes(combatState.selectedEnemy) ? combatState.selectedEnemy : enemies[0];
  const base = charKey==='pro' ? G.hero.atk : (char.atk||0);
  let dmg = base * (1-(ENEMIES[enemy.key].dmgReduc||0)) * (skill.effect?skill.effect(1):1);
  dmg = Math.max(1, Math.round(dmg));
  log(`${char.name} 使用 <b>${skill.name}</b>，对${ENEMIES[enemy.key].name}造成 <b>${dmg}</b> 点伤害。`);
  applyEnemyDamage(enemy,dmg,skill);
  if(skill.burn){ enemy.burn=(enemy.burn||0)+skill.burn; log(`${ENEMIES[enemy.key].name} 进入【燃烧】状态。`); }
  if(skill.type!=='physical' && AURA_ELEMS.includes(skill.type)) setAura(enemy, skill.type);
  if(charKey==='pro'){
    if(skill.selfDrain){ const lost=Math.min(G.hero.hp, Math.floor(G.hero.maxHp*skill.selfDrain)); G.hero.hp-=lost; combatState.hero.hp=G.hero.hp; log(`自身流失${lost}生命。`); }
    if(skill.selfHeal){ G.hero.hp=Math.min(G.hero.maxHp,G.hero.hp+Math.floor(G.hero.maxHp*skill.selfHeal)); combatState.hero.hp=G.hero.hp; }
  }
  checkCombatEnd();
}

/* 辅助技能（简化占位） */
function applySupport(char, skill){
  if(skill.id==='guwu'){
    log(`${char.name} 施展「${skill.name}」，我方士气大振。`);
    if(combatState.hero.hp<G.hero.maxHp){
      const heal=Math.max(1, Math.round((char.atk||0)*0.15));
      combatState.hero.hp=Math.min(G.hero.maxHp, combatState.hero.hp+heal);
      log(`主角回复 ${heal} 点生命。`);
    }
  } else {
    log(`${char.name} 施展「${skill.name}」。`);
  }
  checkCombatEnd();
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
    endCombat(true);
    return;
  }
  if(combatState.hero.hp<=0){ endCombatByDefeat(); }
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
    cs.hero.hp-=dmg; G.hero.hp=cs.hero.hp;
    log(`${ENEMIES[enemy.key].name} 攻击你，造成 ${dmg} 点伤害。`);
    if(eDef.aura){ cs.hero.aura=eDef.aura; }
  } else {
    let nx=enemy.x, ny=enemy.y;
    if(Math.abs(dx)>Math.abs(dy)) nx += dx>0?1:-1; else ny += dy>0?1:-1;
    const inb=nx>=0&&ny>=0&&nx<G.map.n&&ny<G.map.n;
    if(inb && G.map.cells[ny*G.map.n+nx].terrain!=='obstacle' && G.map.cells[ny*G.map.n+nx].terrain!=='void' && !cs.enemies.some(e2=>e2!==enemy&&e2.x===nx&&e2.y===ny)){
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
  cs.hero.shield=0; cs.playerMoved=false; cs.playerOver=false;
  for(const k of G.team) cs.charUsed[k]=false;
  renderCombatMap(); updateCombatUI(); refreshHUD();
}

/* 刷新战斗 UI：角色卡 / 属性 / 技能 / 天赋 / 技能详情 / 信息区 */
function updateCombatUI(){
  if(!combatState){ switchMode('story'); return; }
  const cs=combatState;
  const chars=getTeamChars();
  const cur=chars.find(c=>c.key===cs.currentChar)||chars[0];
  // 角色卡（F1/F2/F3）
  $('#allyBar').innerHTML=chars.map((c,i)=>`<div class="allyCard ${c.key===cs.currentChar?'active':''}" data-k="${c.key}">
      <div class="allyName">${c.name}</div>
      <div class="allyElem">${c.element?ELEM[c.element].zh:'无属性'} · ${i+1}号位</div>
    </div>`).join('');
  $('#allyBar').querySelectorAll('.allyCard').forEach(b=>b.onclick=()=>{ cs.currentChar=b.dataset.k; updateCombatUI(); renderCombatMap(); });
  // 属性（队友缺的属性不展示）
  $('#charAttrs').innerHTML=charAttrsHTML(cur.key);
  // 技能（1/2/3）
  const skills=cur.skills.filter(s=>cur.selectedSkillIds.includes(s.id));
  $('#skillList').innerHTML=skills.map((s,i)=>`<div class="skillTag ${s.kind==='attack'?'attack':'skill'} ${cs.charSelSkill[cur.key]===s.id?'active':''}" data-s="${s.id}">
      <span class="skillNum">${i+1}</span>${s.name}${cs.charUsed[cur.key]?' <span class="usedMark">已用</span>':''}
    </div>`).join('');
  $('#skillList').querySelectorAll('.skillTag').forEach(b=>b.onclick=()=>selectSkill(cur.key, b.dataset.s));
  // 天赋（小标签，点击弹窗）
  $('#talentBox').innerHTML=`<span class="talentLabel">天赋</span>`+cur.passives.map((p,i)=>`<span class="talentTag" data-i="${i}">${p.name}</span>`).join('');
  $('#talentBox').querySelectorAll('.talentTag').forEach(b=>b.onclick=()=>showTalentPopup(cur.key,+b.dataset.i));
  // 选中技能详情（右侧）
  const sel=cur.skills.find(s=>s.id===cs.charSelSkill[cur.key]);
  $('#skillDetail').innerHTML= sel? `<div class="skillDetailName">${sel.name}</div><div class="skillDetailText">${e(sel.desc)}</div>` : '';
  updateCombatInfo();
}

/* 角色属性 HTML（队友缺少的属性不展示） */
function charAttrsHTML(key){
  if(key==='pro'){
    const h=G.hero;
    return `<span class="attr"><b>攻击</b> ${h.atk}</span>
      <span class="attr"><b>生命</b> ${Math.round(combatState.hero.hp)}/${h.maxHp}</span>
      <span class="attr"><b>防御</b> ${h.def}</span>
      <span class="attr"><b>逃跑速度</b> ${h.escapeSpeed}</span>
      <span class="attr"><b>健康</b> ${h.health}</span>
      <span class="attr"><b>行动力上限</b> ${h.apCap}</span>`;
  }
  const c=getChar(key);
  return `<span class="attr"><b>攻击</b> ${c.atk}</span>
    <span class="attr"><b>属性</b> ${c.element?ELEM[c.element].zh:'无'}</span>`;
}

/* 天赋弹窗 */
function showTalentPopup(charKey, i){
  const c=getChar(charKey);
  const t=c.passives[i];
  if(!t) return;
  alertDialog(`${c.name} · 天赋「${t.name}」`, t.desc);
}

/* 信息区：显示被选中格位上的单位信息（战斗） */
function updateCombatInfo(){
  const cs=combatState; if(!cs) return;
  if(!cs.infoCell) cs.infoCell={x:cs.hero.x,y:cs.hero.y};
  const {x,y}=cs.infoCell;
  if(x===cs.hero.x&&y===cs.hero.y){
    prompt(`<b>主角</b><br>攻击 ${G.hero.atk}<br>防御 ${G.hero.def}<br>生命 ${Math.round(cs.hero.hp)}/${G.hero.maxHp}${cs.hero.shield?`<br>护盾 ${Math.round(cs.hero.shield)}`:''}`);
    return;
  }
  const en=cs.enemies.find(en=>en.x===x&&en.y===y);
  if(en){
    prompt(`<b>${ENEMIES[en.key].name}</b><br>攻击 ${ENEMIES[en.key].atk}<br>生命 ${Math.round(en.hp)}/${ENEMIES[en.key].hp}${en.aura?`<br>附着 ${ELEM[en.aura].zh}`:''}${cs.selectedEnemy===en?'<br><span style="color:var(--gold)">← 目标</span>':''}`);
    return;
  }
  prompt('该格位空无一物。');
}

/* 战斗内键盘：WASD 移动 / Q 释放当前角色技能 / 1-2-3 选技能 / F1-F2-F3 切角色 */
document.addEventListener('keydown',ev=>{
  if(!combatState){
    if(!G||!G.map) return;
    if(ev.repeat) return;
    let dx=0,dy=0;
    const k=ev.key.toLowerCase();
    if(k==='w'){dy=-1;} else if(k==='s'){dy=1;} else if(k==='a'){dx=-1;} else if(k==='d'){dx=1;} else {return;}
    const nx=G.px+dx, ny=G.py+dy;
    if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n) return;
    moveExplore(nx,ny);
    return;
  }
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
});

/* 战斗胜利：回传进入格、清空伏击敌人残留、回探索模式 */
function endCombat(victory){
  const cs=combatState;
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey; G.hero.hp=Math.max(1,Math.round(cs.hero.hp||1));
  G.hero.facing='up';
  combatState=null;
  clearLog(); // 战斗结束时清空行动记录
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
  G.hero.hp=1;
  combatState=null;
  clearLog(); // 战斗结束时清空行动记录
  const [ex,ey]=cs.entryCell.split(',').map(Number);
  G.px=ex; G.py=ey;
  switchMode('story');
  renderMap(); refreshHUD();
  if(G.hero.health<=0){ showGameOver(); }
  else { alertDialog('战斗失败','你损失了部分健康。'); }
}