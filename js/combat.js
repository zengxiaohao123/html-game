/* ============================================================
   js/combat.js —— 模块：战斗系统
   回合制战斗：入场、移动即结束我方回合、多角色技能释放、
   敌人回合=移动+技能（一回合内可两者皆用）、状态系统、
   编队人数加成、逃跑系统、元素亲和/反应、战斗奖励结算。
   ============================================================ */
"use strict";
function addStatus(statuses, id, turns, layers){ if(!statuses) return; const meta=statusMeta(id); const cur=statuses[id]; const newLayers=(cur&&layers!=null)? (cur.layers||0)+layers : (layers||0); const newTurns=(turns!=null?turns : (cur? cur.turns : null)); statuses[id]={ id, name:meta.name, kind:meta.kind, turns:newTurns, desc:meta.desc, layers:newLayers }; }
function tickStatuses(statuses){ if(!statuses) return; for(const id of Object.keys(statuses)){ const s=statuses[id]; if(s.turns!=null){ s.turns--; if(s.turns<=0) delete statuses[id]; } } }
function statusArr(statuses){ return Object.values(statuses||{}); }
function hasStatus(statuses,id){ return !!(statuses&&statuses[id]); }
function enemyNode(){ return combatState&&combatState.enemies[0]; }
function lastLogLine(){ try{ const els=document.querySelectorAll('#logBody .logline'); const last=els[els.length-1]; return last? last.textContent : ''; }catch(e){ return ''; } }

function hasP(e,id){ return !!(e&&e.def&&e.def.passives&&e.def.passives.some(p=>p.id===id)); }
function hasSkill(e,id){ return !!(e&&e.def&&e.def.skills&&e.def.skills.some(s=>s.id===id)); }
function heroAt(x,y){ return !!(combatState&&combatState.hero.x===x&&combatState.hero.y===y); }
function distCheb(a,b){ return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); }
function rBuffs(){ if(!G.records) G.records={}; if(!G.records.buffs) G.records.buffs={}; return G.records.buffs; }
function onEnemyDefeated(enemy){ if(!enemy) return; if(hasP(enemy,'comeback')){ rBuffs()['chunibyo']=Math.min(5,(rBuffs()['chunibyo']||0)+1); } if(hasP(enemy,'rare') && G.records){ delete G.records.rareBearHp; } }
function persistRare(enemies, wasDefeated){ if(!enemies) return; const b=enemies.find(e=>hasP(e,'rare')); if(!b) return; if(!G.records) G.records={}; if(wasDefeated){ delete G.records.rareBearHp; } else { G.records.rareBearHp=Math.max(1,Math.round(b.hp)); } }
function applyBurnTick(node,who){
  if(!node||!node.statuses) return; if(!node.statuses.burn) return;
  const maxHp = who==='hero' ? (G?G.hero.maxHp:100) : node.maxHp;
  const lost = Math.max(1, Math.round(maxHp*0.02));
  if(who==='hero'){ const nx=Math.max(0,(G.hero.hp||0)-lost); G.hero.hp=nx; if(combatState) combatState.hero.hp=nx; log(`【燃烧】流失 ${lost} 点生命。`); }
  else { node.hp=Math.max(0,node.hp-lost); log(`${node.name} 受【燃烧】流失 ${lost} 点生命。`); if(node.hp<=0 && combatState){ node.hp=0; log(`${node.name} 被【燃烧】击败。`); removeEnemy(node); checkCombatEnd(); } }
}
function poisonHero(layers){ if(!combatState) return; addStatus(combatState.ally.pro.statuses,'poison',null,layers); }
function dmgEnemy(enemy,dmg,type){ if(!enemy) return 0; if(type && AFFIN_IMMUNE[enemy.key]===type){ return 0; } enemy.hp-=dmg; return dmg; }
function dmgHeroFlat(dmg,type){ return damageHero(dmg,type); }
function anyEnemy(){ return combatState.enemies.length? combatState.enemies[0] : null; }
function elemText(type){ if(type==='physical') return '物理伤害'; if(type==='real'||type==='true') return '真实伤害'; if(ELEM[type]) return `<span class="${ELEM[type].c}">${ELEM[type].zh}元素伤害</span>`; return '伤害'; }
const AFFIN_IMMUNE={slime:'grass',fireSlime:'fire',waterSlime:'water',thunderSlime:'thunder',iceSlime:'ice',windSlime:'wind',rockSlime:'rock'};
function teamSizeBonus(){ const t=(G&&G.team&&G.team.length)||3; const atkMult = t>=3?1.30 : t===2?1.15 : 1.00; const hpMult  = t>=3?1.40 : t===2?1.20 : 1.00; return {atkMult, hpMult}; }
function startCombat(cell){ const key=cell.content.key; initCombatState({ enemyKey:key }); clearLog(); clearStory(); log('进入战斗。你得击败所有敌人。'); enterCombatMode(); }
function initCombatState(o){
  const ally={}; for(const k of G.team){ const c=getChar(k); ally[k]={statuses:{}, used:false, selSkill:c.selectedSkillIds[0], cds:{}, flatAtk:0, flatAtkTurns:0}; }
  combatState={ hero:{x:G.px,y:G.py,facing:G.hero.facing,hp:G.hero.hp,maxHp:G.hero.maxHp,shield:0,auras:[]}, enemies:[], ally, field:{},
    playerMoved:false, playerOver:false, currentChar:G.team[0]||'pro', selectedEnemy:null, infoCell:null, enemyPage:0, pendingTarget:null,
    entryCell:G.px+','+G.py, day:G.day, turn:1, bubbles:[], focusEnemy:null, defeated:[],
    startSnapshot:{ heroHp:G.hero.hp, vehicles:JSON.parse(JSON.stringify(G.vehicles||[])), vehicleSel:G.vehicleSel!=null?G.vehicleSel:0, enemyKey:o.enemyKey } };
  const e=spawnEnemy(o.enemyKey); combatState.enemies.push(e);
  refreshHeroShield(); afterSpawnEnemy(e);
}
function spawnEnemy(key){
  const def=ENEMIES[key]; const b=teamSizeBonus();
  let atk=def.atk*b.atkMult, maxHp=Math.floor(def.maxHp*b.hpMult), defv=def.def||0;
  let speed=def.speed||0;
  if(def.passives&&def.passives.find(p=>p.id==='newbie') && G.day<13){ maxHp=Math.max(1, maxHp-60); }
  if(def.passives&&def.passives.find(p=>p.id==='rockshield')){ maxHp=Math.floor(maxHp*0.9); defv+=10; }
  if(def.passives&&def.passives.find(p=>p.id==='comeback')){ const cnt=Math.min(5, rBuffs()['chunibyo']||0); if(cnt){ atk+=15*cnt; maxHp+=40*cnt; speed+=5*cnt; } }
  const growthP=def.passives&&(def.passives.find(p=>p.id==='growth')||def.passives.find(p=>p.id==='growth2'));
  if(growthP){ const isPro=!!def.passives.find(p=>p.id==='growth2'); const days=Math.max(0,(G.day||1)-1); const cap=isPro?20:Infinity; const n=Math.min(cap,days); if(n>0){ atk*=1+((isPro?0.08:0.05)*n); maxHp=Math.floor(maxHp*(1+((isPro?0.10:0.05)*n))); speed+=n; } }
  let hpSet=null; if(def.passives&&def.passives.find(p=>p.id==='rare')){ const prev=(G.records&&G.records.rareBearHp)||0; if(prev>0) hpSet=Math.min(maxHp, Math.round(prev)); }
  const pos=randomEmptyCell();
  const e={ key, def, name:def.name, icon:def.icon, tier:def.tier, x:pos.x, y:pos.y, facing:dirToFacing(G.px-pos.x, G.py-pos.y),
    atk, maxHp, baseAtkAtSpawn:atk, hp: hpSet!=null? hpSet : maxHp, defv:defv, speed, res:def.res||{}, healthPenalty:def.healthPenalty||0,
    statuses:{}, cooldowns:{}, sustain:-1, attacks:0, chargingSkill:null, aura: (key==='slime')?'grass':(AFFIN_IMMUNE[key] || null) };
  return e;
}
function randomEmptyCell(){ const m=G.map; const cand=[]; for(let y=0;y<m.n;y++)for(let x=0;x<m.n;x++){ if(x===G.px&&y===G.py) continue; if(combatState&&combatState.enemies.some(en=>en.x===x&&en.y===y)) continue; if(m.cells[y*m.n+x].terrain==='ground') cand.push({x,y}); } return cand.length? cand[Math.floor(Math.random()*cand.length)] : {x:G.px,y:G.py}; }
function afterSpawnEnemy(e){
  const cs=combatState; if(!cs) return;
  if(e.def&&e.def.passives&&e.def.passives.find(p=>p.id==='swarm')){
    combatState.enemies=[]; const pool=[ENEMIES.slime,ENEMIES.fireSlime,ENEMIES.waterSlime,ENEMIES.thunderSlime,ENEMIES.iceSlime,ENEMIES.windSlime,ENEMIES.rockSlime];
    for(let i=0;i<3;i++){ const k=pool[Math.floor(Math.random()*pool.length)]; const sub=spawnEnemy(k.key?k.key:Object.keys(ENEMIES).find(x=>ENEMIES[x]===k)); sub.maxHp=Math.floor(sub.maxHp*0.8); sub.hp=sub.maxHp; sub.fromSwarm=true; combatState.enemies.push(sub); }
    log('史莱姆集群四散，冲出3只史莱姆！'); return;
  }
  if(hasP(e,'hiber')) addStatus(e.statuses,'sleep',3);
  if(hasP(e,'scare')){
    addStatus(cs.ally.pro.statuses,'bind',1);
    const p=placeEnemyNearHero(e); if(p){ e.x=p.x; e.y=p.y; }
    log(`${e.name} 的恐吓让你被【束缚】，它瞬移到你身边！`);
  }
  if(hasP(e,'dogpal')||hasP(e,'dogpal2')) spawnHoundPack(e);
}
function placeEnemyNearHero(enemy){
  const cs=combatState; if(!cs) return null;
  const cand=[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>({x:cs.hero.x+a,y:cs.hero.y+b})).filter(p=>p.x>=0&&p.y>=0&&p.x<G.map.n&&p.y<G.map.n&&G.map.cells[p.y*G.map.n+p.x].terrain==='ground'&&!(p.x===enemy.x&&p.y===enemy.y)&&!combatState.enemies.some(o=>o!==enemy&&o.x===p.x&&o.y===p.y));
  return cand.length? cand[Math.floor(Math.random()*cand.length)] : null;
}
function spawnHoundPack(e){
  const cs=combatState; if(!cs) return;
  let n=0;
  if(hasP(e,'dogpal')){ const r=Math.random(); n = r<0.80?1 : r<0.95?2 : 3; }
  else if(hasP(e,'dogpal2')){ n = Math.random()<0.80?1:0; }
  if(n<1) return;
  for(let i=0;i<n;i++){
    const subKey = hasP(e,'dogpal2') ? (Math.random()<0.80?'hound':'houndPro') : 'hound';
    if(combatState.enemies.length>=8) break;
    const sub=spawnEnemy(subKey); sub.fromPack=true;
    combatState.enemies.push(sub);
    log(`${e.name} 的狗友招来了一只${sub.name}！`);
  }
}
function reenterCombat(snap){ if(!snap || !G.map){ switchMode('story'); return; } initCombatState({ enemyKey:snap.enemyKey }); clearLog(); clearStory(); log('读档回到本次战斗开始。你得击败所有敌人。'); enterCombatMode(); }
function enterCombatMode(){ switchMode('combat'); $('#goBtn').style.display='none'; updateCombatUI(); refreshHUD(); renderCombatMap(); renderIconbar(); ensureKeyFocus(); }
function renderCombatMap(){
  if(!combatState) return; const m=G.map; const grid=$('#mapGrid'); grid.style.gridTemplateColumns=`repeat(${m.n},44px)`; grid.innerHTML='';
  const cs=combatState; const curChar=getChar(cs.currentChar); const selSkill=curChar.skills.find(s=>s.id===cs.ally[cs.currentChar].selSkill);
  const rangeKeys=new Set(selSkill&&selSkill.kind==='attack'?skillRangeCells(selSkill).map(c=>c.x+','+c.y):[]);
  const selEnemy = focusedEnemy() || (cs.infoCell ? cs.enemies.find(en=>en.x===cs.infoCell.x&&en.y===cs.infoCell.y) : null);
  const enemyKeys = selEnemy ? enemyRangeKeys(selEnemy) : new Set();
  for(let y=0;y<m.n;y++)for(let x=0;x<m.n;x++){ const c=m.cells[y*m.n+x]; const cell=el('<div class="cell"></div>'); if(c.terrain==='obstacle')cell.classList.add('obstacle'); else if(c.terrain==='void')cell.classList.add('void'); const key=x+','+y; if(enemyKeys.has(key)) cell.classList.add('range-enemy'); else if(rangeKeys.has(key)) cell.classList.add('range-ally'); if(cs.hero.x===x&&cs.hero.y===y){cell.classList.add('player');cell.classList.add('facing-'+cs.hero.facing);} for(const en of cs.enemies){ if(en.x===x&&en.y===y){ cell.textContent=en.icon; cell.style.color='#fff'; cell.classList.add('efacing-'+en.facing); cell.title=en.name; if(en.maxHp>0) cell.innerHTML+=`<div class="hpbar"><i style="width:${Math.max(0,en.hp)/en.maxHp*100}%"></i></div>`; } } cell.dataset.x=x;cell.dataset.y=y; cell.addEventListener('click',()=>combatCellClick(x,y)); grid.appendChild(cell); }
}
function passable(x,y){ const n=G.map.n; if(x<0||y<0||x>=n||y>=n) return false; return G.map.cells[y*n+x].terrain==='ground'; }
function enemyRangeKeys(en){ const set=new Set(); const cs=combatState; const sk=(en.plan&&en.plan.skill)||en.def.skills.find(s=>s.kind!=='move'); if(!sk) return set; const [dx,dy]=facingDir(en.facing); const add=(x,y)=>{ if(passable(x,y)) set.add(x+','+y); }; if(sk.teleport){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) add(en.x+a,en.y+b); } else if(sk.id==='waterbubble'){ const t=cs.turnStartHero||cs.hero; add(t.x,t.y); } else if(sk.target==='line'||sk.target==='line-multi'){ for(let s=1;s<=3;s++){ if(!passable(en.x+dx*s,en.y+dy*s)) break; add(en.x+dx*s,en.y+dy*s); } } else if(sk.target==='front'){ add(en.x+dx,en.y+dy); } else if(sk.target==='adj'||sk.target==='self-area4'){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) add(en.x+a,en.y+b); } return set; }
function facingDir(f){ return f==='up'?[0,-1]:f==='down'?[0,1]:f==='left'?[-1,0]:[1,0]; }
function dirToFacing(dx,dy){ if(dx>0)return 'right'; if(dx<0)return 'left'; if(dy>0)return 'down'; return 'up'; }
function dist(a,b){ return Math.abs(a.x-b.x)+Math.abs(a.y-b.y); }
function charBaseAtk(charKey){ if(charKey==='pro') return G.hero.atk; const b=(G&&G.bonds&&G.bonds[charKey]); const lv=b?(b.level||1):1; return 35 + 10*lv; }
function charAtk(charKey){ const c=getChar(charKey); const base=charBaseAtk(charKey); let a=base; for(const p of c.passives){ if(p.scal && p.scal.atk){ a += tierValue(p, entryLevel(charKey,p), 'atk'); } } if(combatState&&combatState.ally[charKey]){ const sts=combatState.ally[charKey].statuses; if(sts.atkUp) a+=Math.round(base*0.25); a += (combatState.ally[charKey].flatAtk||0); } return a; }
function baseCritRate(charKey){ const c=getChar(charKey); let crit=0; const pick=charKey==='pro'? c.passives.find(p=>p.id==='crit') : (charKey==='luyouyou'? c.passives.find(p=>p.id==='wind'):null); if(pick&&pick.scal&&pick.scal.crit) crit+=tierValue(pick,entryLevel(charKey,pick),'crit'); return crit; }
function charCritRate(charKey){ let r=baseCritRate(charKey); const sts=combatState&&combatState.ally[charKey]&&combatState.ally[charKey].statuses; if(sts&&sts.crit) r+=100; return Math.max(0,Math.min(100,r)); }
function totalHeroDefense(){ let d=G.hero.def||0; const pro=getChar('pro'); const hold=pro.passives.find(p=>p.id==='hold'); if(hold) d+=tierValue(hold,entryLevel('pro',hold),'def'); return Math.max(0,Math.min(99999,d)); }
function heroTalentAtk(){ const pro=getChar('pro'); let a=0; for(const p of pro.passives){ if(p.scal&&p.scal.atk) a+=tierValue(p,entryLevel('pro',p),'atk'); } for(const k in ALLIES){ for(const p of (ALLIES[k].passives||[])){ if(p.scal&&p.scal.pro) a+=tierValue(p,entryLevel(k,p),'pro'); } } return a; }
function heroTalentDef(){ const pro=getChar('pro'); const h=pro.passives.find(p=>p.id==='hold'); return (h&&h.scal&&h.scal.def)?tierValue(h,entryLevel('pro',h),'def'):0; }
function heroTalentMaxHp(){ const pro=getChar('pro'); let m=0; for(const p of pro.passives){ if(p.scal&&p.scal.hp) m+=tierValue(p,entryLevel('pro',p),'hp'); } if(G&&G.team&&G.team.indexOf('luyouyou')>=0) m+=100; return m; }
function heroDisplayAtk(){ return (G.hero.atk||0)+heroTalentAtk(); }
function heroDisplayDef(){ return (G.hero.def||0)+heroTalentDef(); }
function heroDisplayMaxHp(){ return (G.hero.maxHp||0)+heroTalentMaxHp(); }
function refreshHeroShield(){ if(combatState) combatState.hero.shield=totalHeroDefense(); }
function calcEscapeRate(enemy){ if(!enemy||!enemy.maxHp) return 0; const ratio=Math.max(0,enemy.hp)/enemy.maxHp; const rate=((G.hero.escapeSpeed||100) - enemy.speed*ratio)/100; return Math.max(0, Math.min(100, rate*100)); }
function skillRangeCells(skill){ const pos=combatState.hero; const n=G.map.n; const [dx,dy]=facingDir(pos.facing); const out=[]; if(skill.target==='front'){ const x=pos.x+dx,y=pos.y+dy; if(passable(x,y))out.push({x,y}); } else if(skill.target==='adj'){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=pos.x+a,y=pos.y+b; if(passable(x,y))out.push({x,y}); } } else if(skill.target==='frontline'){ for(let i=1;i<=skill.range;i++){ const x=pos.x+dx*i,y=pos.y+dy*i; if(passable(x,y))out.push({x,y}); } } else if(skill.target==='nearest'){ for(let x=0;x<n;x++)for(let y=0;y<n;y++) if(passable(x,y)&&Math.abs(x-pos.x)+Math.abs(y-pos.y)<=skill.range) out.push({x,y}); } else out.push({x:pos.x,y:pos.y}); return out; }
function skillEnemies(skill){ const keys=new Set(skillRangeCells(skill).map(c=>c.x+','+c.y)); return combatState.enemies.filter(en=>keys.has(en.x+','+en.y)); }
function hasValidTarget(skill){ if(!combatState) return false; if(skill.kind!=='attack') return true; return skillEnemies(skill).length>0; }
function applyEnemyDamage(enemy,dmg,skill,type){ if(type && skill && skill.type && AFFIN_IMMUNE[enemy.key]===skill.type){ return {dmg:0,immune:true}; } enemy.hp-=dmg; return {dmg, immune:false}; }
function damageEnemy(enemy, dmg, type){ if(enemy.def && enemy.def.passives && enemy.def.passives.find(p=>p.id==='rockshield')){ enemy.defv=Math.max(0,Math.min(99999,(enemy.defv||0)-1)); } /* 帅气闪避 */ if(enemy.def&&enemy.def.passives&&enemy.def.passives.find(p=>p.id==='dodge')&&Math.random()<0.20){ log(`${enemy.name} 帅气闪避，躲过了本次攻击！`); return 0; } if(type && AFFIN_IMMUNE[enemy.key]===type) return 0; enemy.hp-=dmg; if(hasStatus(enemy.statuses,'sleep') && dmg>0){ delete enemy.statuses.sleep; if(hasP(enemy,'hiber')) enemy.justWoke=true; log(`${enemy.name} 被击醒！`); } if(dmg>0 && hasP(enemy,'counter')){ const rd=Math.max(1,Math.round(enemy.atk*0.4)); if(combatState){ damageHero(rd,'true'); log(`${enemy.name} 反击！造成 ${rd} 点${elemText('true')}。`); } if(!enemy.counterMult) enemy.counterMult=1.0; if(enemy.counterMult<2.5){ enemy.counterMult=Math.min(2.5,enemy.counterMult+0.15); enemy.atk=Math.round((enemy.baseAtkAtSpawn||enemy.atk)*enemy.counterMult); } } if(enemy.hp<=0){ enemy.hp=0; log(`${enemy.name} 被击败！`); onEnemyDefeated(enemy); removeEnemy(enemy); checkCombatEnd(); } return dmg; }
function reapplyAura(enemy){ if(!enemy) return; const aff=AFFIN_IMMUNE[enemy.key]; if(aff) enemy.aura=aff; }
function skillDamagePreview(charKey, skill){ if(!skill||!skill.effect) return null; return Math.max(1,Math.round(charAtk(charKey)*skill.effect(1))); }
function describeSkill(charKey, skill){ if(!skill) return ''; let d=skill.desc||''; const dmg=skillDamagePreview(charKey, skill); if(skill.scal){ const level=entryLevel(charKey,skill); const ext={}; if(dmg!=null&&skill.formula) ext.DMG=`${skill.formula}（当前约${dmg}点）`; const hp=healPreview(charKey,skill); if(hp) ext.Y=hp; d=lvDescText(skill,level,ext); } else { if(dmg!=null&&skill.formula) d=d.replace(/\{DMG\}/g,`${skill.formula}（当前约${dmg}点）`); if(skill.healPct) d=d.replace(/\{Y\}/g,Math.round((getChar(charKey).atk||0)*skill.healPct)); } return terms(d); }
function healPreview(charKey, skill){ if(skill&&skill.id==='guwu'){ const lv=entryLevel(charKey,skill); const he=vTier(skill,'heal',lv); return Math.round((getChar(charKey).atk||0)*he/100); } if(skill&&skill.healPct) return Math.round((getChar(charKey).atk||0)*skill.healPct); return 0; }
function vTier(entry,key,level){ return (entry&&entry.scal&&entry.scal[key])?tierValue(entry,level,key):0; }
function focusedEnemy(){ if(!combatState) return null; return (combatState.focusEnemy && combatState.enemies.indexOf(combatState.focusEnemy)>=0) ? combatState.focusEnemy : null; }
function combatCellClick(x,y){ const cs=combatState; if(!cs) return; if(mapDragMoved) return; cs.infoCell={x,y}; cs.pendingTarget={x,y}; const enemy=cs.enemies.find(en=>en.x===x&&en.y===y); cs.focusEnemy = enemy || null; if(enemy){ cs.selectedEnemy=enemy; cs.enemyPage=0; } updateCombatInfo(); bindCombatGo(x,y); renderCombatMap(); }
function bindCombatGo(x,y){ const cs=combatState; const go=$('#goBtn'); const dx=x-cs.hero.x, dy=y-cs.hero.y; if(cs.playerMoved||Math.abs(dx)+Math.abs(dy)!==1){ go.style.display='none'; return; } go.style.display='block'; go.disabled=false; go.onclick=confirmCombatMove; }
function confirmCombatMove(){ const cs=combatState; if(!cs) return; if(cs.playerMoved||!cs.pendingTarget) return; const {x,y}=cs.pendingTarget; const dx=x-cs.hero.x, dy=y-cs.hero.y; if(Math.abs(dx)+Math.abs(dy)!==1){ log('只能移动到相邻一格。'); $('#goBtn').style.display='none'; return; } $('#goBtn').style.display='none'; const bindS=hasStatus(cs.ally.pro.statuses,'bind'); if(!bindS) cs.hero.facing=dirToFacing(dx,dy); const bound=bindS||hasStatus(cs.ally.pro.statuses,'cage'); const moved=!bound && (G.map.cells[y*G.map.n+x].terrain==='ground' && !cs.enemies.some(en=>en.x===x&&en.y===y)); if(moved){ cs.hero.x=x; cs.hero.y=y; useVehicleOnMove(); } else if(bindS){ log('【束缚】使你无法真正移动，也不改变朝向。'); } else if(hasStatus(cs.ally.pro.statuses,'cage')){ log('【禁锢】使你无法真正移动。'); } else { log('前方有阻挡，你只改变了朝向。'); } cs.playerMoved=true; autoCastAll(); if(!combatState) return; endPlayerPhase(); }
function combatMove(dx,dy){ const cs=combatState; if(!cs)return; if(cs.playerMoved) return; const bindS=hasStatus(cs.ally.pro.statuses,'bind'); if(!bindS) cs.hero.facing=dirToFacing(dx,dy); const nx=cs.hero.x+dx, ny=cs.hero.y+dy; if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n){ log('已到地图边缘。'); cs.playerMoved=true; cs.infoCell={x:cs.hero.x,y:cs.hero.y}; cs.pendingTarget=null; autoCastAll(); if(!combatState) return; endPlayerPhase(); return; } const bound=bindS||hasStatus(cs.ally.pro.statuses,'cage'); const moved=!bound && (G.map.cells[ny*G.map.n+nx].terrain==='ground' && !cs.enemies.some(en=>en.x===nx&&en.y===ny)); if(moved){ cs.hero.x=nx; cs.hero.y=ny; useVehicleOnMove(); } else if(bindS){ log('【束缚】使你无法真正移动，也不改变朝向。'); } else if(hasStatus(cs.ally.pro.statuses,'cage')){ log('【禁锢】使你无法真正移动。'); } else { log('前方有阻挡，你只改变了朝向。'); } cs.playerMoved=true; cs.infoCell={x:cs.hero.x,y:cs.hero.y}; cs.pendingTarget=null; autoCastAll(); if(!combatState) return; endPlayerPhase(); }
function selectSkill(charKey, skillId){ const cs=combatState; if(!cs) return; if(skillId==='flee'){ if(cs.ally[charKey].selSkill==='flee'){ tryFlee(); return; } cs.ally[charKey].selSkill='flee'; updateCombatUI(); renderCombatMap(); return; } if(cs.ally[charKey].selSkill===skillId){ castSkill(charKey,true); } else { cs.ally[charKey].selSkill=skillId; updateCombatUI(); renderCombatMap(); } }
function castSkill(charKey, manual){ const cs=combatState; if(!cs) return; if(cs.ally[charKey].used) return; if(cs.playerMoved){ if(manual) prompt('本回合已移动，技能请于移动前使用。'); return; } const char=getChar(charKey); const skill=char.skills.find(s=>s.id===cs.ally[charKey].selSkill); if(!skill) return; if(skill.cd && cs.ally[charKey].cds[skill.id]>0){ if(manual) prompt(`「${skill.name}」仍在冷却中（剩 ${cs.ally[charKey].cds[skill.id]} 回合）。`); return; } if(!hasValidTarget(skill)){ if(manual) prompt(`「${skill.name}」当前没有可以命中的目标。`); return; } resolveSkill(charKey,skill,manual); if(!combatState) return; cs.ally[charKey].used=true; updateCombatUI(); renderCombatMap(); }
function autoCastAll(){ if(!combatState) return; for(const k of G.team){ autoCastChar(k); if(!combatState) return; } }
function autoCastChar(charKey){ const cs=combatState; const char=getChar(charKey); if(cs.ally[charKey].used) return; const skill=char.skills.find(s=>s.id===cs.ally[charKey].selSkill); if(!skill) return; if(!hasValidTarget(skill)){ cs.ally[charKey].used=true; log(`${char.name} 没有可命中的目标，本回合跳过不使用技能。`); return; } resolveSkill(charKey,skill,false); if(!combatState) return; cs.ally[charKey].used=true; }
function combatHemResist(enemy, t){ return (ENEMIES[enemy.key].res&&ENEMIES[enemy.key].res[t])||0; }
function resolveSkill(charKey, skill, manual){
  if(!combatState) return; const char=getChar(charKey);
  if(skill.kind==='support'){ applySupport(charKey,skill); return; }
  const pool=skillEnemies(skill); if(!pool.length) return;
  let targets=[];
  if(skill.multTarget){ const arr=pool.slice(); const n=Math.min(skill.multTarget, arr.length); for(let i=0;i<n;i++){ targets.push(arr.splice(Math.floor(Math.random()*arr.length),1)[0]); } }
  else if(skill.burstBias){ targets=[ pool.find(e=>e.chargingSkill) || pool.find(e=>hasStatus(e.statuses,'alert')) || pool[Math.floor(Math.random()*pool.length)] ]; }
  else if(skill.randTarget){ targets=[ pool[Math.floor(Math.random()*pool.length)] ]; }
  else { targets=pool.slice(); }
  let effBase=charAtk(charKey);
  if(skill.stealAtk){ let st=0; for(const k of G.team){ if(k===charKey) continue; st+=Math.round(charAtk(k)*skill.stealAtk); } effBase+=st; log(`${char.name} 偷取了队友 ${st} 点攻击力（本技能生效）。`); }
  const mom=(combatState.ally[charKey]&&combatState.ally[charKey].mom)||0;
  const forceCrit = !!skill.burstBias && targets[0] && targets[0].chargingSkill;
  const critThis = forceCrit ? true : (Math.random()*100 < charCritRate(charKey));
  let finalType=skill.type;
  if(charKey==='luyouyou' && critThis && finalType==='physical') finalType='wind';
  if(forceCrit) log(`${targets[0].name} 正处于【蓄力】，本次攻击必定暴击！`);
  let hitAny=false;
  for(const enemy of targets){
    if(!combatState || !combatState.enemies.includes(enemy)) continue;
    let dmg=Math.max(1,Math.round(effBase*(1-combatHemResist(enemy,finalType)/100)*(skill.effect?skill.effect(1):1)*(1+mom/100)));
    if(critThis) dmg*=2;
    const critTxt=critThis&&!forceCrit?'<span class="crit-hint">暴击！</span>':'<span class="crit-hint">暴击！</span>';
    const dm=damageEnemy(enemy,dmg,finalType,true);
    if(combatState && dm!==0){ hitAny=true; log(`${char.name} 使用 <b>${skill.name}</b>，对${enemy.name}造成 ${critTxt}<b>${Math.max(1,Math.round(dmg*(1-(AFFIN_IMMUNE[enemy.key]===finalType?1:0))))}</b> 点${elemText(finalType)}。`); }
    if(!combatState) return;
    if(skill.burn){ addStatus(enemy.statuses,'burn',skill.burn); log(`${enemy.name} 进入【燃烧】状态。`); }
    if(skill.bindTurns){ addStatus(enemy.statuses,'bind',skill.bindTurns); log(`${enemy.name} 被【束缚】${skill.bindTurns} 回合。`); }
    if(skill.knockback) knockBack(enemy);
    if(finalType!=='physical'&&AURA_ELEMS.includes(finalType)&&!AFFIN_IMMUNE[enemy.key]) setAura(enemy,finalType);
  }
  if(combatState){ if(hitAny) applyTalentOnAttack(charKey,Math.round(effBase)); if(critThis&&charKey==='luyouyou') triggerBiyi(); consumeCritBuff(charKey); if(skill.cd) combatState.ally[charKey].cds[skill.id]=skill.cd; reapplyAura(targets[0]); checkCombatEnd(); }
}
function knockBack(enemy){
  const cs=combatState; const H=cs.hero; const dx=enemy.x-H.x, dy=enemy.y-H.y;
  const [fx,fy]=facingDir(Math.abs(dx)>=Math.abs(dy) ? (dx>0?'right':dx<0?'left':(dy>0?'down':'up')) : (dy>0?'down':'up'));
  const nx=enemy.x+fx, ny=enemy.y+fy;
  if(nx<0||ny<0||nx>=G.map.n||ny>=G.map.n) return;
  if(G.map.cells[ny*G.map.n+nx].terrain!=='ground') return;
  if(nx===H.x&&ny===H.y) return;
  const blocker=cs.enemies.find(o=>o!==enemy&&o.x===nx&&o.y===ny);
  if(blocker){ const bnx=blocker.x+fx, bny=blocker.y+fy; const bOK=bnx>=0&&bny>=0&&bnx<G.map.n&&bny<G.map.n&&G.map.cells[bny*G.map.n+bnx].terrain==='ground'&&!(bnx===H.x&&bny===H.y)&&!cs.enemies.some(o=>o!==blocker&&o!==enemy&&o.x===bnx&&o.y===bny); if(bOK){ blocker.x=bnx; blocker.y=bny; log(`${blocker.name} 被连带击退。`); } else return; }
  enemy.x=nx; enemy.y=ny; log(`${enemy.name} 被击退一格。`);
}
function consumeCritBuff(charKey){ const sts=combatState&&combatState.ally[charKey]&&combatState.ally[charKey].statuses; if(sts&&sts.crit){ delete sts.crit; log(`${getChar(charKey).name} 消耗了【屏息】，暴击加成已生效。`); } }
function triggerBiyi(){ for(const k of G.team){ if(k==='luyouyou')continue; const sts=combatState.ally[k]&&combatState.ally[k].statuses; if(sts) addStatus(sts,'crit',null); } log('【比翼】触发：其余我方角色下一次攻击暴击率+100%。'); }
function applyAlert(enemy){ for(const e of combatState.enemies) delete e.statuses.alert; addStatus(enemy.statuses,'alert',null); log(`${enemy.name} 成为【重点目标】。`); }
function applySupport(charKey, skill){ const cs=combatState; if(skill.id==='guwu'){ const level=entryLevel(charKey,skill); const healPct=vTier(skill,'heal',level)/100; const buff=vTier(skill,'buff',level); const heal=Math.max(1,Math.round(charAtk(charKey)*healPct)); if(!combatState) return; if(cs.hero.hp<G.hero.maxHp){ cs.hero.hp=Math.min(G.hero.maxHp,cs.hero.hp+heal); G.hero.hp=cs.hero.hp; log(`主角回复 ${heal} 点生命。`); } let top=null,topAtk=-1; for(const k of G.team){ const a=charAtk(k); if(a>topAtk){topAtk=a;top=k;} } if(top){ cs.ally[top].flatAtk=(cs.ally[top].flatAtk||0)+buff; cs.ally[top].flatAtkTurns=2; log(`${getChar(top).name} 攻击力+${buff}（持续2回合）。`); } } else if(skill.id==='bixi'){ addStatus(cs.ally[charKey].statuses,'crit',null); log(`${getChar(charKey).name} 屏息凝视，下一次攻击暴击率+100%（整场不可叠加）。`); } else { log(`${getChar(charKey).name} 施展「${skill.name}」。`); } checkCombatEnd(); }
function applyTalentOnAttack(charKey, dmg){ if(!combatState) return; const c=getChar(charKey), sts=combatState.ally[charKey]; if(!sts) return; const blood=c.passives.find(p=>p.id==='blood'); if(blood&&Math.random()*100<tierValue(blood,entryLevel(charKey,blood),'prob')){ if(charKey==='pro'){ const heal=Math.max(1,Math.round(dmg*0.5)); const nx=Math.min(G.hero.maxHp,G.hero.hp+heal); if(nx>G.hero.hp){ const got=nx-G.hero.hp; G.hero.hp=nx; combatState.hero.hp=nx; log(`【嗜血】触发，回复 ${got} 点生命。`); } } } const momentum=c.passives.find(p=>p.id==='momentum'); if(momentum) sts.mom=(sts.mom||0)+tierValue(momentum,entryLevel(charKey,momentum),'dmg'); }
function setAura(enemy,elem){ if(!AURA_ELEMS.includes(elem))return; enemy.aura=elem; enemy.statuses.aura={id:'aura',name:'附着·'+ELEM[elem].zh,kind:'neutral',turns:null,desc:'元素附着：该目标受到'+ELEM[elem].zh+'元素伤害时可能触发元素反应。附着会顶替旧附着。'}; }
function checkCombatEnd(){ if(!combatState) return; if(combatState.enemies.length===0){ G.records.wins=(G.records.wins||0)+1; log('战斗胜利！'); endCombat(true); return; } if(combatState.hero.hp<=0){ endCombatByDefeat(); } }
function applyPoisonTick(node, who){ if(!node||!node.statuses) return; const p=node.statuses.poison; if(!p) return; const n=p.layers||0; if(n<=0){ delete node.statuses.poison; return; } if(who==='hero'){ const lost=Math.min(combatState.hero.hp,n); if(lost>0){ combatState.hero.hp-=lost; G.hero.hp=combatState.hero.hp; log(`【中毒】流失 ${lost} 点生命。`); } } else { node.hp-=n; log(`${node.name} 受【中毒】流失 ${n} 点生命。`); } }
function enemyTurn(){ const cs=combatState; if(!cs) return; for(const enemy of cs.enemies.slice()){ if(!combatState||!combatState.enemies.includes(enemy)) break; runEnemyTurn(enemy); if(!combatState) return; } }
function runEnemyTurn(enemy){
  const cs=combatState; if(!cs) return;
  applyPoisonTick(enemy,'enemy'); applyBurnTick(enemy,'enemy');
  if(!cs.enemies.includes(enemy)) return;
  if(enemy.hp<=0 && cs.enemies.includes(enemy)){ enemy.hp=0; log(`${enemy.name} 被状态效果击败。`); removeEnemy(enemy); checkCombatEnd(); return; }
  if(hasStatus(enemy.statuses,'sleep')){ log(`${enemy.name} 处于【睡眠】中，一动不动。`); }
  else{
    let skip=false;
    if(hasP(enemy,'hiber')){ if(enemy.justWoke){ enemy.justWoke=false; log(`${enemy.name} 醒了过来，打了个哈欠，本轮无法行动。`); skip=true; } else if(!enemy.rageStarted){ startRage(enemy); } }
    const alreadyFled = checkOldTreeFlee(enemy); if(alreadyFled) return;
    if(!skip){
      if(enemy.chargingSkill){ const s=(enemy.def.skills||[]).find(x=>x.id===enemy.chargingSkill); enemy.plan={step:'none', skill:s||null, facing:enemy.facing}; }
      else enemy.plan = resolveEnemyIntent(enemy);
      enemy.facing = enemy.plan.facing || enemy.facing;
      if(enemy.plan.step==='move'){ applyPlanMove(enemy); }
      else if(enemy.plan.step==='face'){ log(`${enemy.name} 改变了朝向。`); }
      if(enemy.plan.skill){ castEnemySkill(enemy, enemy.plan.skill); if(enemy.chargingSkill===enemy.plan.skill.id) enemy.chargingSkill=null; }
      if(enemy.rageActive && enemy.plan.skill && enemy.plan.skill.kind==='attack' && cs.enemies.includes(enemy)){ castEnemySkill(enemy, enemy.plan.skill); }
    }
    enemy.plan=null;
    if(enemy.rageActive){ enemy.rageRounds=(enemy.rageRounds||0)-1; if(enemy.rageRounds<=0) endRage(enemy); }
  }
  reapplyAura(enemy); tickEnemyCooldowns(enemy);
}
function startRage(enemy){ enemy.rageStarted=true; enemy.rageActive=true; enemy.baseAtk=enemy.atk; enemy.atk=Math.round(enemy.atk*1.8); enemy.speed=(enemy.speed||0)+60; enemy.rageRounds=5; log(`${enemy.name} 进入【狂躁】状态！攻击力+80%、速度+60，持续5回合。`); }
function endRage(enemy){ enemy.rageActive=false; if(enemy.baseAtk!=null) enemy.atk=enemy.baseAtk; enemy.speed=Math.max(0,(enemy.speed||0)-60); enemy.rageRounds=0; log(`${enemy.name} 的【狂躁】结束了。`); }
function checkOldTreeFlee(enemy){ if(hasP(enemy,'runaway') && (combatState.turn||1)>=8 && enemy.hp>0){ log('古树到了第8回合，撒腿就跑，战斗胜利！'); endCombat(true,'古树逃跑，但奖励按剩余果实结算。'); return true; } return false; }
function resolveEnemyIntent(enemy){ const cs=combatState; const sk=(enemy.def.skills||[]).concat(); const H=cs.hero; if(!H) return {step:'none',skill:null,facing:enemy.facing};
  if(enemy.sustain&&enemy.sustain>0){ const ss=sk.find(s=>s.id===enemy.sustainSkillId); if(ss) return {step:'none', skill:ss, facing:enemy.facing}; }
  if(hasP(enemy,'patrol') && enemy.hp>=enemy.maxHp){
    const mv=[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>({x:enemy.x+a,y:enemy.y+b})).filter(c=>passable(c.x,c.y)&&!cs.enemies.some(o=>o!==enemy&&o.x===c.x&&o.y===c.y));
    const target=mv.length? mv[Math.floor(Math.random()*mv.length)] : null;
    return {step:'move', skill:null, facing:enemy.facing, moveTo: target, patrolMove:true};
  }
  if(hasStatus(enemy.statuses,'bind')){
    const s=sk.find(x=>x.kind==='attack'&&cdReady(enemy,x)&&!enemyOnlyTurn1Block(x,enemy)&&hitsFrom(enemy.x,enemy.y,x,enemy.facing,H))||sk.find(x=>x.kind==='support'&&cdReady(enemy,x)&&!enemyOnlyTurn1Block(x,enemy)&&hitsFrom(enemy.x,enemy.y,x,enemy.facing,H));
    return {step:'none', skill:s||null, facing:enemy.facing};
  }
  const FAC=['up','down','left','right'];
  const readyA=sk.filter(s=>s.kind==='attack'&&cdReady(enemy,s)&&!enemyOnlyTurn1Block(s,enemy));
  const readyS=sk.filter(s=>s.kind==='support'&&cdReady(enemy,s)&&!enemyOnlyTurn1Block(s,enemy));
  for(const f of FAC) for(const s of readyA){ if(hitsFrom(enemy.x,enemy.y,s,f,H)) return maybeCharge(enemy,{step:'none',skill:s,facing:f}); }
  for(const f of FAC) for(const s of readyS){ if(hitsFrom(enemy.x,enemy.y,s,f,H)) return {step:'none',skill:s,facing:f}; }
  const budget=moveBudget(enemy); const reach=bfsReachable(enemy,budget,H);
  let bestHit=null;
  for(const B of reach){ if(B.x===enemy.x&&B.y===enemy.y) continue; for(const f of moveFacingCandidates(enemy,B)) for(const s of readyA){ if(hitsFrom(B.x,B.y,s,f,H)){ const d=(B.x-H.x)*(B.x-H.x)+(B.y-H.y)*(B.y-H.y); if(!bestHit||d>bestHit.d) bestHit={cell:B,facing:f,skill:s,d}; } } }
  if(!bestHit){ for(const B of reach){ if(B.x===enemy.x&&B.y===enemy.y) continue; for(const f of moveFacingCandidates(enemy,B)) for(const s of readyS){ if(hitsFrom(B.x,B.y,s,f,H)){ const d=(B.x-H.x)*(B.x-H.x)+(B.y-H.y)*(B.y-H.y); if(!bestHit||d>bestHit.d) bestHit={cell:B,facing:f,skill:s,d}; } } } }
  if(bestHit) return maybeCharge(enemy,{step:'move',skill:bestHit.skill,facing:bestHit.facing,moveTo:bestHit.cell});
  let closest=null; for(const B of reach){ const d=(B.x-H.x)*(B.x-H.x)+(B.y-H.y)*(B.y-H.y); if(!closest||d<closest.d) closest={cell:B,d}; }
  if(closest && (closest.cell.x!==enemy.x||closest.cell.y!==enemy.y)){ const f=(moveFacingCandidates(enemy,closest.cell)[0])||enemy.facing; return {step:'move',skill:null,facing:f,moveTo:closest.cell}; }
  const cf=dirToFacing(H.x-enemy.x,H.y-enemy.y);
  if(cf!==enemy.facing) return {step:'face',skill:null,facing:cf};
  return {step:'none',skill:null,facing:enemy.facing}; }
function moveFacingCandidates(A,B){ const dx=B.x-A.x, dy=B.y-A.y; if(dx===0&&dy===0) return []; if(dx===0) return [dy>0?'down':'up']; if(dy===0) return [dx>0?'right':'left']; const hx=dx>0?'right':'left', hy=dy>0?'down':'up'; return (Math.abs(dx)===Math.abs(dy)) ? [hx,hy] : [Math.abs(dx)>Math.abs(dy)?hx:hy]; }
function maybeCharge(enemy, act){ if(act&&act.skill&&act.skill.id==='missile'){ enemy.chargingSkill='missile'; log(`${enemy.name} 开始【蓄力】，下回合发射飞弹。`); return {step:'none', skill:null, facing:enemy.facing}; } return act; }
function enemyOnlyTurn1Block(s,enemy){ return !!(s.onlyTurn1 && (combatState.turn||1)>1); }
function moveBudget(enemy){ if(hasSkill(enemy,'hchase')||hasSkill(enemy,'hpchase')) return 2; if(enemy.def.skills.some(s=>s.kind==='move')) return 1; return 0; }
function bfsReachable(enemy,budget,H){ const n=G.map.n; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n; const ok=(x,y)=> x===enemy.x&&y===enemy.y ? true : (inb(x,y)&&G.map.cells[y*n+x].terrain==='ground'&&!(x===H.x&&y===H.y)&&!combatState.enemies.some(o=>o!==enemy&&o.x===x&&o.y===y)); const out=[{x:enemy.x,y:enemy.y}]; const seen=new Set([enemy.x+','+enemy.y]); let frontier=[{x:enemy.x,y:enemy.y}]; for(let d=1;d<=budget;d++){ const nxt=[]; for(const c of frontier){ for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const X=c.x+a,Y=c.y+b,k=X+','+Y; if(seen.has(k))continue; if(!ok(X,Y))continue; seen.add(k); out.push({x:X,y:Y}); nxt.push({x:X,y:Y}); } } frontier=nxt; if(!frontier.length)break; } return out; }
function hitsFrom(x,y,skill,facing,H){ if(!skill||!H) return false; if(skill.teleport) return true; if(skill.kind==='support') return true; const [dx,dy]=facingDir(facing); if(skill.target==='amid-2'||skill.id==='feather') return Math.abs(x-H.x)+Math.abs(y-H.y)<=2; if(skill.target==='adj-rand'||skill.id==='cbyatk') return Math.max(Math.abs(x-H.x),Math.abs(y-H.y))<=1; if(skill.target==='front6'||skill.id==='trample'){ for(let i=1;i<=6;i++){ const X=x+dx*i,Y=y+dy*i; if(!passable(X,Y)) break; if(X===H.x&&Y===H.y) return true; } return false; } if(skill.id==='missile'){ for(let i=1;i<=400;i++){ const X=x+dx*i,Y=y+dy*i; if(X<0||Y<0||X>=G.map.n||Y>=G.map.n) break; if(G.map.cells[Y*G.map.n+X].terrain==='obstacle') break; if(X===H.x&&Y===H.y) return true; } return false; } if(skill.target==='line'||skill.target==='line-multi'){ for(let i=1;i<=3;i++){ const X=x+dx*i,Y=y+dy*i; if(!passable(X,Y)) break; if(X===H.x&&Y===H.y) return true; } return false; } return (x+dx===H.x && y+dy===H.y); }
function firstMoveStep(enemy,H){ if(!H) return null; const cs=combatState; const n=G.map.n; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n; const startKey=enemy.x*100+enemy.y; const q=[[enemy.x,enemy.y]]; const prev={}; prev[startKey]=null; const seen=new Set([startKey]); let found=false; while(q.length){ const [cx,cy]=q.shift(); if(cx===H.x&&cy===H.y){ found=true; break; } for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=cx+a, ny=cy+b, key=nx*100+ny; if(seen.has(key)) continue; seen.add(key); if(!inb(nx,ny)) continue; if(G.map.cells[ny*n+nx].terrain!=='ground') continue; if((nx!==H.x||ny!==H.y) && cs.enemies.some(o=>o!==enemy&&o.x===nx&&o.y===ny)) continue; prev[key]=cx*100+cy; q.push([nx,ny]); } } if(!found) return null; let cur=H.x*100+H.y, first=cur; while(prev[cur]!=null){ first=cur; cur=prev[cur]; } if(first===startKey) return null; return {x:Math.floor(first/100), y:first%100}; }
function pathStep(enemy, H, k){ if(!H) return null; const n=G.map.n; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n; const startKey=enemy.x*100+enemy.y; const q=[[enemy.x,enemy.y,0]]; const prev={}; prev[startKey]=null; const seen=new Set([startKey]); let foundD=-1; while(q.length){ const [cx,cy,d]=q.shift(); if(d>k) break; if(cx===H.x&&cy===H.y){ foundD=d; break; } for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=cx+a, ny=cy+b, key=nx*100+ny; if(seen.has(key)) continue; seen.add(key); if(!inb(nx,ny)) continue; if(G.map.cells[ny*n+nx].terrain!=='ground') continue; if((nx!==H.x||ny!==H.y) && combatState.enemies.some(o=>o!==enemy&&o.x===nx&&o.y===ny)) continue; prev[key]=cx*100+cy; q.push([nx,ny,d+1]); } } if(foundD<0) return null; const back=foundD-k; if(back<1) return null; let cur=H.x*100+H.y, steps=0; while(prev[cur]!=null && steps<back){ cur=prev[cur]; steps++; } if(steps===0) return null; return {x:Math.floor(cur/100), y:cur%100}; }
function applyPlanMove(enemy){ const cs=combatState; const p=enemy.plan||{}; if(p.moveTo){ const tx=p.moveTo.x, ty=p.moveTo.y; const ok = tx>=0&&ty>=0&&tx<G.map.n&&ty<G.map.n && G.map.cells[ty*G.map.n+tx].terrain==='ground' && !(tx===cs.hero.x&&ty===cs.hero.y) && !cs.enemies.some(o=>o!==enemy&&o.x===tx&&o.y===ty); if(ok){ enemy.x=tx; enemy.y=ty; if(hasSkill(enemy,'hchase')||hasSkill(enemy,'hpchase')){ enemy.speed=(enemy.speed||0)+5; } } const mv=enemy.def.skills.find(s=>s.kind==='move'); if(ok) log(`${enemy.name} ${mv?`使用 <b>${mv.name}</b> `:''}向你逼近${(hasSkill(enemy,'hchase')||hasSkill(enemy,'hpchase'))?'（速度+5）':''}。`); return; } moveToward(enemy); }
function hitAt(e,skill,facing){ return hitsFrom(e.x,e.y,skill,facing,combatState.hero); }
function hitByFace(e,skill){ for(const f of ['up','down','left','right']){ if(f!==e.facing && hitAt(e,skill,f)) return true; } return false; }
function hitByMove(e,skill){ const H=combatState.hero; const d=Math.abs(e.x-H.x)+Math.abs(e.y-H.y); if(d>3) return false; if(skill.target==='line'||skill.target==='line-multi') return true; if(d>2) return false; return true; }
function planEnemyTurn(){ const cs=combatState; if(!cs) return; cs.turnStartHero={x:cs.hero.x,y:cs.hero.y}; for(const e of cs.enemies){ e.plan=resolveEnemyIntent(e); } }
function moveToward(enemy){ const cs=combatState; const n=G.map.n; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n; const startKey=enemy.x*100+enemy.y; const q=[[enemy.x,enemy.y]]; const prev={}; prev[startKey]=null; const seen=new Set([startKey]); let found=false; while(q.length){ const [cx,cy]=q.shift(); if(cx===cs.hero.x&&cy===cs.hero.y){ found=true; break; } for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=cx+a, ny=cy+b, key=nx*100+ny; if(seen.has(key)) continue; seen.add(key); if(!inb(nx,ny)) continue; if(G.map.cells[ny*n+nx].terrain!=='ground') continue; if((nx!==cs.hero.x||ny!==cs.hero.y) && cs.enemies.some(en=>en!==enemy&&en.x===nx&&en.y===ny)) continue; prev[key]=cx*100+cy; q.push([nx,ny]); } } if(!found) return false; let cur=cs.hero.x*100+cs.hero.y, first=cur; while(prev[cur]!=null){ first=cur; cur=prev[cur]; } const fx=Math.floor(first/100), fy=first%100; if(fx===enemy.x&&fy===enemy.y) return false; if(cs.hero.x===fx&&cs.hero.y===fy) return false; enemy.x=fx; enemy.y=fy; enemy.facing=dirToFacing(cs.hero.x-fx,cs.hero.y-fy); const mv=enemy.def.skills.find(s=>s.kind==='move'); log(`${enemy.name} ${mv?`使用 <b>${mv.name}</b> `:''}向你逼近。`); return true; }
function cdReady(enemy,skill){ const cd=enemy.cooldowns[skill.id]||0; return cd<=0; }
function setCd(enemy,skill){ if(skill.cd) enemy.cooldowns[skill.id]=skill.cd; }
function tickEnemyCooldowns(enemy){ for(const k in enemy.cooldowns){ if(enemy.cooldowns[k]>0) enemy.cooldowns[k]--; } if(enemy.sustain!==undefined&&enemy.sustain>0){ enemy.sustain--; if(enemy.sustain<=0){ enemy.sustain=-1; if(enemy.sustainSkillId){ const ss=enemy.def&&enemy.def.skills&&enemy.def.skills.find(s=>s.id===enemy.sustainSkillId); if(ss&&ss.cd) enemy.cooldowns[enemy.sustainSkillId]=ss.cd; enemy.sustainSkillId=null; } else { const im=enemy.def&&enemy.def.skills&&enemy.def.skills.find(s=>s.id==='icemist'); if(im&&im.cd) enemy.cooldowns.icemist=im.cd; } } } }
function castEnemySkill(enemy, skill){ const cs=combatState; if(!cs) return; const [dxx,dyy]=facingDir(enemy.facing); const dmgOf=m=>Math.max(1,Math.round((enemy.atk||0)*(m||1))); const front=()=>({x:enemy.x+dxx, y:enemy.y+dyy}); const hitHero=(x,y)=> x===cs.hero.x && y===cs.hero.y;
  if(skill.kind==='attack'){ enemy.attacks=(enemy.attacks||0)+1; }
  let dealt=false;
  if(skill.id==='slimebang'){ const f=front(); const dmg=dmgOf(skill.mult||1); if(hitHero(f.x,f.y)){ damageHero(dmg,'physical'); dealt=true; log(`${enemy.name} 使用 <b>撞击</b>，造成 ${dmg} 点${elemText('physical')}。`); } else log(`${enemy.name} 的撞击落空。`); }
  else if(skill.id==='slimeburst'){ enemy.noMoveThisTurn=true; const p=teleportNearHero(enemy); if(p){ enemy.x=p.x; enemy.y=p.y; enemy.facing=dirToFacing(cs.hero.x-p.x,cs.hero.y-p.y); } const dmg=dmgOf(skill.mult||1); let hit=false; for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ if(hitHero(enemy.x+a,enemy.y+b)){ damageHero(dmg,'grass'); hit=true; } } log(`${enemy.name} 破土而出，${hit?`造成 ${dmg} 点${elemText('grass')}`:'被躲开了'}。`); dealt=hit; }
  else if(skill.id==='firespit'){ const dmg=dmgOf(skill.mult||0.5); const shots=(skill.shots||2); let hits=0; for(let s=1;s<=3;s++){ const x=enemy.x+dxx*s,y=enemy.y+dyy*s; if(!passable(x,y)) break; if(hitHero(x,y)){ hits+=shots; break; } } if(hits>0){ damageHero(dmg*hits,'fire'); dealt=true; } log(`${enemy.name} 吐出火球，${hits>0?`造成 ${hits*dmg} 点${elemText('fire')}`:'全部射失'}。`); setCd(enemy,skill); }
  else if(skill.id==='waterbubble'){ const t=cs.turnStartHero||combatState.hero; cs.bubbles.push({x:t.x,y:t.y,fuse:2}); log(`${enemy.name} 向你的位置投掷了水泡（将在两个回合后落下）。`); setCd(enemy,skill); }
  else if(skill.id==='icemist'){ const dmg=dmgOf(skill.mult||0.8); let onLine=false; for(let s=1;s<=3;s++){ const x=enemy.x+dxx*s,y=enemy.y+dyy*s; if(hitHero(x,y)){onLine=true;break;} if(!passable(x,y))break; } if(onLine){ damageHero(dmg,'ice'); dealt=true; log(`${enemy.name} 喷射冰雾，造成 ${dmg} 点${elemText('ice')}(持续中)。`); } if(enemy.sustain<0){ enemy.sustain=(skill.sustain||2); enemy.sustainSkillId=skill.id; } }
  else if(skill.id==='hbite'||skill.id==='hpbite'||skill.id==='slap'||skill.id==='snakebite'||skill.id==='snakebite2'){
    const f=front();
    if(skill.id==='slap'&&enemy.rageActive){ const adj=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; const cand=adj.filter(p=>hitHero(enemy.x+p[0],enemy.y+p[1])); if(cand.length){ const dmg=dmgOf(skill.mult||1); damageHero(dmg,'physical'); dealt=true; log(`${enemy.name} 狂躁地一掌拍向主角，造成 ${dmg} 点${elemText('physical')}。`); } else log(`${enemy.name} 的狂躁一击落空。`); }
    else if(hitHero(f.x,f.y)){ const dmg=dmgOf(skill.mult||1); damageHero(dmg,'physical'); dealt=true; log(`${enemy.name} 使用 <b>${skill.name}</b>，造成 ${dmg} 点${elemText('physical')}。`); if(skill.id==='snakebite'&&Math.random()<0.5){ poisonHero(14); log('剧毒蔓延：主角【中毒】+14层。'); } else if(skill.id==='snakebite2'){ poisonHero(19); log('剧毒蔓延：主角【中毒】+19层。'); } }
    else log(`${enemy.name} 的<b>${skill.name}</b>落空。`);
  }
  else if(skill.id==='feather'||skill.id==='cbyatk'){ const hit = skill.id==='cbyatk' ? distCheb(enemy,cs.hero)<=1 : (Math.abs(cs.hero.x-enemy.x)+Math.abs(cs.hero.y-enemy.y)<=2); if(hit){ const dmg=dmgOf(skill.mult||1); damageHero(dmg,'physical'); dealt=true; log(`${enemy.name} 使用 <b>${skill.name}</b>，造成 ${dmg} 点${elemText('physical')}。`); } else log(`${enemy.name} 的<b>${skill.name}</b>够不着主角。`); }
  else if(skill.id==='trample'){ let hit=false,dmg=0; for(let i=1;i<=6;i++){ const x=enemy.x+dxx*i,y=enemy.y+dyy*i; if(!passable(x,y))break; if(hitHero(x,y)){ dmg=dmgOf(1.0); damageHero(dmg,'physical'); hit=true; dealt=true; break; } } log(`${enemy.name} 使用 <b>践踏</b>，${hit?`造成 ${dmg} 点${elemText('physical')}`:'踩了个空'}。`); }
  else if(skill.id==='missile'){ let hit=false,dmg=0; for(let s=1;s<=400;s++){ const x=enemy.x+dxx*s,y=enemy.y+dyy*s; if(x<0||y<0||x>=G.map.n||y>=G.map.n)break; if(G.map.cells[y*G.map.n+x].terrain==='obstacle')break; if(hitHero(x,y)){ dmg=dmgOf(0.4); damageHero(dmg,'physical'); hit=true; dealt=true; break; } } log(`${enemy.name} 发射 <b>${skill.shots||3}</b> 枚飞弹，${hit?`命中造成 ${dmg} 点${elemText('physical')}`:'全部飞远不见了'}。`); }
  else if(skill.id==='cleanse'){ let hit=false,dmg=0; if(distCheb(enemy,cs.hero)<=1){ dmg=dmgOf(1.4); damageHero(dmg,'physical'); hit=true; dealt=true; } log(`${enemy.name} 施展 <b>大清扫</b>，${hit?`造成 ${dmg} 点${elemText('physical')}`:'周围无人'}。`); if(enemy.sustain<0){ enemy.sustain=(skill.sustain||3); enemy.sustainSkillId=skill.id; } }
  else if(skill.id==='woju'){ const f=front(); if(hitHero(f.x,f.y)){ if(G.hero.hp<G.hero.maxHp){ G.hero.hp=Math.min(G.hero.maxHp,G.hero.hp+200); cs.hero.hp=G.hero.hp; log('吐果子让你回复 <b>200</b> 点生命！'); } else log('吐果子落在你脚下，可你生命已满。'); } else log(`${enemy.name} 的吐果子落了空。`); const sd=Math.min(200,enemy.hp||0); enemy.hp-=sd; log(`${enemy.name} 因吐果子流失 ${sd} 点生命。`); if(enemy.hp<=0&&cs.enemies.includes(enemy)){ enemy.hp=0; log(`${enemy.name} 被自己的吐果子反噬击败。`); removeEnemy(enemy); checkCombatEnd(); return; } }
  else { log(`${enemy.name} 施展「${skill.name}」。`); }
  enemy.noMoveThisTurn=false;
  if(!dealt && skill.kind==='attack' && hasP(enemy,'scare2')) enemy.bindNextRound=true;
  if(dealt){
    if(hasP(enemy,'amaterasu')){ if(Math.random()<0.40){ G.hero.def=Math.max(0,(G.hero.def||0)-15); log(`${enemy.name} 的阿玛特拉斯：主角防御 -15。`); } if(Math.random()<0.20){ addStatus(cs.ally.pro.statuses,'burn',null); log(`${enemy.name} 点燃了你（整场【燃烧】）。`); } }
    if(hasP(enemy,'lethal')){ enemy.atk+=8; }
    if(hasP(enemy,'drift')||hasP(enemy,'drift2')){ if((enemy.attacks||0)%3===0){ const np=randomRelocate(enemy, hasP(enemy,'drift')?3:5); if(np){ enemy.x=np.x; enemy.y=np.y; log(`${enemy.name} 飘忽不定，瞬移至 ${np.x+1},${np.y+1}。`); } } }
  }
}
function randomRelocate(enemy,r){ const cs=combatState; const m=G.map; const cand=[]; for(let y=0;y<m.n;y++)for(let x=0;x<m.n;x++){ if(x===enemy.x&&y===enemy.y)continue; if(Math.abs(x-enemy.x)+Math.abs(y-enemy.y)>r)continue; if(m.cells[y*m.n+x].terrain!=='ground')continue; if(cs.enemies.some(o=>o!==enemy&&o.x===x&&o.y===y))continue; if(x===cs.hero.x&&y===cs.hero.y)continue; cand.push({x,y}); } return cand.length?cand[Math.floor(Math.random()*cand.length)]:null; }
function enemyFaceHero(enemy){ enemy.facing=dirToFacing(combatState.hero.x-enemy.x,combatState.hero.y-enemy.y); }
function teleportNearHero(enemy){ const cs=combatState; const cand=[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>({x:cs.hero.x+a,y:cs.hero.y+b})).filter(p=>passable(p.x,p.y)&&!(p.x===enemy.x&&p.y===enemy.y)); return cand.length?cand[Math.floor(Math.random()*cand.length)]:null; }
function damageHero(dmg, type){ const cs=combatState; const pro=getChar('pro'); const real=(type==='true'||type==='real');
  const lly=getChar('luyouyou'); const flP=lly&&lly.passives.find(p=>p.id==='flutter');
  if(!real && flP && G.team.indexOf('luyouyou')>=0){ const dr=vTier(flP,'dodge',entryLevel('luyouyou',flP)); if(Math.random()*100<dr){ const hv=vTier(flP,'combat',entryLevel('luyouyou',flP)); const nx=Math.min(G.hero.maxHp||100,(G.hero.hp||0)+hv); const got=nx-G.hero.hp; G.hero.hp=nx; cs.hero.hp=nx; log(`【闪避】触发，本次伤害降为0${got>0?`，回复 ${got} 点生命。`:''}`); return; } }
  const block=pro.passives.find(p=>p.id==='block'); if(block&&Math.random()*100<tierValue(block,entryLevel('pro',block),'prob')){ log('【格挡】触发，本次伤害降为0。'); return; }
  if(!real && cs.hero.shield>0){ const absorb=Math.min(cs.hero.shield,dmg); cs.hero.shield-=absorb; dmg-=absorb; } let d=Math.max(0,Math.round(dmg)); if(d>0){ cs.hero.hp-=d; G.hero.hp=cs.hero.hp; } const hold=pro.passives.find(p=>p.id==='hold'); if(hold&&!real&&d>0&&Math.random()*100<tierValue(hold,entryLevel('pro',hold),'prob')){ const got=Math.min(G.hero.maxHp-G.hero.hp,Math.round(G.hero.maxHp*0.12)); if(got>0){ cs.hero.hp+=got; G.hero.hp=cs.hero.hp; log(`【坚守】回复 ${got} 点生命。`); } }
  if(cs.hero.hp<=0){ const xia=getChar('xiayang'); const reb=xia&&xia.passives.find(p=>p.id==='rebirth'); if(combatState&&G&&reb&&G.team.indexOf('xiayang')>=0&&G.rebirthUsedDay!==(G.day||1)){ G.rebirthUsedDay=G.day||1; cs.hero.hp=Math.max(1,Math.round(G.hero.maxHp*0.5)); G.hero.hp=cs.hero.hp; for(const k of G.team){ if(cs.ally[k]) addStatus(cs.ally[k].statuses,'atkUp',null); } log('【涅槃】触发：主角没有倒下！回复50%生命，全体我方攻击力+25%。'); return; } cs.hero.hp=0; G.hero.hp=0; }
  checkCombatEnd(); }
function removeEnemy(enemy){ const cs=combatState; if(!cs) return; const wind=enemy.def&&enemy.def.passives&&enemy.def.passives.find(p=>p.id==='windswirl'); if(wind && cs.enemies.filter(e=>e!==enemy).length>0){ if(dist(enemy,cs.hero)<=2){ cs.hero.x=enemy.x; cs.hero.y=enemy.y; const d=Math.max(1,Math.round(enemy.atk*0.4)); damageHero(d,'wind'); log(`${enemy.name} 的风旋把你卷到了它所在格，受到 ${d} 点${elemText('wind')}。`); } } cs.defeated.push(enemy); cs.enemies=cs.enemies.filter(e=>e!==enemy); }
function tryFlee(){ const cs=combatState; if(!cs) return; if(cs.playerMoved||cs.ally.pro.used){ prompt('本回合已使用技能或已移动，无法逃跑。'); return; } const enemy=cs.enemies[0]; const rate=calcEscapeRate(enemy); if(Math.random()*100<rate){ G.hero.escapeSpeed=(G.hero.escapeSpeed||100)+1; endCombat(false,'你成功逃跑了！逃跑速度永久+1。'); } else { log(`逃跑失败！你失去了本回合的行动。`); cs.playerMoved=true; cs.ally.pro.used=true; autoCastAll(); if(!combatState) return; endPlayerPhase(); } }
function resolveBubbles(){ const cs=combatState; if(!cs) return; for(const b of cs.bubbles.slice()){ b.fuse=(b.fuse==null?1:b.fuse-1); if(b.fuse>0) continue; if(cs.hero.x===b.x&&cs.hero.y===b.y){ addStatus(cs.ally.pro.statuses,'cage',2); log('水泡落下，你被【禁锢】2回合。'); } else { const en=cs.enemies.find(e=>e.x===b.x&&e.y===b.y); if(en){ addStatus(en.statuses,'cage',2); log(`${en.name} 被水泡【禁锢】2回合。`); } } cs.bubbles=cs.bubbles.filter(x=>x!==b); } }
function endPlayerPhase(){ const cs=combatState; if(!cs) return; if(cs.enemies.length===0){ return; } cs.turnStartHero={x:cs.hero.x,y:cs.hero.y}; enemyTurn(); if(!combatState) return; cs.turn++; applyBurnTick({statuses:cs.ally.pro.statuses},'hero'); applyPoisonTick({statuses:cs.ally.pro.statuses},'hero'); if(G.hero.hp<=0){ endCombatByDefeat(); return; } for(const k of G.team){ tickStatuses(cs.ally[k].statuses); for(const c in cs.ally[k].cds){ if(cs.ally[k].cds[c]>0) cs.ally[k].cds[c]--; } if(cs.ally[k].flatAtkTurns>0){ cs.ally[k].flatAtkTurns--; if(cs.ally[k].flatAtkTurns<=0) cs.ally[k].flatAtk=0; } } for(const e of cs.enemies.slice()){ const had=hasStatus(e.statuses,'sleep'); tickStatuses(e.statuses); if(had&&!hasStatus(e.statuses,'sleep')&&hasP(e,'hiber')) e.justWoke=true; } tickStatuses(cs.field);
  for(const e of cs.enemies.slice()){ if(e.bindNextRound){ addStatus(cs.ally.pro.statuses,'bind',1); log(`${e.name} 的恐吓锁定你，你被【束缚】1回合。`); e.bindNextRound=false; } }
  endOfRoundEnemyEffects(); resolveBubbles(); cs.hero.shield=0; refreshHeroShield(); cs.playerMoved=false; cs.playerOver=false; for(const k of G.team) cs.ally[k].used=false; $('#goBtn').style.display='none'; renderCombatMap(); updateCombatUI(); refreshHUD(); checkCombatEnd(); }
function endOfRoundEnemyEffects(){ const cs=combatState; if(!cs) return; for(const e of cs.enemies.slice()){ if(hasP(e,'conduct') && Math.random()<0.10 && distCheb(e,cs.hero)<=1){ const d=Math.max(1,Math.round(e.atk*0.4)); damageHero(d,'thunder'); log(`${e.name} 的导电在四周放电！造成 ${d} 点${elemText('thunder')}。`); } } }
function statusChipHTML(s){ const label = s.id==='poison' ? `中毒 ·${s.layers||0}层` : s.name; const safe=(s.desc||'').replace(/\"/g,'&quot;'); return `<span class="stchip st-${s.kind}" data-st="${s.id}" data-name="${s.id==='poison'?'中毒':s.name}" data-desc="${safe}">${label}${s.turns!=null?` ·${s.turns}回合`:''}</span>`; }
function statusBarHTML(statuses, extraField){ let chips=''; chips+=statusArr(statuses).map(statusChipHTML).join(''); if(extraField&&Object.keys(extraField).length){ chips+=`<span class="stlabel">全场</span>`+statusArr(extraField).map(statusChipHTML).join(''); } return `<div class="stbar">${chips||'<span class="stempty">无状态</span>'}</div>`; }
function updateCombatUI(){ if(!combatState){ switchMode('story'); return; } const cs=combatState; const chars=getTeamChars(); const cur=chars.find(c=>c.key===cs.currentChar)||chars[0]; $('#allyBar').innerHTML=chars.map((c,i)=>`<div class="allyCard ${c.key===cs.currentChar?'active':''}" data-k="${c.key}"><div class="allyName">${c.name}</div><div class="allyElem">${c.element?ELEM[c.element].zh:'无属性'} · ${i+1}号位</div></div>`).join(''); $('#allyBar').querySelectorAll('.allyCard').forEach(b=>b.onclick=()=>{ cs.currentChar=b.dataset.k; updateCombatUI(); renderCombatMap(); }); $('#charAttrs').innerHTML=charAttrsHTML(cur.key); $('#statusBar').innerHTML = cur.key==='pro'? statusBarHTML(cs.ally.pro.statuses,cs.field) : statusBarHTML(cs.ally[cur.key].statuses,null); const skills=cur.skills.filter(s=>cur.selectedSkillIds.includes(s.id)); const fleeBase=cs.enemies[0]; const fleeTag= fleeBase? `<div class="skillTag escape ${cs.ally[cur.key].selSkill==='flee'?'active':''}" data-s="flee"><span class="skillNum">4</span>逃　跑　${Math.round(calcEscapeRate(fleeBase))}%</div>` : ''; $('#skillList').innerHTML=skills.map((s,i)=>`<div class="skillTag ${s.kind==='attack'?'attack':'skill'} ${cs.ally[cur.key].selSkill===s.id?'active':''}" data-s="${s.id}"><span class="skillNum">${i+1}</span><span class="cat ${s.kind==='attack'?'attack':'support'}">${s.kind==='attack'?'攻击':'辅助'}</span>${skillDisplayName(cur.key,s)}${(cs.ally[cur.key].cds[s.id]||0)>0?` <span class="nohint">冷却${cs.ally[cur.key].cds[s.id]}</span>`:''}${cs.ally[cur.key].used?' <span class="usedMark">已用</span>':''}</div>`).join('')+fleeTag; $('#skillList').querySelectorAll('.skillTag').forEach(b=>b.onclick=()=>selectSkill(cur.key,b.dataset.s)); $('#talentBox').innerHTML=cur.passives.map((p,i)=>`<span class="talentTag" data-k="${cur.key}" data-i="${i}"><span class="cat talent">天赋</span>${talentDisplayName(cur.key,p)}</span>`).join(''); const selSkillId=cs.ally[cur.key].selSkill; const sel=cur.skills.find(s=>s.id===selSkillId); let detailHtml='<div class="skillDetailText">点击技能查看详情</div>'; if(sel){ detailHtml=`<div class="skillDetailName">${skillDisplayName(cur.key,sel)}</div><div class="skillDetailText">${describeSkill(cur.key,sel)}</div>`; } else if(selSkillId==='flee'){ const fe=cs.enemies[0]; detailHtml=`<div class="skillDetailName">逃走</div><div class="skillDetailText">逃离本场战斗，成功率 ${fe?Math.round(calcEscapeRate(fe)):0}%。本回合已行动则不可跑走。逃跑不获得奖励。</div>`; } $('#skillDetail').innerHTML=detailHtml; updateCombatInfo(); }
function skillDisplayName(ownerKey,s){ return s.scal?`${s.name}·等级${entryLevel(ownerKey,s)}`:s.name; }
function talentDisplayName(ownerKey,p){ return p.scal?`${p.name}·等级${entryLevel(ownerKey,p)}`:p.name; }
function charAttrsHTML(key){ if(key==='pro'){ const h=G.hero; return `<span class="attr"><b>攻击</b> ${charAtk('pro')}</span><span class="attr"><b>生命</b> ${Math.round(combatState.hero.hp)}/${h.maxHp}</span><span class="attr"><b>防御</b> ${totalHeroDefense()}</span><span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span><span class="attr"><b>逃跑速度</b> ${h.escapeSpeed}</span>`; } const c=getChar(key); return `<span class="attr"><b>攻击</b> ${charAtk(key)}</span><span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span>`; }
function updateCombatInfo(){ const cs=combatState; if(!cs) return; const fe=focusedEnemy(); if(fe){ prompt(enemyInfo(fe)); return; } if(!cs.infoCell) cs.infoCell={x:cs.hero.x,y:cs.hero.y}; const {x,y}=cs.infoCell; const en=cs.enemies.find(en=>en.x===x&&en.y===y); if(en){ prompt(enemyInfo(en)); return; } if(x===cs.hero.x&&y===cs.hero.y){ prompt(heroInfoHTML()); return; } const c=G.map.cells[y*G.map.n+x]; const tname=c.terrain==='void'?'不可通行':c.terrain==='obstacle'?'山脉障碍':'空地'; prompt(`<b>${tname}</b>（${x+1},${y+1}）`); }
function heroInfoHTML(){ const cs=combatState; return `<b>主角</b><br>攻击 ${G.hero.atk} · 防御 ${G.hero.def} · 生命 ${Math.round(cs.hero.hp)}/${G.hero.maxHp}${cs.hero.shield?`<br>护盾 ${Math.round(cs.hero.shield)}`:''}<br><div class="sec">状态</div>${statusBarHTML(cs.ally.pro.statuses,cs.field)}`; }
function resAdvice(en){ const high=[]; const map={physical:'物理',fire:'火',water:'水',grass:'草',thunder:'雷',ice:'冰',wind:'风',rock:'岩'}; for(const k in map){ const v=(en.res&&en.res[k])||0; if(v>=30) high.push(map[k]); } return high.length?`<div class="rnote">${high.join('、')}元素抗性较高。</div>`:''; }
function enemyInfo(en){ const cs=combatState; const tierTxt = en.tier==='elite'?'精英':(en.tier==='boss'?'boss':'普通'); const tabs=`<div class="infotabs"><button class="infotab ${cs.enemyPage===0?'on':''}" onclick="switchEnemyPage(0)">属性</button><button class="infotab ${cs.enemyPage===1?'on':''}" onclick="switchEnemyPage(1)">详细技能</button></div>`; if(cs.enemyPage===1) return tabs+enemySkillsHTML(en); return `${tabs}<b>${en.name}</b>（${en.icon}）<span class="cat ${en.tier==='elite'?'support':'attack'}">${tierTxt}</span><br>攻击 ${en.atk} · 生命 ${Math.round(en.hp)}/${en.maxHp} · 防御 ${en.defv}<br>${enemyIntent(en)}<br>${resAdvice(en)}<div class="sec">状态</div>${statusBarHTML(en.statuses,null)}`; }
function enemySkillsHTML(en){ const moveTxt=(en.def.skills||[]).filter(s=>s.kind==='move').map(s=>`<div class="eskill"><b>${s.name}</b>（移动）<br>${s.desc}</div>`).join(''); const skillTxt=(en.def.skills||[]).filter(s=>s.kind!=='move').map(s=>`<div class="eskill"><b>${s.name}</b>（${s.kind==='attack'?'攻击':'辅助'}）<br>${terms(s.desc)}</div>`).join(''); const passTxt=(en.def.passives||[]).map(s=>`<div class="eskill"><b>${s.name}</b>（天赋）<br>${terms(s.desc)}</div>`).join(''); return `<b>${en.name}</b> 的技能 / 特殊效果：${passTxt}${moveTxt}${skillTxt||'暂无'}`; }
function enemyIntent(en){ if(!en) return ''; const sk=en.def.skills||[]; if(hasP(en,'patrol') && en.hp>=en.maxHp) return '意图：移动（巡逻）'; const parts=[]; if(sk.some(s=>s.kind==='attack')) parts.push('攻击'); if(sk.some(s=>s.kind==='support')){ const sup=sk.find(s=>s.kind==='support'); parts.push((sup.target==='self'||sup.healPct)?'强化自身':'施加削弱'); } if(en.def.passives&&en.def.passives.some(p=>p.id==='runaway')) parts.push('逃跑'); if(!parts.length) parts.push('移动'); return `意图：${parts.join('/')}`; }
window.switchEnemyPage=function(p){ if(combatState){ combatState.enemyPage=p; updateCombatInfo(); } };
function endCombat(victory, resultTxt){ const cs=combatState; const [ex,ey]=cs.entryCell.split(',').map(Number); G.px=ex; G.py=ey; G.hero.hp=Math.max(1,Math.round(cs.hero.hp||1)); G.hero.facing='up'; const all=[...cs.enemies,...cs.defeated]; combatState=null; persistRare(all, victory); const e=G.map.cells[ey*G.map.n+ex]; if(e.content&&e.content.type==='battle'){ e.content={type:'empty'}; } switchMode('story'); prompt(''); renderMap(); refreshHUD(); renderIconbar();
  const lines=[]; if(victory){ grantVictoryRewards(all, lines); } if(resultTxt) lines.push(resultTxt); if(!lines.length) lines.push(victory?'战斗获得胜利。':'战斗结束。');
  const title = victory ? '战斗胜利' : (resultTxt&&resultTxt.indexOf('逃跑')>=0 ? '逃跑成功' : '战斗结束');
  showCombatEndPopup(title, lines);
}
function showCombatEndPopup(title, lines, thenGameOver){ openModal(title, `<div style="text-align:center;min-width:220px"><p style="font-size:17px;font-weight:bold;margin-bottom:12px">${title}！</p><button class="mbtn" id="ceConfirm">确认</button></div>`, 'small'); const btn=document.getElementById('ceConfirm'); if(btn) btn.onclick=()=>{ closeModal(); clearLog(); for(const l of lines) log(l); refreshHUD(); if(thenGameOver) showGameOver(); }; }
function grantRewardItems(en,rw,parts){
  if(rw.fruitByHp){ let got=0; const tr=rw.fruitByHp; for(let i=0;i<tr.length;i++){ if((en.hp||0) < tr[i]) got=i+1; } if(got>0){ G.inventory.fruit=(G.inventory.fruit||0)+got; parts.push(`果子×${got}`); } if((en.hp||0)<=0 && rw.bonusItems){ for(const k in rw.bonusItems){ G.inventory[k]=(G.inventory[k]||0)+rw.bonusItems[k]; parts.push(`${RES_ZH[k]}×${rw.bonusItems[k]}`); } } return; }
  if(rw.items){ for(const k in rw.items){ G.inventory[k]=(G.inventory[k]||0)+rw.items[k]; parts.push(`${RES_ZH[k]}×${rw.items[k]}`); } }
  if(rw.rate){ for(const k in rw.rate){ if(k!=='prob' && Math.random()<(rw.rate.prob||1)){ G.inventory[k]=(G.inventory[k]||0)+rw.rate[k]; parts.push(`${RES_ZH[k]}×${rw.rate[k]}`); } } }
  if(rw.coin5 && Math.random()<0.5){ G.inventory.coin+=5; parts.push('金币×5'); }
}
function grantRewardAttr(en,rw,parts){
  if(rw.fruitByHp && (en.hp||0)>0) return;
  const howMany = rw.doubleUp?2:1;
  const choices = en.tier==='elite'?3:2;
  for(let i=0;i<howMany;i++){ const pick=Math.floor(Math.random()*choices); if(pick===0){ G.hero.atk+=1; parts.push('属性升级：攻击+1'); } else if(pick===1){ G.hero.maxHp+=5; parts.push('属性升级：最大生命+5'); } else { G.hero.def+=1; parts.push('属性升级：防御+1'); } }
}
function grantVictoryRewards(enemies, outParts){
  for(const en of (enemies||[])){ if(en.fromSwarm||en.fromPack) continue; const rw=en.def.reward; if(!rw) continue; const parts=[]; grantRewardItems(en,rw,parts); grantRewardAttr(en,rw,parts); if(parts.length) outParts.push(parts.join('，')); }
  if(G && G.team && G.team.indexOf('xiayang')>=0){ const cR=getChar('xiayang'); const cur=cR.passives.find(p=>p.id==='curious'); if(cur){ const extra=[]; if(Math.random()<0.3){ for(const en of (enemies||[])){ if(en.fromSwarm||en.fromPack) continue; const rw=en.def.reward; if(rw) grantRewardItems(en,rw,extra); } } if(Math.random()<0.5){ G.inventory.coin=(G.inventory.coin||0)+1; extra.push('金币×1'); } if(extra.length) outParts.push('【好奇心】额外获得：'+extra.join('，')); } }
}
function endCombatByDefeat(){ const cs=combatState; const enemy=cs.enemies[0]; const pen=(enemy&&enemy.healthPenalty)||0; G.hero.health=Math.max(0,G.hero.health-pen); G.hero.hp=1; const list=cs.enemies.slice(); combatState=null; persistRare(list,false); const [ex,ey]=cs.entryCell.split(',').map(Number); G.px=ex; G.py=ey; const entry=G.map.cells[ey*G.map.n+ex]; if(entry&&entry.content&&entry.content.type==='battle'){ entry.content={type:'empty'}; } switchMode('story'); prompt(''); renderMap(); refreshHUD(); renderIconbar(); showCombatEndPopup('战斗失败', [`战斗失败，健康值 -${pen}。`], G.hero.health<=0); }