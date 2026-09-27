// 战斗核心 — 批次 1 基础 + 批次 2 进阶
// 全局裸工具函数（被 main.js/ui.js/explore.js 跨文件引用）

function heroDisplayMaxHp(){ return G.hero?.maxHp ?? 100; }
function heroDisplayAtk(){ return charAtk('pro'); }
function heroDisplayDef(){ return totalHeroDefense(); }
function baseCritRate(k){ return 0.05 * 100; }
function charBaseAtk(k){
  if(k==='pro') return G.hero?.atk ?? 10;
  return getChar(k)?.base?.atk ?? 35;
}
function heroDisplayCrit(){ return Math.round(baseCritRate('pro')); }

/* 旧天赋系统已移除，做简化兜底版本 */
function heroDisplayDodge(){ return 0; }
function totalHeroDefense(){
  const base = G.hero?.def ?? 0;
  return Math.max(0, base);
}
function heroDisplaySpeed(){ return G.hero?.speed ?? 30; }
function charAtk(k){
  if(k==='pro') return Math.round(charBaseAtk('pro'));
  return Math.round(charBaseAtk(k));
}
function vTier(v){ return (v||0).toString(); }
function tierValue(t){ return Number(t)||0; }
function entryLevel(cell){ return 1; }

/* IIFE 战斗核心开始 */
(function(){
let _cs = null;
function _sync(){ window.combatState = _cs; }

/* ────────── § 工具 ────────── */
// getChar 函数已由 data.js 以全局 function 暴露，返回 PROTAGONIST/ALLIES 里的对象（带 skills[], base{} 等完整字段）
// 这里禁止同名遮蔽！
function _ent(k){ return _cs?.entities?.[k]; }
function _dist(a,b){ return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y)); }
function _inBounds(x,y){
  return _cs && x>=0 && y>=0 && x<_cs.mapW && y<_cs.mapH;
}
function _setPhase(p, opts){
  _cs.phase = p;
  _cs.phaseCtx = opts||{};
  _cs.phaseStartAt = Date.now();
  _sync();
  log(_phaseLabel(p));
}
function _phaseLabel(p){
  return { roundStart:'—— 回合开始 ——', playerManual:'☯ 手动行动', autoSkills:'⚡ 自动技能阶段', summons:'✦ 召唤物行动', neutral:'◈ 中立单位行动', enemy:'☠ 敌方行动', roundEnd:'—— 回合结束 ——', flee:'💨 逃跑' }[p] || p;
}
function _allEntities(){
  return Object.values(_cs.entities).filter(e=>e && !e.dead);
}
function _entityList(){ return _allEntities(); }

/* ────────── § 状态机驱动（批次 2：所有节点完整链） ────────── */
function _tick(dt){
  if(!_cs) return;
  if(_cs.ended){ return; }

  // 连携窗口倒计时（批次 2）
  if(_cs.linkWindow && _cs.linkWindow.open){
    const remain = 2000 - (Date.now() - _cs.linkWindow.startAt);
    _cs.linkWindow.remainMs = Math.max(0, remain);
    if(remain<=0){ _closeLinkWindow(); }
  }

  switch(_cs.phase){
    case 'roundStart':     _phaseRoundStart(); break;
    case 'autoSkills':     _phaseAutoSkills(); break;   // ★ 批次 2 新增：我方所有角色 auto skills
    case 'summons':        _phaseSummons(); break;
    case 'neutral':        _phaseNeutral(); break;
    case 'playerManual':   break;
    case 'enemy':          _phaseEnemy(); break;
    case 'roundEnd':       _phaseRoundEnd(); break;
  }
  updateCombatUI();
}

function _phaseRoundStart(){
  log(`▸ 第 ${_cs.round} 回合`);
  // 结界触发者自己的行动节点（批次 2：燃烧/感电/超导）
  _tickZonesAt('roundStart');
  _cs.readyAuto = {};
  // 我方当前角色置主动作标记
  _setPhase('autoSkills');
}

function _phaseAutoSkills(){
  // 批次 2 核心：遍历我方所有角色，执行 kind='auto' 的技能一次
  // 适配 data.js：getChar(key).skills[] 统一池子（_ensureCharDefaults 后返回的对象带全部 skills）
  if(!_cs.autoProcessed){ _cs.autoProcessed = {}; }
  let did = false;
  const team = (G.team||['pro']).slice();
  team.forEach(k => {
    if(_cs.autoProcessed[k]) return;
    const allSkills = _charAllSkills(k);  // 不过滤编入，自动技能全池扫
    const autoOne = allSkills.find(s => s.kind==='auto' && _cooldownLeft(k,s.id)===0);
    if(autoOne){
      _cs.autoProcessed[k] = true;
      did = true;
      _resolveSkillByChar(k, autoOne, 250);
    }
  });
  if(did){
    setTimeout(()=>{ if(_cs && _cs.phase==='autoSkills') _setPhase('summons'); }, 900);
  } else {
    _setPhase('summons');
  }
}

function _phaseSummons(){
  // 批次 2：召唤物 AI（entities 里 type='summon' 的自动朝最近敌方普攻）
  const summons = _allEntities().filter(e => e.type==='summon');
  if(summons.length>0){
    summons.forEach((s,i)=>{
      setTimeout(()=>_summonAI(s), i*400);
    });
    setTimeout(()=>_setPhase('neutral'), summons.length*400+500);
  } else {
    _setPhase('neutral');
  }
}

function _phaseNeutral(){
  // 批次 2：中立单位（entities 里 faction='neutral' 的）简化跳过
  // 此处留作 neutral 实体扩展点
  _setPhase('playerManual', { canMove:true, canSkill:true });
  _openLinkWindow();  // 批次 2：连携窗口（auto+召唤+中立 都跑完了）
}

function _phaseEnemy(){
  // 批次 2：敌方 AI（每个间隔 400ms 行动，召唤物已在 summons 阶段）
  const enemies = _allEntities().filter(e => e.faction==='enemy');
  if(enemies.length===0){
    _cs.ended = true; _onWin(); return;
  }
  enemies.forEach((e,i)=>setTimeout(()=>{
    if(!_cs || _cs.ended || e.dead) return;
    _enemyAI(e);
  }, i*400));
  setTimeout(()=>{
    if(!_cs || _cs.ended) return;
    _cs.round++;
    _setPhase('roundEnd');
  }, enemies.length*400+500);
}

function _phaseRoundEnd(){
  _tickZonesAt('roundEnd');
  _tickAttachDuration();
  _tickZoneDuration();
  _setPhase('roundStart');
}

/* ────────── § 召唤物 AI（批次 2） ────────── */
function _summonAI(s){
  if(!_cs || s.dead) return;
  // 朝最近敌方 1 格内 → 普攻
  const enemies = _allEntities().filter(e => e.faction==='enemy');
  if(enemies.length===0) return;
  let target = enemies[0], minD = 999;
  enemies.forEach(e => { const d = _dist(s,e); if(d<minD){ minD=d; target=e; } });
  if(minD<=1){
    _applyDamage(s, target, Math.round((s.atk||10) * 0.8), 'physical');
  } else {
    _moveToward(s, target);
  }
  updateCombatUI();
}
function _moveToward(src, dst){
  const dx = Math.sign(dst.x - src.x);
  const dy = Math.sign(dst.y - src.y);
  const tryMoves = [[dx,0],[0,dy],[dx,dy]];
  for(const [mx,my] of tryMoves){
    if(mx===0 && my===0) continue;
    const nx = src.x+mx, ny = src.y+my;
    if(_inBounds(nx,ny) && !_cellHasEntity(nx,ny)){
      src.x = nx; src.y = ny; return true;
    }
  }
  return false;
}

/* ────────── § 敌方 AI ────────── */
function _enemyAI(e){
  if(!_cs || e.dead) return;
  const prot = _ent('pro');
  if(!prot) return;
  const d = _dist(e, prot);
  // 硬控制 → 跳过（批次 2：硬控制效果贯穿敌方行动阶段本身）
  if(e.hardControl){
    log(`${e.name} 处于硬控制，跳过行动。`);
    return;
  }
  // 普攻：射程=1 或有 range 字段
  const atkRange = (e.atkRange||1);
  if(d<=atkRange){
    let elem = e.elem || 'physical';
    const dmg = Math.round(e.atk * 0.8);
    _applyDamage(e, prot, dmg, elem);
  } else {
    _moveToward(e, prot);
  }
}

/* ────────── § 伤害/反应/附着 ────────── */
function _applyDamage(attacker, target, dmg, elem){
  if(!target || target.dead) return;
  const effective = Math.max(1, dmg - (target.def||0));
  target.hp -= effective;
  log(`${attacker.name||attacker.key} → ${target.name||target.key}：${effective} 点${elem==='physical'?'物理':elem}伤害`);
  if(target.hp<=0){
    target.hp = 0; target.dead = true;
    log(`${target.name||target.key} 倒下了。`);
  }
  // 攻击自带元素 → 附着
  if(elem && elem!=='physical'){
    _attachElem(target.x, target.y, elem, attacker.key);
    // 触发反应（目标自己身上的附着 vs 地块附着）
    _tryReaction(elem, target);
  }
}
function _attachElem(x,y,elem,src){
  if(!_cs.attach) _cs.attach = {};
  const key = x+','+y;
  _cs.attach[key] = { elem, duration:4, owner:src };
}
function _tickAttachDuration(){
  if(!_cs.attach) return;
  for(const k in _cs.attach){
    _cs.attach[k].duration--;
    if(_cs.attach[k].duration<=0) delete _cs.attach[k];
  }
}
function _getAttach(x,y){
  return _cs?.attach?.[x+','+y];
}
function _tryReaction(newElem, target){
  const attach = _getAttach(target.x, target.y);
  if(!attach) return;
  const pair = window.reactions && window.reactions.lookupReaction
    ? window.reactions.lookupReaction(newElem, attach.elem) : null;
  if(pair){
    log(`⚗ 元素反应：${pair.name}`);
    if(pair.type==='explosion'){
      // 全体 AOE：范围内所有非我方单位受伤
      _allEntities().forEach(e => {
        if(e.faction!==(target.faction||'enemy')){
          const dmg = Math.round((window._lastSkillAtk||15)*pair.multiplier);
          _applyDamage(target, e, dmg, pair.reactElem||newElem);
        }
      });
    } else if(pair.type==='zone'){
      _createZone(target.x, target.y, pair.reactElem, pair.duration||3, 'reaction');
    }
    delete _cs.attach[target.x+','+target.y];
  }
}

/* ────────── § 结界（批次 2 完整） ────────── */
function _createZone(x,y,elem,duration,kind){
  if(!_cs.zones) _cs.zones = [];
  _cs.zones.push({ x, y, elem, duration, kind });
  log(`✦ 生成${elem}结界（${duration} 回合）`);
}
function _tickZoneDuration(){
  if(!_cs.zones) return;
  _cs.zones = _cs.zones.filter(z => { z.duration--; return z.duration>0; });
}
function _tickZonesAt(node){
  if(!_cs.zones) return;
  const zonesHit = {};
  _cs.zones.forEach(z => {
    if(!zonesHit[z.elem]) zonesHit[z.elem] = true;
    if(node==='roundStart'){
      // 燃烧结界：触发者行动节点 → 周围 5 格敌方喷火
      if(z.elem==='fire'){
        const ents = _allEntities().filter(e => e.faction==='enemy' && _dist(z,e)<=2);
        ents.forEach(e => {
          const dmg = Math.round((window._lastSkillAtk||15)*0.25);
          _applyDamage({name:'燃烧结界',key:'zone'}, e, dmg, 'fire');
        });
      } else if(z.elem==='thunder'){
        const ents = _allEntities().filter(e => e.faction==='enemy' && _dist(z,e)<=2);
        ents.forEach(e => {
          const dmg = Math.round((window._lastSkillAtk||15)*0.25);
          _applyDamage({name:'感电结界',key:'zone'}, e, dmg, 'thunder');
        });
      }
    }
  });
}

/* ────────── § 索敌/解析 ────────── */
function _cooldownLeft(key, skillId){
  const cdMap = _cs.cooldown[key] || {};
  return Math.max(0, (cdMap[skillId]||0));
}
function _startCooldown(key, skill){
  if(!skill.cd) return;
  if(!_cs.cooldown[key]) _cs.cooldown[key] = {};
  _cs.cooldown[key][skill.id] = skill.cd;
}
/* ── 字段适配层：data.js skills[] + defaultSkillIds/selectedSkillIds + skill.type/target/mult/cd → combat.js 统一结构 ── */
function _skillElemType(s){
  // data.js skill.type: 'physical' | 'fire' | 'water' | ...
  const t = (s && s.type) || 'physical';
  return t;  // physical 也是合法"元素"（渲染用 'physical' 显示无色）
}
function _skillRangeType(s){
  // data.js skill.target: 'front2' | 'adj9' | 'dist3' ...
  return (s && s.target) || 'self';
}
function _skillMultiplier(s){
  // data.js skill.mult（我之前写 skill.multiplier 错了）
  return (s && typeof s.mult==='number') ? s.mult : 1;
}
function _skillCooldown(s){
  return (s && typeof s.cd==='number') ? s.cd : 0;
}
function _charSkills(key){
  // 统一适配 data.js：所有技能都在 char.skills[] 一个数组里
  // defaultSkillIds / selectedSkillIds 决定"编入技能组"哪些展示
  let c;
  if(key==='pro'){
    c = getChar('pro') || window.PROTAGONIST;
  } else {
    c = getChar(key);  // getChar 会走 PROTAGONIST/ALLIES，返回 _ensureCharDefaults 后的对象
  }
  if(!c) return [];
  const pool = c.skills || [];
  // 选中优先顺序：selectedSkillIds（战前玩家自己编过）> defaultSkillIds（系统默认）> 全部
  const ids = c.selectedSkillIds || c.defaultSkillIds || pool.map(s=>s.id);
  if(ids && ids.length>0){
    // 严格按 ids 排序，按 skill.kind 分组（主→自→连）
    const filtered = pool.filter(s => ids.includes(s.id));
    filtered.sort((a,b) => (
      ({active:0, auto:1, link:2}[a.kind]||9) - ({active:0, auto:1, link:2}[b.kind]||9)
    ));
    return filtered;
  }
  return pool.slice();
}
function _charAllSkills(key){
  // 全部技能（不按编入筛选），给自动技能遍历用
  let c;
  if(key==='pro') c = window.PROTAGONIST;
  else c = window.ALLIES?.[key];
  return (c && c.skills) || [];
}

function _resolveSkillByChar(key, skill, delayMs){
  setTimeout(()=>{
    if(!_cs || _cs.ended) return;
    const owner = _ent(key);
    if(!owner || owner.dead) return;

    // 索敌：严格按 js/rules.js 真实签名
    // resolveTargeting(rangeType, ownerPos, ownerFacing, map, entities, ruleTag, targetFaction)
    // 返回 { attachCells: [[x,y], ...], damageEntities: [entity, ...] }
    const rangeType = _skillRangeType(skill);  // 真实字段 skill.target
    const ownerPos = [owner.x, owner.y];
    const ownerFacing = owner.facing;
    const map = G.map;  // rules.js 用 G.map 做 filterNonVoid（检查 terrain !== 'void'）
    const entities = _cs.entities;
    const ruleTag = skill.ruleTag || 'default';  // default=范围所有地块+所有可攻击敌对实体
    const targetFaction = skill.target === 'enemy' ? 'enemy'
                         : skill.target === 'ally' ? 'ally'
                         : skill.target === 'self' ? 'self' : 'all';

    let result;
    try {
      if(window.rules && window.rules.resolveTargeting){
        result = window.rules.resolveTargeting(rangeType, ownerPos, ownerFacing, map, entities, ruleTag, targetFaction);
      } else {
        result = _defaultRange(rangeType, ownerPos, ownerFacing, _cs.mapW, _cs.mapH, entities);
      }
    } catch(e){
      // 兜底：别因为 rules.js 出错就整个战斗崩
      log(`⚠ 索敌异常：${e.message}`);
      result = { damageEntities:[], attachCells:[] };
    }

    window._lastSkillAtk = owner.atk;
    const elem = _skillElemType(skill);  // data.js 里叫 skill.type
    log(`★ ${owner.name||key} 释放【${skill.name}】(范围 ${rangeType})`);

    const dmgEntities = result && result.damageEntities ? result.damageEntities : [];
    const multiplier = _skillMultiplier(skill);  // data.js 里叫 skill.mult
    dmgEntities.forEach(t => {
      if(!t || t.dead) return;
      if(elem !== 'physical'){
        _applyDamage(owner, t, Math.round(owner.atk * multiplier), elem);
      } else {
        _applyDamage(owner, t, Math.round(owner.atk * multiplier), 'physical');
      }
    });

    // 元素附着地块（skill.applyElemDur 等 data.js 字段，简化处理）
    const attachCells = result && result.attachCells ? result.attachCells : [];
    if(elem !== 'physical' && attachCells.length>0){
      attachCells.forEach(([x,y]) => {
        _attachElem(x, y, elem, key);
      });
      // 触发反应（地块附着 vs 本次技能元素）
      attachCells.forEach(([x,y]) => {
        // 简化：对该位置上实体尝试反应
        const e = _allEntities().find(ent => ent.x===x && ent.y===y);
        if(e) _tryReaction(elem, e);
      });
    }

    // 结界（目前 data.js 没 skill.zone 字段，保留逻辑等后续扩展）
    if(skill.zone){
      _createZone(owner.x, owner.y, skill.zone.elem, skill.zone.duration||3, 'skill');
    }

    // 冷却（data.js 里叫 cd）
    const cd = _skillCooldown(skill);
    if(cd>0){
      if(!_cs.cooldown[key]) _cs.cooldown[key] = {};
      _cs.cooldown[key][skill.id] = cd;
    }
  }, delayMs||0);
}

function _defaultRange(rangeType, ownerPos, ownerFacing, mapW, mapH, entities){
  // 简化兜底：按 rangeType 生成地块 → 筛实体（返回 {damageEntities, attachCells} 对齐 rules.js）
  const [ox, oy] = Array.isArray(ownerPos) ? ownerPos : [ownerPos?.x ?? 0, ownerPos?.y ?? 0];
  const cells = [];
  const dir = ownerFacing || 'down';
  const [dx, dy] = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[dir] || [0,1];

  const addCell = (x,y) => {
    if(x<0||y<0||x>=mapW||y>=mapH) return;
    cells.push([x,y]);
  };

  if(rangeType.startsWith('front')){
    const n = parseInt(rangeType.replace('front',''),10) || 1;
    for(let i=1;i<=n;i++) addCell(ox+dx*i, oy+dy*i);
  } else if(rangeType==='self'){
    addCell(ox, oy);
  } else if(rangeType==='adj9'){
    for(let rx=-1;rx<=1;rx++) for(let ry=-1;ry<=1;ry++) addCell(ox+rx, oy+ry);
  } else if(rangeType==='adj5'){
    for(let rx=-1;rx<=1;rx++) for(let ry=-1;ry<=1;ry++) if(Math.abs(rx)+Math.abs(ry)<=1) addCell(ox+rx, oy+ry);
  } else if(rangeType.startsWith('dist')){
    const n = parseInt(rangeType.replace('dist',''),10) || 1;
    for(let rx=-n;rx<=n;rx++) for(let ry=-n;ry<=n;ry++) if(Math.abs(rx)+Math.abs(ry)<=n && !(rx===0&&ry===0)) addCell(ox+rx, oy+ry);
  } else {
    // 兜底：adj9
    for(let rx=-1;rx<=1;rx++) for(let ry=-1;ry<=1;ry++) addCell(ox+rx, oy+ry);
  }

  const damageEntities = [];
  const attachCells = cells;
  for(const [cx,cy] of cells){
    for(const e of Object.values(entities||{})){
      if(e && !e.dead && e.x===cx && e.y===cy && e.faction==='enemy'){
        if(!damageEntities.includes(e)) damageEntities.push(e);
      }
    }
  }
  return { damageEntities, attachCells };
}
function _inFront(pos, target, depth){
  const dx = target.x-pos.x, dy = target.y-pos.y;
  const f = pos.facing || 'down';
  if(f==='down') return dy>=1 && Math.abs(dx)<=depth && dy<=depth;
  if(f==='up') return dy<=-1 && Math.abs(dx)<=depth && Math.abs(dy)<=depth;
  if(f==='right') return dx>=1 && Math.abs(dy)<=depth && dx<=depth;
  if(f==='left') return dx<=-1 && Math.abs(dy)<=depth && Math.abs(dx)<=depth;
  return false;
}

function _syncCooldowns(){
  // 回合末整体 -1，保留
}

/* ────────── § 主循环绑定 ────────── */
let _loopId = null;
function _startLoop(){
  if(_loopId) clearInterval(_loopId);
  _loopId = setInterval(()=>_tick(100), 100);
}
function _stopLoop(){ if(_loopId){ clearInterval(_loopId); _loopId=null; } }

/* ────────── § 开始战斗 ────────── */
function startCombat(cell){
  // === 从真实 G.map cell 对象反解 x/y（cell 没有 .x/.y，只有 .idx） ===
  const n = G.map ? G.map.n : 11;
  const cellIdx = cell?.idx ?? -1;
  const cx = (cellIdx>=0) ? cellIdx % n : (cell?.x ?? G.px ?? 5);
  const cy = (cellIdx>=0) ? Math.floor(cellIdx / n) : (cell?.y ?? G.py ?? 5);

  // === 从 cell.content.key 查 ENEMIES 模板（rollCombatEvent 返回 content.key='fireSlime' 等） ===
  let enemyKey = cell?.content?.key || cell?.key || 'fireSlime';
  let enemyTpl = null;
  if(window.ENEMIES && window.ENEMIES[enemyKey]){
    enemyTpl = window.ENEMIES[enemyKey];
  }
  if(!enemyTpl){ enemyTpl = { name:'火史莱姆', atk:15, def:0, maxHp:40, icon:'🔴' }; }

  // 允许 cell.enemies 数组（兼容 event.js enterEventBattle 等直接塞 enemies 数组的调用）
  const enemies = [];
  if(cell?.enemies && Array.isArray(cell.enemies)){
    cell.enemies.forEach((e,i)=>{
      const ex = cx + (i<3? i-1 : 0);
      const ey = cy - (i<3? 0 : 1);
      enemies.push(_makeEnemy(e, ex, ey));
    });
  } else {
    // 正常情况：rollCombatEvent 给的是单个 enemy key → 生成 1-3 个同类型敌人
    const isElite = enemyTpl.tier==='elite' || cell?.content?.sub==='boss';
    const count = isElite ? 1 : (Math.random()<0.4 ? 2 : 1);
    for(let i=0; i<count; i++){
      const ex = cx + (i-1);
      const ey = cy + (i===0? -1 : 0);
      enemies.push(_makeEnemy(enemyTpl, Math.max(0,ex), Math.max(0,ey)));
    }
  }

  const proStart = {x: G.px ?? 5, y: G.py ?? cy+1, facing:'up'};
  // 保险：player 站格不能跟敌人站同格
  if(enemies.some(e => e.x===proStart.x && e.y===proStart.y)){
    proStart.x = Math.max(0, proStart.x-1);
  }

  _cs = {
    mapW: n, mapH: n,
    round: 1, phase: 'roundStart', phaseCtx:{}, phaseStartAt:0,
    cooldown: {}, entities: {}, enemies: {},
    attach: {}, zones: [],
    linkWindow: { open:false, startAt:0, remainMs:0, candidateSkills:[] },
    currentChar: 'pro',
    startPos: {x:G.px,y:G.py}, startFacing:G.hero?.facing||'down',
    selectedSkillId: null,
  };
  // 主角（PROTAGONIST 是 data.js script tag 层的全局 const，IIFE 闭包可直接访问）
  const proData = window.PROTAGONIST;
  _cs.entities.pro = { key:'pro', faction:'ally', type:'hero', name:'主角',
    x:proStart.x, y:proStart.y, facing:proStart.facing,
    hp: G.hero?.hp ?? proData?.base?.hp ?? 80,
    maxHp: G.hero?.maxHp ?? proData?.base?.maxHp ?? 100,
    atk: charAtk('pro'), def: totalHeroDefense(), elem:'physical',
  };
  // 队友（data.js 里队友对象在 ALLIES / PROTAGONIST 里，字段是 base: {atk, maxHp, def, hp}）
  (G.team||['pro']).forEach(k => {
    if(k==='pro') return;  // pro 单独建
    const c = getChar(k);
    if(!c) return;
    const baseHp = c.base?.hp ?? c.base?.maxHp ?? 100;
    const maxHp = c.base?.maxHp ?? c.base?.hp ?? 100;
    _cs.entities[k] = {
      key:k, faction:'ally', type:'ally', name:c.name||k,
      x:proStart.x-1, y:proStart.y, facing:'up',
      hp: baseHp, maxHp: maxHp,
      atk: charAtk(k), def: (c.base?.def??0), elem: (c.element || c.elem || 'physical'),
    };
  });
  // 敌人
  enemies.forEach(e => {
    _cs.entities[e.key] = e;
    _cs.enemies[e.key] = e;
  });
  switchMode('combat');
  log(`⚔ 战斗开始！第 ${_cs.round} 回合`);
  _setPhase('roundStart');
  _startLoop();
  renderCombatMap();
  updateCombatUI();
}
function _makeEnemy(proto,x,y){
  const key = 'e_' + Math.random().toString(36).slice(2,8);
  // data.js ENEMIES 模板字段：name/atk/def/maxHp/res/passives/skills
  const maxHp = proto.maxHp || proto.hp || 30;
  const elem = proto.element || proto.elem || (proto.skills && proto.skills.length>0 ? proto.skills[0].type : undefined) || 'physical';
  return { key, faction:'enemy', type:'enemy', name:proto.name||'敌人',
    x, y, facing:'down',
    hp: maxHp, maxHp: maxHp,
    atk: proto.atk||10, def: proto.def||0,
    elem: elem, atkRange: 1,
    resist: proto.res||proto.resist||{}, buffs:[], debuffs:[],
  };
}

/* ────────── § 主操作（玩家按钮/键盘调用） ────────── */
function tryCastSkill(slot){
  if(!_cs) return;
  if(_cs.phase!=='playerManual'){
    log('当前不是手动行动阶段');
    return;
  }
  const key = _cs.currentChar || 'pro';
  const skills = _charSkills(key);
  const s = skills[slot];
  if(!s){ log(`❌ 槽位 ${slot} 空（当前角色编入了 ${skills.length} 个技能）`); return; }
  if(s.kind==='auto'){ log('自动技能不可手动释放'); return; }
  if(s.kind==='link'){ log('连携技能请等待连携窗口（连携触发时会自动打开）'); return; }
  // 冷却：data.js 里 cd=1 是常见值（几乎每回合都能放），我之前每玩家行动都 -1 导致永远 0 → 逻辑 OK
  const cdLeft = _cooldownLeft(key, s.id);
  if(cdLeft>0){ log(`冷却中 (剩 ${cdLeft} 回合)`); return; }
  _resolveSkillByChar(key, s);
  _endPlayerAction();
}
function movePro(dx,dy){
  if(!_cs || _cs.phase!=='playerManual') return;
  if(_cs.linkWindow && _cs.linkWindow.open){ log('连携窗口中，先选连携技能或等待关闭'); return; }
  const pro = _ent('pro'); if(!pro) return;
  const nx = pro.x+dx, ny = pro.y+dy;
  if(!_inBounds(nx,ny)) return;
  if(_cellHasEntity(nx,ny)){ log('该格有单位，无法移动'); return; }
  pro.x = nx; pro.y = ny;
  if(dx===1) pro.facing='right'; else if(dx===-1) pro.facing='left';
  else if(dy===1) pro.facing='down'; else if(dy===-1) pro.facing='up';
  _endPlayerAction();
  renderCombatMap();
  updateCombatUI();
}
function skipTurn(){
  if(!_cs || _cs.phase!=='playerManual') return;
  log('跳过回合。');
  _endPlayerAction();
}
function tryFlee(){
  if(!_cs) return;
  if(Math.random()<0.6){
    _endCombat('flee');
  } else {
    log('逃跑失败！');
    _endPlayerAction();
  }
}
function _endPlayerAction(){
  _cs.autoProcessed = {};
  _cs.cooldownTick = (_cs.cooldownTick||0)+1;
  // 每玩家行动后整体 CD -1
  for(const k in _cs.cooldown){
    for(const sid in _cs.cooldown[k]){
      if(_cs.cooldown[k][sid]>0) _cs.cooldown[k][sid]--;
    }
  }
  _closeLinkWindow();
  _setPhase('enemy');
}
function _cellHasEntity(x,y){
  return _allEntities().some(e => e.x===x && e.y===y);
}

/* ────────── § 连携窗口（批次 2） ────────── */
function _openLinkWindow(){
  // 收集所有 kind='link' 可用技能，开 2s 窗口
  const cands = [];
  const team = (G.team||['pro']).slice();
  team.forEach(k => {
    const list = _charAllSkills(k).filter(s => s.kind==='link' && _cooldownLeft(k,s.id)===0);
    list.forEach(s => cands.push({ key:k, skill:s }));
  });
  if(cands.length===0) return;
  _cs.linkWindow = { open:true, startAt:Date.now(), remainMs:2000, candidateSkills:cands };
  log(`◈ 连携窗口开启（${cands.length} 个候选）—— 2 秒内按 [Q] 触发`);
}
function _closeLinkWindow(){
  if(_cs && _cs.linkWindow){
    _cs.linkWindow.open = false;
    _cs.linkWindow.candidateSkills = [];
  }
}
function triggerLink(){
  if(!_cs || !_cs.linkWindow || !_cs.linkWindow.open){ log('当前没有连携窗口'); return; }
  const c = _cs.linkWindow.candidateSkills[0];
  if(!c) return;
  log(`✦ 触发连携：${c.skill.name}`);
  _resolveSkillByChar(c.key, c.skill);
  _closeLinkWindow();
}

/* ────────── § 结束战斗 ────────── */
function _onWin(){
  _stopLoop();
  if(!_cs) return;
  _endCombat('win');
}
function _endCombat(outcome){
  _stopLoop();
  if(!_cs) return;
  if(outcome==='win'){
    const coin = 10 + Math.floor(Math.random()*10);
    log(`胜利！获得金币 ×${coin}`);
  } else if(outcome==='defeat'){
    log('战斗失败……');
    if(G.hero && G.hero.hp!==undefined) G.hero.hp = Math.max(1, (_ent('pro')?.hp||G.hero.hp));
  } else if(outcome==='flee'){
    log('成功逃离战斗。');
  }
  G.px = _cs.startPos.x; G.py = _cs.startPos.y;
  G.hero.facing = _cs.startFacing;
  const pro = _ent('pro');
  if(pro) G.hero.hp = pro.hp;
  _cs = null; _sync();
  switchMode('explore');
  renderMap(); refreshHUD();
  log('（回到探索入口地块）');
}

/* ────────── § renderCombatMap：地块 + 附着背景 + 结界边框 + 实体 ────────── */
function renderCombatMap(){
  const mapGrid = document.getElementById('mapGrid');
  if(!mapGrid || !_cs) return;
  const w = _cs.mapW, h = _cs.mapH;
  mapGrid.innerHTML = '';
  mapGrid.style.display = 'grid';
  mapGrid.style.gridTemplateColumns = `repeat(${w}, 42px)`;
  mapGrid.style.gridTemplateRows = `repeat(${h}, 42px)`;
  mapGrid.style.gap = '2px';

  for(let y=0; y<h; y++){
    for(let x=0; x<w; x++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x; cell.dataset.y = y;

      // 元素附着背景
      const attach = _getAttach(x,y);
      if(attach){
        cell.classList.add('attach');
        cell.classList.add('elem-'+attach.elem);
        const bg = document.createElement('div');
        bg.className = 'attach-bg';
        cell.appendChild(bg);
      }
      // 结界边框
      const zoneHere = (_cs.zones||[]).some(z => z.x===x && z.y===y);
      if(zoneHere) cell.classList.add('zone');

      cell.addEventListener('click', ()=>combatCellClick(x,y));
      mapGrid.appendChild(cell);
    }
  }
  // 实体渲染
  _allEntities().forEach(e => {
    const cell = mapGrid.children[e.y*w + e.x];
    if(!cell) return;
    const icon = document.createElement('div');
    icon.className = 'entIcon';
    if(e.key==='pro') icon.textContent = '🧙';
    else if(e.faction==='ally') icon.textContent = (e.name||'★').slice(0,1);
    else if(e.type==='summon') icon.textContent = '✦';
    else icon.textContent = (e.name||'👹').slice(0,2);
    // 敌人血条贴底部
    if(e.faction==='enemy'){
      const hp = document.createElement('div');
      hp.className = 'entHpEnemy';
      const pct = e.hp/e.maxHp;
      hp.style.background = `linear-gradient(90deg, #ff5a5a ${pct*100}%, #5a2a2a ${pct*100}%)`;
      cell.appendChild(hp);
    }
    cell.appendChild(icon);
  });
}

/* ────────── § combatCellClick：选中地块/单位 → rightPanel 详情 ────────── */
function combatCellClick(cx,cy){
  const pz = document.getElementById('promptZone');
  if(!pz || !_cs) return;
  const attach = _getAttach(cx,cy);
  const zones = (_cs.zones||[]).filter(z => z.x===cx && z.y===cy);
  const entHere = _allEntities().find(e => e.x===cx && e.y===cy);

  let html = `<div class="panel-subtitle">📍 地块 (${cx},${cy})</div>`;
  html += `<div style="font-size:13px;color:#cfd4dc;line-height:1.8">`;
  html += `地形：空地 · 内容：战斗格<br>`;
  if(attach) html += `<span style="color:${_elemColor(attach.elem)}">⚙ 元素附着：${attach.elem}（剩 ${attach.duration} 回合）</span><br>`;
  if(zones.length){
    zones.forEach(z => html += `<span style="color:#ffce4d">✦ ${z.elem}结界（剩 ${z.duration} 回合，kind=${z.kind}）</span><br>`);
  }
  html += `</div>`;
  if(entHere){
    html += `<div class="panel-subtitle" style="margin-top:8px">👤 ${entHere.name} <span style="font-size:11px;color:#8a8f9f">[${entHere.faction}]</span></div>`;
    html += `<div style="font-size:13px;color:#cfd4dc;line-height:1.8">`;
    html += `HP：<b style="color:${entHere.faction==='enemy'?'#ff5a5a':'#7bd68e'}">${entHere.hp}/${entHere.maxHp}</b><br>`;
    html += `攻击 ${entHere.atk} · 防御 ${entHere.def||0} · 属性 ${entHere.elem||'physical'}<br>`;
    html += `</div>`;
  }
  pz.innerHTML = html;
}
function _elemColor(e){
  return {fire:'#e74c3c',water:'#4a9bff',grass:'#5fd96b',thunder:'#c05bff',ice:'#4fd8d8',wind:'#78c7f2',rock:'#b09a73'}[e]||'#cfd4dc';
}

/* ────────── § updateCombatUI：规格 4 行严格排版 ────────── */
function updateCombatUI(){
  if(!_cs) return;

  // row1：角色卡（48×48 首字，选中不加金边框！）+ 属性面板
  const row1Chars = document.getElementById('row1Chars');
  const row1Attrs = document.getElementById('row1Attrs');
  if(row1Chars){
    row1Chars.innerHTML = '';
    const chars = [{key:'pro',name:'主角'}].concat((G.team||[]).map(k => { const c=getChar(k); return {key:k, name:c?.name||k}; }));
    chars.forEach(c => {
      const tile = document.createElement('div');
      tile.className = 'charTile faction-ally';
      tile.textContent = c.name.slice(0,1);
      if(c.key===_cs.currentChar) tile.style.outline = '2px solid #d9b64a';  // 选中才描
      tile.title = c.name;
      tile.onclick = ()=>{ _cs.currentChar = c.key; updateCombatUI(); };
      row1Chars.appendChild(tile);
    });
  }
  if(row1Attrs){
    row1Attrs.innerHTML = '';
    const cur = _cs.currentChar;
    const entCur = _ent(cur);
    // 主角完整属性 / 队友只显示攻+爆（规格硬约束）
    const showAttrs = [];
    if(cur==='pro'){
      showAttrs.push(['攻击', charAtk('pro')]);
      showAttrs.push(['暴击', Math.round(baseCritRate('pro'))+'%']);
      showAttrs.push(['HP', (entCur?.hp||G.hero?.hp)+'/'+(entCur?.maxHp||G.hero?.maxHp)]);
      showAttrs.push(['防御', totalHeroDefense()]);
      showAttrs.push(['速度', heroDisplaySpeed()]);
    } else {
      const c = getChar(cur);
      showAttrs.push(['攻击', charAtk(cur)]);
      showAttrs.push(['暴击', Math.round(baseCritRate(cur))+'%']);
    }
    showAttrs.forEach(([k,v])=>{
      const chip = document.createElement('div');
      chip.className = 'attrChip';
      chip.innerHTML = `${k}<b>${v}</b>`;
      if(k==='HP') chip.classList.add('attrHp');
      row1Attrs.appendChild(chip);
    });
  }

  // row2：全局技能组（active → auto → link 排序，58×58 固定 tile + 冷却徽章 + kind 徽章 + 无金色高亮）
  const groupEl = document.getElementById('skillGroup');
  if(groupEl){
    groupEl.innerHTML = '';
    const charAll = [{key:'pro',name:'主角'}].concat((G.team||[]).map(k => { const c=getChar(k); return {key:k, name:c?.name||k, team:c}; }));
    const allSkills = [];
    charAll.forEach(c => {
      _charSkills(c.key).forEach(s => allSkills.push({ key:c.key, name:c.name, skill:s }));
    });
    allSkills.sort((a,b)=>{
      const oa = {active:0, auto:1, link:2}[a.skill.kind]||9;
      const ob = {active:0, auto:1, link:2}[b.skill.kind]||9;
      return oa-ob;
    });
    allSkills.forEach(item => {
      const tile = document.createElement('div');
      tile.className = 'skillTile';
      const cd = _cooldownLeft(item.key, item.skill.id);
      if(cd>0) tile.classList.add('cooling');
      if(_cs.selectedSkillId === item.skill.id) tile.classList.add('selected');
      if(item.skill.elem) tile.classList.add('elem-'+item.skill.elem);

      const icon = document.createElement('div');
      icon.className = 'stIcon';
      icon.textContent = _skillIcon(item.skill);
      tile.appendChild(icon);

      const kindB = document.createElement('div');
      kindB.className = 'stKind '+item.skill.kind;
      kindB.textContent = item.skill.kind==='active'?'主':item.skill.kind==='auto'?'自':'连';
      tile.appendChild(kindB);

      if(cd>0){
        const cdB = document.createElement('div');
        cdB.className = 'stCd';
        cdB.textContent = cd;
        tile.appendChild(cdB);
      }
      if(item.skill.kind==='link' && _cs.linkWindow && _cs.linkWindow.open){
        const linkFlag = document.createElement('div');
        linkFlag.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;border:2px dashed #d9b64a;pointer-events:none;border-radius:4px;';
        tile.appendChild(linkFlag);
      }

      const nameB = document.createElement('div');
      nameB.className = 'stName';
      nameB.textContent = item.skill.name;
      tile.appendChild(nameB);

      tile.onclick = ()=>{
        // 第一次点：选中 → row4 描述
        // 第二次点（选中同一 + kind=='active' + manual phase）：释放
        if(_cs.selectedSkillId === item.skill.id){
          if(item.skill.kind==='active'){
            _cs.currentChar = item.key;
            const slotIdx = _charSkills(item.key).findIndex(s=>s.id===item.skill.id);
            tryCastSkill(slotIdx);
          }
        } else {
          _cs.selectedSkillId = item.skill.id;
          _cs.selectedSkillKey = item.key;
        }
        updateCombatUI();
      };
      groupEl.appendChild(tile);
    });
  }

  // row3：状态芯片 + 天赋标签
  const chips = document.getElementById('statusChips');
  const talents = document.getElementById('talentTags');
  if(chips){
    chips.innerHTML = '';
    const entCur = _ent(_cs.currentChar);
    const buffs = entCur?.buffs||[];
    const debuffs = entCur?.debuffs||[];
    if(buffs.length===0 && debuffs.length===0){
      chips.innerHTML = '<span class="stempty" style="color:#6b6f7e;font-size:12px">无状态</span>';
    } else {
      buffs.forEach(b => chips.appendChild(_chipEl(b,'buff')));
      debuffs.forEach(b => chips.appendChild(_chipEl(b,'debuff')));
    }
  }
  if(talents){
    talents.innerHTML = '';
    const cur = _cs.currentChar;
    const list = cur==='pro' ? (G.hero?.talents||[]) : ((getChar(cur)?.talents)||[]);
    if(list.length===0){
      talents.innerHTML = '<span class="talentTag">无天赋</span>';
    } else {
      list.forEach(t => {
        const el = document.createElement('div');
        el.className = 'talentTag';
        el.textContent = typeof t==='string' ? t : (t.name||t.id||'天赋');
        talents.appendChild(el);
      });
    }
  }

  // row4：技能描述面板（照抄 skill.desc 字段）
  const descEl = document.getElementById('skillDesc');
  if(descEl){
    descEl.innerHTML = '';
    const key = _cs.selectedSkillKey || _cs.currentChar;
    const sid = _cs.selectedSkillId;
    if(!sid){
      descEl.innerHTML = '<div class="sd-empty">点击左侧技能 tile 查看详情</div>';
    } else {
      const s = _charSkills(key).find(x => x.id===sid);
      if(!s){
        descEl.innerHTML = '<div class="sd-empty">技能已过期</div>';
      } else {
        const head = document.createElement('div');
        head.className = 'sd-head';
        const kindB = document.createElement('span');
        kindB.className = 'sd-kind '+s.kind;
        kindB.textContent = s.kind==='active'?'主动':s.kind==='auto'?'自动':'连携';
        const nm = document.createElement('span');
        nm.className = 'sd-name';
        nm.textContent = s.name;
        const cdEl = document.createElement('span');
        cdEl.className = 'sd-cd';
        cdEl.textContent = s.cd ? `冷却 ${s.cd} 回合` : '';
        head.appendChild(kindB); head.appendChild(nm); head.appendChild(cdEl);
        descEl.appendChild(head);
        const meta = document.createElement('div');
        meta.className = 'sd-meta';
        const rangeTxt = s.range || '—';
        const elemTxt = s.elem || 'physical';
        const multTxt = s.multiplier ? `×${s.multiplier}` : '';
        meta.textContent = `元素：${elemTxt} · 范围：${rangeTxt}${multTxt}${s.faction?` · 目标阵营：${s.faction}`:''}`;
        descEl.appendChild(meta);
        const d = document.createElement('div');
        d.className = 'sd-desc';
        d.textContent = s.desc || '';
        descEl.appendChild(d);
      }
    }
  }

  // 逃跑按钮启用状态
  const fleeBtn = document.getElementById('fleeBtn');
  if(fleeBtn){ fleeBtn.disabled = _cs.phase!=='playerManual'; }
}

function _chipEl(s, cls){
  const el = document.createElement('div');
  el.className = 'stchip '+cls;
  const dur = s.duration || s.turns;
  const txt = dur ? `${s.name||s.id} ${dur}` : (s.name||s.id);
  el.textContent = txt;
  return el;
}
function _skillIcon(s){
  if(!s) return '★';
  if(s.elem==='fire') return '🔥';
  if(s.elem==='water') return '💧';
  if(s.elem==='grass') return '🌿';
  if(s.elem==='thunder') return '⚡';
  if(s.elem==='ice') return '❄';
  if(s.elem==='wind') return '💨';
  if(s.elem==='rock') return '⛰';
  if(s.kind==='link') return '✦';
  return '★';
}

/* ────────── § 对外接口 ────────── */
window.combat = {
  startCombat, tryCastSkill, movePro, skipTurn, tryFlee,
  renderCombatMap, updateCombatUI, combatCellClick,
  triggerLink, getCharSkills: _charSkills, _charSkills,
  getCurrentPhase: ()=>_cs?.phase||null,
};
window.tryFlee = tryFlee;
window.updateCombatUI = updateCombatUI;
window.renderCombatMap = renderCombatMap;
window.combatCellClick = combatCellClick;

})();
