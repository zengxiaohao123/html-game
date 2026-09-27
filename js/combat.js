/* ============================================================
   js/combat.js —— 批次 1：按新规格分层状态机的战斗核心（IIFE 结构）
   对外接口（裸全局，和旧代码完全兼容）：
     startCombat(cell) / castSkill(charKey, manual, slot) / combatMove(dx,dy)
     tryFlee() / selectSkill(charKey, skillId) / updateCombatUI()
     renderCombatMap() / combatCellClick(x,y)
     charAtk(k) / charDef(k) / charCritRate(k)
   内部同步：裸全局 `combatState` = 内部 `_cs`，供 main.js / explore.js 的守卫判断
   依赖：rules.js / reactions.js / data.js（getChar / ENEMIES 等裸全局）/ ui.js（log / switchMode / refreshHUD / renderMap / qs）
   ============================================================ */
"use strict";

/* ============================================================
   跨文件共享工具函数（由 main.js / event.js / explore.js / ui.js 调用）
   这些在旧 combat.js.bak 里也存在，我完全重写 combat.js 时丢失了。
   为避免散落到多个文件，集中放在这里（IIFE 外，裸全局）。
   天赋系统已删除，这些函数现在做简化兜底：
   - heroDisplayMaxHp → 主角 base.maxHp + 永久物品/队友加成
   - entryLevel → 现在只有羁绊影响（简化返回 G.bonds[key].level || 1）
   - vTier / tierValue → 旧天赋 scal 数值计算
   ============================================================ */
function vTier(passive, field, lv){
  if(!passive || !passive.scal) return 0;
  const f = passive.scal[field]; if(!f) return 0;
  const base = f.base || 0;
  const grow = f.grow || 0;
  const n = lv || 1;
  const val = base + grow*(n-1);
  return Math.round(f.pct ? val : val);
}
function tierValue(p, lv, field){ return vTier(p, field, lv); }
function entryLevel(charKey, passive){
  if(!window.G || !G.bonds) return 1;
  const bond = G.bonds[charKey];
  return bond ? bond.level : 1;
}
function heroDisplayMaxHp(){
  if(!window.G) return 100;
  let m = G.hero?.maxHp ?? 100;
  const pro = getChar('pro');
  if(pro?.passives) for(const p of pro.passives){
    if(p.id === 'cooking') m += 100;  // 陆悠悠：烹饪天赋
  }
  // 永久物品加成（简化）
  if(G.inventory){
    const inv = G.inventory;
    const bonus = (inv.heart || 0) * 20;
    m += bonus;
  }
  return Math.max(m, 100);
}
function heroDodgeRate(){
  if(!G || !G.team || !G.team.includes('luyouyou')) return 0;
  const fl = getChar('luyouyou')?.passives?.find(p=>p.id==='dance');
  return fl ? vTier(fl, 'dodge', entryLevel('luyouyou', fl)) : 0;
}
function totalHeroDefense(){
  return G?.hero?.def ?? 0;
}
function heroDisplayAtk(){ return charAtk('pro'); }
function heroDisplayDef(){ return totalHeroDefense(); }
function baseCritRate(k){ return 0.05 * 100; }
function charBaseAtk(k){
  if(k==='pro') return G.hero?.atk ?? 10;
  return getChar(k)?.base?.atk ?? 35;
}

/* IIFE 战斗核心开始 */
(function(){
let _cs = null;
function _sync(){ combatState = _cs; }  // 同步给 main.js / explore.js 的裸全局

/* ─────────────────────────────────────────────────────────────
   § 工具：角色/敌人属性获取
   ───────────────────────────────────────────────────────────── */
window.charAtk = function(k){
  // 批次 1：简化，直接取 base.atk（后期可叠加物品/天赋 buff）
  const c = getChar(k);
  if(!c) return 10;
  return c.base?.atk ?? 10;
};
window.charDef = function(k){
  const c = getChar(k);
  if(!c) return 5;
  return c.base?.def ?? 5;
};
window.charCritRate = function(k){ return 0.05; };  // 批次 1 简化

/* ─────────────────────────────────────────────────────────────
   § 入口：进入战斗
   ───────────────────────────────────────────────────────────── */
window.startCombat = function(targetCell){
  if(typeof window.rules !== 'object' || typeof window.reactions !== 'object'){
    log('[内部] rules.js / reactions.js 未加载'); return;
  }
  if(!getChar('pro')){ log('[内部] 未找到主角角色定义'); return; }

  const map = G.map;
  const enemies = _spawnEnemies(targetCell);
  const team = (G.team || ['pro']).filter(k => getChar(k));

  _cs = {
    phase: 'roundStart',
    turn: 0,
    mapCopy: JSON.parse(JSON.stringify(map)),
    startPos: { x: G.px, y: G.py },
    startFacing: G.hero?.facing || 'up',

    entities: {},
    enemiesRef: [],   // 按行动顺序的敌人数组

    // 回合内标记
    nodeTriggered: {},
    usedSkill: {},
    actionCount: 0,

    // UI 状态
    currentChar: 'pro',
    ally: {},          // 旧结构：ally[charKey] = { selSkill }

    // 阶段控制
    zones: [],
    realms: [],
    roundDone: false,
  };
  _sync();

  // 构建友方实体
  for(const key of team){
    _cs.entities[key] = _buildAllyEntity(key, G.px, G.py);
    _cs.ally[key] = { selSkill: null };
  }
  // 构建敌方实体
  enemies.forEach((en, i) => {
    const id = 'enemy_' + en.key + '_' + i;
    _cs.entities[id] = _buildEnemyEntity(id, en.key, en.x, en.y);
    _cs.enemiesRef.push(_cs.entities[id]);
  });

  switchMode('combat');
  log('进入战斗。');
  _enterRound();
};

function _spawnEnemies(targetCell){
  const pool = Object.keys(ENEMIES).filter(k => ENEMIES[k].tier === 'ordinary');
  const n = Math.min(3, pool.length);
  const out = [];
  const candidates = [];
  const cx = targetCell.x, cy = targetCell.y;
  for(let dx=-2; dx<=2; dx++) for(let dy=-2; dy<=2; dy++){
    if(Math.abs(dx)+Math.abs(dy) < 2) continue;   // 至少 2 格远
    const x=cx+dx, y=cy+dy;
    if(y<0||y>=G.map.n||x<0||x>=G.map.n) continue;
    const c = G.map.cells[y*G.map.n+x];
    if(c && c.terrain!=='void' && c.terrain!=='obstacle') candidates.push([x,y]);
  }
  candidates.sort(()=>Math.random()-0.5);
  for(let i=0; i<n; i++){
    const key = pool[Math.floor(Math.random()*pool.length)];
    if(candidates[i]) out.push({ key, x: candidates[i][0], y: candidates[i][1] });
  }
  // 保底至少 2 个
  while(out.length < 2){
    const key = pool[Math.floor(Math.random()*pool.length)];
    out.push({ key, x: targetCell.x+3+out.length, y: targetCell.y+3+out.length });
  }
  return out;
}

function _buildAllyEntity(key, x, y){
  const c = getChar(key);
  return {
    key, id: key, faction: 'ally',
    x, y, facing: 'down',
    dead: false,
    hp: G.hero?.hp ?? c.base.hp ?? c.base.maxHp ?? 100,
    maxHp: c.base.maxHp ?? 100,
    atk: charAtk(key),
    def: charDef(key),
    critRate: charCritRate(key),
    buffs: [], debuffs: [],
  };
}

function _buildEnemyEntity(id, key, x, y){
  const base = ENEMIES[key];
  return {
    key, id, faction: 'enemy',
    x, y, facing: 'up',
    dead: false,
    hp: base.maxHp || base.hp || 100,
    maxHp: base.maxHp || base.hp || 100,
    atk: base.atk || 10, def: base.def || 0,
    critRate: 0.05,
    resist: base.res || { physical:0, fire:0, water:0, grass:0, thunder:0, ice:0, wind:0, rock:0 },
    buffs: [], debuffs: [],
  };
}

/* ─────────────────────────────────────────────────────────────
   § 回合状态机
   ───────────────────────────────────────────────────────────── */
function _enterRound(){
  _cs.turn += 1;
  _cs.nodeTriggered = {};
  _cs.usedSkill = {};
  _cs.actionCount = 0;
  _cs.roundDone = false;
  _cs.phase = 'playerManual';
  _sync();
  log(`——— 第 ${_cs.turn} 回合 ———`);
  updateCombatUI();
  renderCombatMap();
}

function _switchPhase(phase){
  _cs.phase = phase;
  _sync();
  switch(phase){
    case 'playerManual': return;
    case 'playerEnd': _phaseAutoSkills(); break;
    case 'autoSkills': _phaseSummons(); break;
    case 'summons': _phaseNeutral(); break;
    case 'neutral': _phaseEnemy(); break;
    case 'enemy': _phaseRoundEnd(); break;
    case 'roundEnd': _phaseRoundEndCheck(); break;
  }
}

function _phaseAutoSkills(){ _switchPhase('playerEnd'); }
function _phaseSummons(){ _switchPhase('playerEnd'); }
function _phaseNeutral(){ _switchPhase('playerEnd'); }

function _phaseEnemy(){
  const alive = _cs.enemiesRef.filter(e => !e.dead);
  for(const enemy of alive){
    if(_cs.roundDone) return;
    _enemyAct(enemy);
    updateCombatUI(); renderCombatMap();
    if(_cs.roundDone) return;
  }
  _switchPhase('roundEnd');
}

function _phaseRoundEndCheck(){
  if(_allEnemiesDead()){ _endCombat('victory'); return; }
  if(_cs.entities.pro?.hp <= 0){ _endCombat('defeat'); return; }
  _enterRound();
}

/* ─────────────────────────────────────────────────────────────
   § 行动节点 / 硬控制
   ───────────────────────────────────────────────────────────── */
function _triggerNode(entityId){
  if(!_cs || _cs.nodeTriggered[entityId]) return;
  const ent = _cs.entities[entityId];
  if(!ent || ent.dead) return;
  _cs.nodeTriggered[entityId] = true;
  ent.shield = (ent.shield || 0) + (ent.def || 0);
  ent.buffs = ent.buffs.filter(b => { b.duration -= 1; return b.duration > 0; });
  ent.debuffs = ent.debuffs.filter(b => { b.duration -= 1; return b.duration > 0; });
}
function _hasHardControl(ent){
  if(!ent) return false;
  return ent.debuffs.some(d => d.kind === 'freeze' || d.kind === 'stun' || d.kind === 'bind');
}

/* ─────────────────────────────────────────────────────────────
   § 敌方 AI
   ───────────────────────────────────────────────────────────── */
function _enemyAct(enemy){
  _triggerNode(enemy.id);
  if(_hasHardControl(enemy)){ log(`${_zhName(enemy.key)} 被硬控，无法行动。`); return; }
  const pro = _cs.entities.pro;
  if(!pro || pro.dead) return;

  const dist = Math.abs(enemy.x-pro.x) + Math.abs(enemy.y-pro.y);
  if(dist > 1){
    const [dx, dy] = _moveTowards(enemy, pro);
    const nx = enemy.x+dx, ny = enemy.y+dy;
    if(_inBounds(nx, ny) && !_hasEntityAt(nx, ny)){
      enemy.facing = (dx<0?'left':dx>0?'right':dy<0?'up':'down');
      enemy.x = nx; enemy.y = ny;
    }
  }
  // 普攻
  const newDist = Math.abs(enemy.x-pro.x) + Math.abs(enemy.y-pro.y);
  if(newDist === 1){
    _enemyBasicAttack(enemy, pro);
  }
}
function _moveTowards(f, t){
  if(t.x !== f.x) return [Math.sign(t.x - f.x), 0];
  return [0, Math.sign(t.y - f.y)];
}
function _hasEntityAt(x,y){
  return Object.values(_cs.entities).some(e => !e.dead && e.x===x && e.y===y);
}
function _inBounds(x,y){ return x>=0 && y>=0 && x<_cs.mapCopy.n && y<_cs.mapCopy.n; }

function _enemyBasicAttack(enemy, pro){
  // 批次 1：非火焰史莱姆普攻带元素附着
  const elem = (enemy.key === 'fireSlime') ? 'fire' : null;
  if(elem){
    _applyAura(pro.x, pro.y, elem, enemy.id);
    _dealElementalDamage(pro, elem, 1, enemy.id);
  } else {
    _dealPhysicalDamage(pro, 1, enemy.id);
  }
}

/* ─────────────────────────────────────────────────────────────
   § 对外：castSkill / selectSkill / combatMove / tryFlee
   ───────────────────────────────────────────────────────────── */
window.castSkill = function(charKey, manual, slot){
  if(!_cs || _cs.phase !== 'playerManual') return;
  if(!charKey) charKey = _cs.currentChar || 'pro';
  const ownerEnt = _cs.entities[charKey];
  if(!ownerEnt || ownerEnt.dead){ log('该角色已阵亡。'); return; }
  if(_hasHardControl(ownerEnt)){ log(`被硬控，无法释放技能。`); return; }
  if(_cs.usedSkill[charKey]){ log(`本回合已用过技能。`); return; }

  // 找到选中的技能（优先 slot，否则看 ally[charKey].selSkill）
  const selId = slot?.skillId || _cs.ally[charKey]?.selSkill;
  if(!selId) { log('未选中技能。'); return; }
  if(selId === 'flee'){ tryFlee(); return; }
  const charData = getChar(charKey);
  const skill = charData.skills.find(s => s.id === selId);
  if(!skill){ log(`技能未找到: ${selId}`); return; }

  _cs.actionCount += 1;
  if(!_cs.nodeTriggered[charKey]) _triggerNode(charKey);

  _resolveSkill(skill, charKey, ownerEnt);

  _cs.usedSkill[charKey] = true;
  _cs.ally[charKey].selSkill = null;  // 释放后清空选中
  _sync();

  updateCombatUI(); renderCombatMap();
};

window.selectSkill = function(charKey, skillId){
  if(!_cs) return;
  if(!_cs.ally[charKey]) _cs.ally[charKey] = {};
  _cs.ally[charKey].selSkill = skillId;
  updateCombatUI();
};

window.combatMove = function(dx, dy){
  if(!_cs || _cs.phase !== 'playerManual') return;
  const pro = _cs.entities.pro;
  if(_hasHardControl(pro)){ return; } // 硬控：按下了，效果空转
  _cs.actionCount += 1;
  const dirName = (dx<0?'left':dx>0?'right':dy<0?'up':'down');
  pro.facing = dirName;
  const nx = pro.x+dx, ny = pro.y+dy;
  const map = _cs.mapCopy;
  if(ny>=0 && ny<map.n && nx>=0 && nx<map.n){
    const c = map.cells[ny*map.n+nx];
    if(c && c.terrain !== 'void' && c.terrain !== 'obstacle' && !_hasEntityAt(nx, ny)){
      pro.x = nx; pro.y = ny;
      for(const k of Object.keys(_cs.entities)){
        if(k!=='pro' && _cs.entities[k].faction==='ally' && !_cs.entities[k].dead){
          _cs.entities[k].x = nx; _cs.entities[k].y = ny; _cs.entities[k].facing = dirName;
        }
      }
    }
  }
  _sync();
  updateCombatUI(); renderCombatMap();
  _switchPhase('playerEnd');
};

window.tryFlee = function(){
  if(!_cs) return;
  if(_cs.actionCount >= 1){
    log('至少行动过 1 次，无法逃跑。'); return;
  }
  if(Math.random() < 0.3){
    log('逃跑成功！');
    _cs.roundDone = true;
    _cs.roundDone = 'flee';
    _endCombat('flee');
  } else {
    _cs.actionCount += 1;
    _cs.usedSkill['pro'] = true;
    log('逃跑失败，无法再行动。');
    updateCombatUI();
    _switchPhase('playerEnd');
  }
};

window.combatCellClick = function(x,y){
  // 批次 1：点地块 = 显示详情 + 如果是敌人则选中
  if(!_cs) return;
  const ents = Object.values(_cs.entities).filter(e => !e.dead && e.x===x && e.y===y);
  const enemy = ents.find(e => e.faction==='enemy');
  if(enemy){
    if(!_cs.ally.pro) _cs.ally.pro = {};
    log(`选中敌人：${_zhName(enemy.key)} HP ${enemy.hp}/${enemy.maxHp}`);
  }
  renderCombatMap();
};

/* ─────────────────────────────────────────────────────────────
   § 技能释放核心
   ───────────────────────────────────────────────────────────── */
function _resolveSkill(skill, ownerKey, ownerEnt){
  // 把 data.js 里技能的 target 字段（如 'front2'）映射成 rules.js 的 range.type
  const rangeType = skill.target || 'self';
  const ownerPos = [ownerEnt.x, ownerEnt.y];

  const targeting = window.rules.resolveTargeting(
    rangeType, ownerPos, ownerEnt.facing,
    _cs.mapCopy, _cs.entities,
    skill.ruleTag || 'default',
    skill.target ? (skill.kind==='active'||skill.kind==='auto' ? 'enemy' : 'all') : 'self'
  );

  // 1. 施加元素附着（skill 里 applyElem 字段有值）
  const elem = skill.applyElem || (skill.type && skill.type !== 'physical' ? skill.type : null);
  if(elem){
    for(const [x,y] of targeting.attachCells){
      _applyAura(x, y, elem, ownerKey);
    }
  }
  // 2. 造成伤害
  const mult = skill.mult || 1;
  for(const ent of targeting.damageEntities){
    if(ent.dead) continue;
    if(elem){
      _dealElementalDamage(ent, elem, mult, ownerKey);
    } else {
      _dealPhysicalDamage(ent, mult, ownerKey);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   § 伤害结算
   ───────────────────────────────────────────────────────────── */
function _dealPhysicalDamage(target, mult, attackerId){
  const atk = _getAtk(attackerId);
  let raw = Math.max(1, Math.round(atk * mult - (target.def || 0) * 0.5));
  const crit = Math.random() < _getCritRate(attackerId);
  if(crit) raw = Math.round(raw * 2);
  _applyDamage(target, raw, 'physical');
  log(`${_zhName(target.key)} 受到 ${crit?'暴击 ':''}${raw} 点物理伤害${target.dead?'，阵亡！':''}`);
}

function _dealElementalDamage(target, elem, mult, attackerId){
  const atk = _getAtk(attackerId);
  let raw = Math.max(1, Math.round(atk * mult - (target.def || 0) * 0.5));
  let resist = (target.resist && target.resist[elem]) || 0;
  resist = Math.min(0.9, Math.max(-1, resist));
  raw = Math.round(raw * (1 - resist));
  if(raw < 1) raw = 1;
  const crit = Math.random() < _getCritRate(attackerId);
  if(crit) raw = Math.round(raw * 2);
  raw = _consumeReactionBuff(raw, elem, attackerId);
  _applyDamage(target, raw, elem);
  log(`${_zhName(target.key)} 受到 ${crit?'暴击 ':''}${raw} 点${_elemName(elem)}伤害${target.dead?'，阵亡！':''}`);
}

function _applyDamage(target, amount, elem){
  if(target.shield && target.shield > 0){
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed; amount -= absorbed;
  }
  target.hp = Math.max(0, target.hp - amount);
  if(target.hp <= 0 && !target.dead){
    target.dead = true;
    if(target.key === 'pro' && !target.id.includes('enemy')){
      G.hero.hp = 0;
    }
  }
  if((elem === 'fire' || elem === 'thunder') && !target.dead){
    const fi = target.debuffs.findIndex(d => d.kind === 'freeze');
    if(fi >= 0){
      target.debuffs.splice(fi, 1);
      target.buffs.push({ kind:'immuneFreeze', token:'immuneFreeze', duration:3, infiniteTimer:true });
      log(`${_zhName(target.key)} 受火/雷伤害，冻结提前结束，获得【免疫冻结·3回合】。`);
    }
  }
}

function _consumeReactionBuff(baseDmg, elem, attackerId){
  const ent = _cs.entities[attackerId];
  if(!ent) return baseDmg;
  const buffs = ent.buffs;
  const consume = (token, elemMatch, multPct, logTag) => {
    if(elem === elemMatch){
      const layers = buffs.filter(b => b.token === token).length;
      if(layers > 0){
        const mult = 1 + multPct * layers;
        baseDmg = Math.round(baseDmg * mult);
        log(`消耗【${logTag}】×${layers}，本次${_elemName(elem)}伤害 +${multPct*100*layers}%。`);
        ent.buffs = buffs.filter(b => b.token !== token);
      }
    }
  };
  consume('evapFire', 'fire', 0.25, '蒸发·火');
  consume('evapWater', 'water', 0.5,  '蒸发·水');
  consume('meltIce',  'ice',  0.25, '融化·冰');
  consume('meltFire', 'fire', 0.5,  '融化·火');
  return baseDmg;
}

function _dealOverload(trigger, cell){
  const atk = _getAtk(trigger.id);
  const ents = _getAreaEntities(cell[0], cell[1], 2);
  for(const e of ents){
    if(e.faction === trigger.faction || e.dead) continue;
    _dealElementalDamage(e, 'fire', 0.5, trigger.id);
  }
}

function _dealDiffuse(trigger, origin, elem){
  const order = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const chainQueue = [];
  log(`——— 扩散起点 (${origin[0]+1},${origin[1]+1}) 处理完毕 ———`);
  for(const [dx,dy] of order){
    const x = origin[0]+dx, y = origin[1]+dy;
    if(!_inBounds(x,y)) continue;
    const c = _cs.mapCopy.cells[y*_cs.mapCopy.n+x];
    if(c.terrain === 'void') continue;
    if(c.attach && c.attach !== elem){
      if(window.reactions.willReact(c.attach, elem)){
        chainQueue.push({ cell:[x,y], old:c.attach, new:elem });
      } else {
        c.attach = elem;
      }
    } else {
      c.attach = elem;
    }
    const ents = _getAreaEntities(x, y, 0);
    for(const e of ents){
      _dealElementalDamage(e, elem, 0.3, trigger.id);
    }
  }
  while(chainQueue.length){
    const q = chainQueue.shift();
    _executeReaction(q.cell, q.old, q.new, trigger.id);
  }
}

/* ─────────────────────────────────────────────────────────────
   § 元素反应
   ───────────────────────────────────────────────────────────── */
function _applyAura(x, y, elem, triggerEntityId){
  if(!_inBounds(x,y)) return;
  const c = _cs.mapCopy.cells[y*_cs.mapCopy.n+x];
  if(!c || c.terrain === 'void') return;
  if(!c.attach){ c.attach = elem; return; }
  if(c.attach === elem){ return; }
  _executeReaction([x,y], c.attach, elem, triggerEntityId);
}

function _executeReaction(cell, oldElem, newElem, triggerEntityId){
  const c = _cs.mapCopy.cells[cell[1]*_cs.mapCopy.n+cell[0]];
  const rx = window.reactions.lookupReaction(oldElem, newElem);
  if(!rx){ c.attach = newElem; return; }
  c.attach = null;
  log(`反应：${_elemName(oldElem)} + ${_elemName(newElem)} → ${rx.desc}`);
  const trigger = _cs.entities[triggerEntityId] || { id: triggerEntityId, faction: 'ally' };
  const triggerEnt = _cs.entities[triggerEntityId];

  switch(rx.kind){
    case 'evap':
    case 'melt': {
      if(triggerEnt){
        const layers = triggerEnt.buffs.filter(b => b.token === rx.token).length;
        if(layers < 2){
          triggerEnt.buffs.push({ kind: rx.kind, token: rx.token, duration: Infinity, infiniteTimer:true });
          log(`${_zhName(trigger.key)} 获得 1 层【${rx.token}】。`);
        }
      }
      break;
    }
    case 'burn':
    case 'electrocute':
    case 'supercon': {
      _cs.zones.push({ id:'z_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), type: rx.zoneType, cell, duration: rx.duration, kind:'reaction', triggerEntityId });
      log(`${rx.desc}结界生成于 (${cell[0]+1},${cell[1]+1})。`);
      if(rx.kind === 'electrocute'){
        const ents = _getAreaEntities(cell[0], cell[1], 2).filter(e => e.faction==='enemy' && !e.dead);
        for(const e of ents) _dealElementalDamage(e, 'thunder', 0.25, triggerEntityId);
      }
      break;
    }
    case 'overload': _dealOverload(trigger, cell); break;
    case 'diffuse': _dealDiffuse(trigger, cell, rx.element); break;
    case 'crystal': {
      let targetEnt = triggerEnt;
      if(targetEnt && targetEnt.faction === 'ally' && targetEnt.key !== 'pro') targetEnt = _cs.entities.pro;
      if(!targetEnt) break;
      const maxHp = targetEnt.maxHp || 100;
      const sh = Math.max(10, Math.round(maxHp * 0.08));
      targetEnt.shield = (targetEnt.shield || 0) + sh;
      log(`${_zhName(targetEnt.key)} 获得 ${sh} 点护盾。`);
      break;
    }
    case 'bloom': {
      const slot = cell;
      const id = 'slimeGrass_'+Date.now()+Math.random().toString(36).slice(2,6);
      _cs.entities[id] = {
        key:'slimeGrass', id, faction: trigger.faction,
        x:slot[0], y:slot[1], facing:'down', dead:false,
        hp:10, maxHp:10, atk:3, def:0, critRate:0.05,
        resist:{ physical:0, fire:0, water:0, grass:0, thunder:0, ice:0, wind:0, rock:0 },
        buffs:[], debuffs:[],
      };
      log(`绽放：生成草史莱姆于 (${slot[0]+1},${slot[1]+1})。`);
      break;
    }
    case 'freeze': {
      const entsOnCell = Object.values(_cs.entities).filter(e => !e.dead && e.x===cell[0] && e.y===cell[1]);
      for(const e of entsOnCell){
        e.debuffs.push({ kind:'freeze', token:'freeze', duration: rx.duration });
        log(`${_zhName(e.key)} 获得【冻结·${rx.duration}回合】。`);
      }
      break;
    }
    case 'intensify': {
      const faction = triggerEnt?.faction || 'ally';
      for(const e of Object.values(_cs.entities)){
        if(e.dead || e.faction !== faction) continue;
        const cur = e.buffs.find(b => b.token === 'intensify');
        if(cur){ cur.stacks = Math.min(10, cur.stacks + rx.stacks); }
        else { e.buffs.push({ kind:'intensify', token:'intensify', duration: Infinity, infiniteTimer:true, stacks: rx.stacks, maxStacks:10, dmgBoost: rx.dmgBoost }); }
      }
      log(`激化：${faction==='ally'?'我方':'敌方'}阵营各单位获得【激化】×${rx.stacks}。`);
      break;
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   § 辅助
   ───────────────────────────────────────────────────────────── */
function _getAreaEntities(x, y, manhattanRadius){
  return Object.values(_cs.entities).filter(e => !e.dead && Math.abs(e.x-x)+Math.abs(e.y-y) <= manhattanRadius);
}
function _getAtk(id){ return (_cs.entities[id]?.atk) || 10; }
function _getCritRate(id){ return (_cs.entities[id]?.critRate) || 0.05; }
function _zhName(key){
  if(ENEMIES[key]) return ENEMIES[key].name;
  const c = getChar(key); if(c) return c.name;
  return key;
}
function _elemName(elem){
  const m = { fire:'火', water:'水', grass:'草', thunder:'雷', ice:'冰', wind:'风', rock:'岩', physical:'物理' };
  return m[elem] || elem || '';
}
function _allEnemiesDead(){ return _cs.enemiesRef.every(e => e.dead); }

/* ─────────────────────────────────────────────────────────────
   § UI 渲染（updateCombatUI / renderCombatMap）
   ───────────────────────────────────────────────────────────── */
window.updateCombatUI = function(){
  if(!_cs) return;
  // 1. 盟友角色卡（allyBar）
  const allyBar = qs('#allyBar');
  if(allyBar){
    const chars = G.team.map(k => _cs.entities[k]).filter(Boolean);
    allyBar.innerHTML = chars.map(e => {
      const pct = Math.round(e.hp / e.maxHp * 100);
      const active = _cs.currentChar === e.key;
      const dead = e.dead;
      return `<div class="allyCard ${active?'active':''} ${dead?'dead':''}" data-key="${e.key}" onclick="combatSelectChar('${e.key}')">
        <span class="allyName">${_zhName(e.key)}</span>
        <span class="allyHp"><b>${e.hp}</b>/${e.maxHp}</span>
        <div class="allyHpBar" style="width:${pct}%"></div>
      </div>`;
    }).join('');
  }

  // 2. 主角属性（charAttrs）
  const charAttrs = qs('#charAttrs');
  const pro = _cs.entities.pro;
  if(charAttrs && pro){
    charAttrs.innerHTML = `<span>HP <b>${pro.hp}/${pro.maxHp}</b></span>
      <span>攻 <b>${pro.atk}</b></span>
      <span>防 <b>${pro.def}</b></span>
      ${pro.shield ? `<span class="shield">盾 <b>${pro.shield}</b></span>` : ''}`;
  }

  // 3. 状态栏（statusBar）—— buff/debuff
  const statusBar = qs('#statusBar');
  if(statusBar && pro){
    const allStatus = [...pro.buffs.map(b => ({kind:'b',...b})), ...pro.debuffs.map(d => ({kind:'d',...d}))];
    statusBar.innerHTML = allStatus.map(s => {
      const zh = { evapFire:'蒸发·火', evapWater:'蒸发·水', meltIce:'融化·冰', meltFire:'融化·火', freeze:'冻结', intensify:'激化', immuneFreeze:'免疫冻结' }[s.token] || (s.kind==='d'?'debuff':'buff');
      return `<span class="stchip ${s.kind==='d'?'debuff':'buff'}" data-name="${zh}">${zh}${s.duration && s.duration !== Infinity?`·${s.duration}回合`:''}</span>`;
    }).join('') || '<span class="stchip none">（无状态）</span>';
  }

  // 4. 技能列表（skillList）—— 主角的 active 技能 + 逃跑按钮
  const skillList = qs('#skillList');
  if(skillList){
    const charData = getChar('pro');
    const active = (charData.skills || []).filter(s => s.kind === 'active');
    const selectedSkillId = _cs.ally.pro?.selSkill;
    const skillHTML = active.map((s, i) => {
      const selected = selectedSkillId === s.id ? 'selected' : '';
      return `<button class="skillTag ${selected}" data-skill="${s.id}" onclick="combatSelectSkill('pro','${s.id}')">
        <span class="skKey">${i+1}</span><span class="skName">${s.name}</span>
      </button>`;
    }).join('');
    skillList.innerHTML = skillHTML + `<button class="skillTag escape" onclick="tryFlee()">逃跑</button>`;
  }

  // 5. 选中技能详情（skillDetail）
  const skillDetail = qs('#skillDetail');
  if(skillDetail){
    const selId = _cs.ally.pro?.selSkill;
    if(selId){
      const s = getChar('pro').skills.find(x => x.id === selId);
      if(s){
        const elem = s.applyElem || (s.type && s.type !== 'physical' ? _elemName(s.type) : null);
        skillDetail.innerHTML = `<div class="sd-title">${s.name}${s.cd?` · CD ${s.cd}`:''}</div>
          <div class="sd-meta">类型 ${_elemName(s.type||'physical')}${elem?` · 施加 ${_elemName(elem)} 附着`:''}${s.mult?` · 倍率 ${s.mult}`:''}</div>
          <div class="sd-desc">${s.desc || ''}</div>
          <div class="sd-hint">按 <b>Q</b> 释放</div>`;
      }
    } else {
      skillDetail.innerHTML = `<div class="sd-title">未选中技能</div>
        <div class="sd-hint">点击左侧技能 · 或按 <b>1/2/3/4</b> 选中</div>`;
    }
  }

  // 回合信息
  const rightTitle = qs('#rightTitle');
  if(rightTitle){
    const phaseZh = { playerManual:'我方行动', autoSkills:'自动技能', summons:'召唤物', neutral:'中立单位', enemy:'敌方行动', roundStart:'回合开始', roundEnd:'回合结束' }[_cs.phase] || _cs.phase;
    rightTitle.textContent = `第 ${_cs.turn} 回合 · ${phaseZh}`;
  }
};

window.renderCombatMap = function(){
  if(!_cs) return;
  const m = _cs.mapCopy;
  const grid = qs('#mapGrid');
  const cellSize = 44;
  grid.style.gridTemplateColumns = `repeat(${m.n}, ${cellSize}px)`;
  grid.innerHTML = '';

  for(let y=0; y<m.n; y++){
    for(let x=0; x<m.n; x++){
      const c = m.cells[y*m.n+x];
      const cell = document.createElement('div');
      cell.className = 'cell';
      if(c.terrain === 'obstacle') cell.classList.add('obstacle');
      else if(c.terrain === 'void') cell.classList.add('void');

      // 元素附着背景色
      if(c.attach){
        cell.style.background = _elemBg(c.attach);
        cell.classList.add('attach');
      }

      // 结界边框色
      const zone = _cs.zones.find(z => z.cell[0]===x && z.cell[1]===y);
      if(zone){
        cell.classList.add('zone');
        cell.style.outlineColor = '#ffce4d';
      }

      // 实体
      const ent = Object.values(_cs.entities).find(e => !e.dead && e.x===x && e.y===y);
      if(ent){
        cell.classList.add('hasEnt');
        if(ent.key === 'pro' && !ent.id.includes('enemy')){
          cell.classList.add('player');
          cell.classList.add('facing-'+ent.facing);
          cell.innerHTML = `<span class="entIcon proIcon">🧝</span>`;
        } else if(ent.faction === 'enemy'){
          cell.classList.add('enemy');
          cell.innerHTML = `<span class="entIcon enemyIcon">${ENEMIES[ent.key]?.icon || '👾'}</span>
            <span class="entHp entHpEnemy" style="width:${ent.hp/ent.maxHp*100}%"></span>`;
        } else if(ent.faction === 'ally'){
          cell.classList.add('ally');
          cell.innerHTML = `<span class="entIcon allyIcon">${ent.key==='xiayang'?'🔥':ent.key==='luyouyou'?'🦋':'🧝'}</span>`;
        }
      } else {
        cell.innerHTML = '';
      }

      cell.dataset.x = x; cell.dataset.y = y;
      cell.addEventListener('click', () => combatCellClick(x,y));
      grid.appendChild(cell);
    }
  }
};

function _elemBg(elem){
  const m = {
    fire:   'rgba(231, 76, 60, 0.35)',
    water:  'rgba(52, 152, 219, 0.35)',
    grass:  'rgba(46, 204, 113, 0.35)',
    thunder:'rgba(155, 89, 182, 0.35)',
    ice:    'rgba(120, 190, 255, 0.35)',
    wind:   'rgba(200, 220, 240, 0.35)',
    rock:   'rgba(160, 140, 120, 0.35)',
  };
  return m[elem] || 'rgba(200,200,200,0.2)';
}

/* 给 main.js / combatUI 按钮调用的辅助 */
window.combatSelectChar = function(key){ if(!_cs) return; _cs.currentChar = key; _sync(); updateCombatUI(); renderCombatMap(); };
window.combatSelectSkill = function(charKey, skillId){
  if(!_cs) return;
  if(!_cs.ally[charKey]) _cs.ally[charKey] = {};
  _cs.ally[charKey].selSkill = skillId;
  _sync();
  updateCombatUI();
};

/* ─────────────────────────────────────────────────────────────
   § 胜负 + 结束
   ───────────────────────────────────────────────────────────── */
function _endCombat(outcome){
  if(!_cs) return;
  _cs.roundDone = true;
  log('——— 战斗结束 ———');
  if(outcome === 'victory'){
    log('战斗胜利！');
    const coin = Math.floor(Math.random()*10 + 5);
    G.inventory.coin = (G.inventory.coin || 0) + coin;
    log(`获得金币 ×${coin}`);
  } else if(outcome === 'defeat'){
    log('战斗失败……');
    G.hero.health = Math.max(0, (G.hero.health || 50) - 10);
  } else if(outcome === 'flee'){
    log('成功逃离战斗。');
  }

  G.px = _cs.startPos.x; G.py = _cs.startPos.y;
  G.hero.facing = _cs.startFacing;
  const pro = _cs.entities.pro;
  if(pro) G.hero.hp = pro.hp;

  _cs = null; _sync();
  switchMode('explore');
  renderMap(); refreshHUD();
  log('（回到探索入口地块）');
}

})();
