/* ============================================================
   js/combat.js —— 模块：战斗状态机 + 主循环 + 公开 API
   
   依赖: window.Data (data.js) — 所有元素/地形/状态/技能定义
         window.Reactions (reactions.js) — 反应表 + 查反应
   
   对外暴露: window.Combat
   ========================================================================
   公开 API（蓝图锁定，不可随意改名）:
   
   startBattle(enemyProto, opts?)
     进入战斗：根据 enemyProto 生成敌方实体快照，建立 cs，切 phase='roundStart'
     opts: { mapSnapshot, skillGroup, teamKeys, turnStartBonus? }
   
   // ---- 玩家操作（只有 manual 阶段生效） ----
   selectChar(charKey)              // 只切 #cbRow1 选中，不触发战斗逻辑
   selectSkill(slotIdx)             // 1/2/3/4 数字键：选中 slot → 切 #cbRight 描述；不释放
   castSkill(slotIdx)               // 再按数字键 或 鼠标点：释放 active 技能
   move(dx, dy)                     // WASD
   skipTurn()                       // F
   tryLinkUse()                     // E
   flee()                           // 方形逃跑按钮
   cancelSelection()                // Esc：清 selectedSlotIdx
   
   // ---- 查询 ----
   getState()                       // 返回 cs 浅只读副本（UI 只读）
   getSkillDesc(slotIdx)            // 返回 skill 数据（给 ui.js 渲染 #cbRight）
   
   // ---- 事件回调订阅 ----
   onEvent(event, handler)          // event ∈ EVENT_NAMES
   
   EVENT_NAMES = [
     'phaseChange',        // { from, to }
     'log',                // text
     'combatEnd',          // { win, rewards? }
     'skillSelected',      // slotIdx | null
     'charSelected',       // charKey
     'auraApplied',        // {x,y,elem,sourceKey}
     'zoneCreated',        // {zone}
     'damageDone',         // {attackerKey,targetKey,damage,elem}
     'linkWindowChange',   // {open, skillName?, deadlineMs?}
   ]
   
   依赖顺序：data.js → reactions.js → combat.js → explore.js → ui.js（html script 加载顺序保证）
   ============================================================ */
"use strict";

/* =======================================================
   跨模块全局裸工具函数（被 main.js / ui.js / explore.js / event.js / craft.js 等引用）
   —— 这堆函数必须在 IIFE 外面，因为 script 加载顺序是 combat.js 先于 ui.js/event.js，
      这些文件顶层就会直接调用 window.heroDisplayMaxHp 等
   —— tierValue / entryLevel / vTier 复用 js/data.js 的实现（后者后加载会覆盖，
      所以本文件不再重新定义 stub）
   ======================================================= */

function charBaseAtk(k){
  const G = window.G || {};
  if(k==='pro'){
    return (G.hero && G.hero.atk) != null ? G.hero.atk : 10;
  }
  const c = typeof getChar === 'function' ? getChar(k) : null;
  return c?.base?.atk ?? 35;
}

/** charAtk(k) —— 角色当前攻击力（含天赋叠加 + 战斗中 buff） */
function charAtk(k){
  const G = window.G || {};
  let a = charBaseAtk(k);
  const c = typeof getChar === 'function' ? getChar(k) : null;
  // 角色自身 scal.atk / scal.self 天赋叠加
  if(c && c.passives && typeof entryLevel === 'function' && typeof tierValue === 'function'){
    for(const p of c.passives){
      const lv = entryLevel(k, p);
      if(p.scal?.atk)  a += tierValue(p, lv, 'atk');
      if(p.scal?.self) a += tierValue(p, lv, 'self');
    }
  }
  // 主角额外叠加：队友 passives 里的 scal.pro 字段（如夏阳 fearless +proAtk）
  if(k==='pro' && G.team && typeof ALLIES !== 'undefined'){
    for(const ally of G.team){
      const ac = ALLIES[ally];
      if(!ac || !ac.passives) continue;
      for(const p of ac.passives){
        const lv = typeof entryLevel === 'function' ? entryLevel(ally, p) : 1;
        if(p.scal?.pro) a += tierValue(p, lv, 'pro');
        // 兼容旧字段名 proAtk（夏阳 fearless 用的）
        if(p.scal?.proAtk) a += tierValue(p, lv, 'proAtk');
      }
    }
  }
  // 抑郁：攻击力强制归零
  if(G.hero && G.hero.depress && k==='pro') a = 0;
  // 战斗中临时增益
  if(window.combatState && window.combatState.ally && window.combatState.ally[k]){
    const s = window.combatState.ally[k];
    a += (s.flatAtk||0) + (s.gain||0) - (s.stolen||0);
    const st = s.statuses;
    if(st && st.atkUp) a += Math.round(charBaseAtk(k)*0.25);
  }
  return Math.round(a);
}

function totalHeroDefense(){
  const G = window.G || {};
  let d = (G.hero && G.hero.def) || 0;
  // 主角 hold 天赋加成
  const pro = typeof getChar === 'function' ? getChar('pro') : null;
  const hold = pro?.passives?.find(p => p.id==='hold');
  if(hold && hold.scal?.def && typeof entryLevel==='function' && typeof tierValue==='function'){
    d += tierValue(hold, entryLevel('pro', hold), 'def');
  }
  if(G.hero && G.hero.depress) d = 0;  // 抑郁：防御强制归零
  return Math.max(0, Math.min(99999, d));
}

/** 主角最大生命（含天赋叠加 + 陆悠悠烹饪 +100） */
function heroDisplayMaxHp(){
  const G = window.G || {};
  let m = (G.hero && G.hero.maxHp) || 100;
  const pro = typeof getChar === 'function' ? getChar('pro') : null;
  if(pro && pro.passives && typeof entryLevel==='function' && typeof tierValue==='function'){
    for(const p of pro.passives){
      const lv = entryLevel('pro', p);
      if(p.scal?.hp) m += tierValue(p, lv, 'hp');
    }
  }
  if(G.team && G.team.indexOf('luyouyou') >= 0) m += 100;  // 烹饪天赋
  return m;
}
/** heroineMaxHp —— 旧别名 */
function heroineMaxHp(){ return heroDisplayMaxHp(); }

function heroDisplayAtk(){ return charAtk('pro'); }
function heroDisplayDef(){ return totalHeroDefense(); }

function baseCritRate(k){
  let r = 0;
  const c = typeof getChar === 'function' ? getChar(k) : null;
  if(!c) return 5;  // 默认 5%
  const pick = (k==='pro' && c.passives?.find(p=>p.id==='crit'))
            || (k==='luyouyou' && c.passives?.find(p=>p.id==='windSpirit'))
            || null;
  if(pick && pick.scal?.crit && typeof tierValue==='function' && typeof entryLevel==='function'){
    r += tierValue(pick, entryLevel(k, pick), 'crit');
  }
  return Math.max(0, Math.min(100, Math.round(r)));
}
function charCritRate(k){
  let r = baseCritRate(k);
  const cs = window.combatState;
  if(cs && cs.ally){
    if(cs.ally[k]?.statuses?.crit) r += 100;           // 屏息
    if(cs.ally.pro?.statuses?.crit && k==='pro') r += 100;  // 比翼效果
  }
  return Math.max(0, Math.min(100, r));
}

function heroDodgeRate(){
  const G = window.G || {};
  if(!(G.team && G.team.indexOf('luyouyou') >= 0)) return 0;
  const fl = typeof getChar === 'function' ? getChar('luyouyou') : null;
  const dance = fl?.passives?.find(p => p.id==='dance');
  if(!dance || !dance.scal?.dodge) return 0;
  if(typeof tierValue==='function' && typeof entryLevel==='function'){
    return tierValue(dance, entryLevel('luyouyou', dance), 'dodge');
  }
  return 0;
}

function heroDisplayCrit(){ return baseCritRate('pro'); }
function heroDisplayDodge(){ return heroDodgeRate(); }
function heroDisplaySpeed(){ return (window.G && window.G.hero) ? (window.G.hero.speed ?? 30) : 30; }

// tierValue / entryLevel / vTier / lvDescText / itemLoveLevel / R / talentDisplayName
// 都在 js/data.js 里定义，自动挂 window，不再重复定义 stub


(function () {

  /* ==================== 状态（闭包内唯一） ==================== */
  let _cs = null;  // 当前战斗状态对象（单例，同一时间只有一场战斗）

  /* ==================== 常量 ==================== */
  const PHASES = {
    ROUND_START: 'roundStart',
    MANUAL:      'manual',
    AUTO_SKILLS: 'autoSkills',
    SUMMONS:     'summons',
    NEUTRAL:     'neutrals',
    ENEMY:       'enemy',
    ROUND_END:   'roundEnd',
  };

  const ACTION_COUNT_THIS_TURN = new Set([
    'castSkill', 'move', 'skipTurn', 'useLink', 'autoSkill',
  ]);

  const REMNANT_MS = 1000;          // 残存时间 1 秒（规格 §10.5）
  const LINK_WINDOW_MS = 2000;      // 连携窗口 2 秒（规格）
  const TICK_MS = 100;              // 主循环内部 tick 间隔

  /* ==================== 工具 ==================== */
  const Data = window.Data;
  const Reactions = window.Reactions;

  function _log(cs, text) { cs.handlers.log.forEach(h => { try { h(text); } catch(e) { console.error(e); } }); }
  function _emit(cs, event, payload) {
    (cs.handlers[event] || []).forEach(h => {
      try { h(payload); } catch(e) { console.error('[combat event', event, ']', e); }
    });
  }
  function _inBounds(cs, x, y) { return x >= 0 && y >= 0 && x < cs.map.n && y < cs.map.n; }
  function _dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  function _phaseLabel(p) {
    return { roundStart:'回合开始', manual:'手动操作', autoSkills:'自动技能', summons:'召唤物',
      neutrals:'中立结算', enemy:'敌方回合', roundEnd:'回合结束' }[p] || p;
  }

  /* ==================== 实体辅助 ==================== */
  function _entAt(cs, x, y) {
    if (cs.hero.x === x && cs.hero.y === y) return cs.hero;
    for (const k in cs.allies) { const a = cs.allies[k]; if (a.alive !== false && a.x === x && a.y === y) return a; }
    for (const e of cs.enemies) { if (e.alive !== false && e.x === x && e.y === y) return e; }
    for (const s of cs.summons) { if (s.alive !== false && s.x === x && s.y === y) return s; }
    return null;
  }
  function _entityList(cs) {
    const out = [];
    if (cs.hero.alive !== false) out.push({...cs.hero});
    for (const k in cs.allies) { const a = cs.allies[k]; if (a.alive !== false) out.push(a); }
    for (const e of cs.enemies) { if (e.alive !== false) out.push(e); }
    for (const s of cs.summons) { if (s.alive !== false) out.push(s); }
    return out;
  }
  function _findEntity(cs, key) {
    if (cs.hero.key === key) return cs.hero;
    if (cs.allies[key]) return cs.allies[key];
    for (const e of cs.enemies) if (e.key === key) return e;
    for (const s of cs.summons) if (s.key === key) return s;
    return null;
  }

  /* ==================== 硬控判定 ==================== */
  function _hasHardControl(entity) {
    if (!entity || !entity.buffs) return false;
    return entity.buffs.some(b =>
      b.id === 'frozen' || b.id === 'bind' || b.id === 'sleep'
    );
  }

  /* ==================== 节点触发（行动节点） ====================
     规格：先扣持续时间，再检查硬控（冻结单位的节点触发顺序不能反） */
  function _triggerEntityNode(cs, entity) {
    if (!entity || entity.alive === false) return;
    // 1) 先扣 buff/debuff 回合数
    entity.buffs = (entity.buffs || []).map(b => {
      if (b.turnsLeft !== undefined && b.turnsLeft > 0) {
        b.turnsLeft -= 1;
        if (b.turnsLeft <= 0 && !b.infinite) return null;
      }
      return b;
    }).filter(Boolean);

    // 2) 护盾清除（每行动节点开始时清除旧护盾）
    entity.buffs = entity.buffs.filter(b => b.id !== 'shield');

    // 3) 燃烧 debuff：扣 3% 生命（规格 §9.2 燃烧）
    const burn = entity.buffs.find(b => b.id === 'burn');
    if (burn && burn.turnsLeft !== undefined) {
      const pct = 0.03;
      const loss = Math.max(1, Math.floor(entity.maxHp * pct));
      _applyHpDelta(cs, entity, -loss, 'physical');
      _log(cs, `${entity.name||entity.key} 受到燃烧伤害 ${loss}`);
    }

    // 4) 冻结 buff：如果因上一步 turnLeft 归零而消失，立即获得 3 回合免疫冻结
    const justUnfrozen = (entity.buffs || []).find(b => b.id === 'freezed_imm');
    const hadFrozen = (entity._hadFrozenLastTurn === true);
    const stillFrozen = (entity.buffs || []).some(b => b.id === 'frozen');
    if (hadFrozen && !stillFrozen && !justUnfrozen) {
      _addBuff(entity, { id:'freezed_imm', turnsLeft:3 });
    }
    entity._hadFrozenLastTurn = stillFrozen;

    // 5) 敌方行动节点：结界 tick（燃烧/感电/超导的自身节点处理）见 _tickZonesAt(cs, entity)

    // 6) 风元素"双动"剩余次数：保留在 cs 里，节点 tick 时 decrement
    if (cs.windDashLeft > 0) cs.windDashLeft -= 1;
  }

  /* ==================== 伤害结算 ==================== */
  function _applyHpDelta(cs, entity, delta, elem) {
    if (!entity) return;
    entity.hp = Math.max(0, Math.min(entity.maxHp, (entity.hp || entity.maxHp) + delta));
    if (entity.hp <= 0) {
      entity.alive = false;
      _log(cs, `${entity.name||entity.key} 倒下了`);
    }
  }
  function _addBuff(entity, buff) {
    entity.buffs = entity.buffs || [];
    // 合并同 id：叠加 stacks / 延长 turnsLeft
    const exist = entity.buffs.find(b => b.id === buff.id);
    if (exist) {
      if (buff.layers) exist.layers = Math.min(10, (exist.layers || 0) + buff.layers);
      if (buff.turnsLeft !== undefined) exist.turnsLeft = Math.max(exist.turnsLeft || 0, buff.turnsLeft);
      return;
    }
    entity.buffs.push({ turnsLeft: 0, ...buff });
  }

  /* ==================== 冷却 tick ====================
     规格：敌方回合末尾统一 tickAllCooldowns()
     —— 取代旧版 castSkill 里 slot.cd = sk.cd 的直接覆盖 */
  function _tickAllCooldowns(cs) {
    if (!cs.skillGroup) return;
    cs.skillGroup.forEach(slot => {
      if (slot.cd > 0) slot.cd -= 1;
      if (slot.cd < 0) slot.cd = 0;
    });
  }

  /* ==================== 元素附着 + 反应 ==================== */
  function _getCellAura(cs, x, y) {
    const cell = cs.map.cells[y * cs.map.n + x];
    return cell.aura || null;
  }
  function _setCellAura(cs, x, y, elem, dur=0) {
    const cell = cs.map.cells[y * cs.map.n + x];
    cell.aura = elem;
    cell.auraDur = dur;
    cell.auraSourceKey = null; // 清空来源；谁打第二次附着谁是触发者
  }
  function _clearCellAura(cs, x, y) {
    const cell = cs.map.cells[y * cs.map.n + x];
    cell.aura = null; cell.auraDur = 0; cell.auraSourceKey = null;
  }

  /**
   * applyAuraWithReaction(cs, x, y, newElem, sourceKey)
   * —— 规格 §9.3 反应栈主循环（简化版）
   * 1) 检查反应
   * 2) 执行反应效果（燃烧/感电/超导 → 生成结界；蒸发/融化 → 给触发者 buff；超载/扩散/结晶/绽放/冻结/激化 → 各自效果）
   * 3) 清空该地块的元素附着（规格 §9.1 第 5 条）
   * 4) 处理扩散的特殊时序：先原地清，然后顺时针 8 格一圈（不含自身），子反应记录，一圈做完再处理连锁
   * 5) 同种元素 → 什么都不发生（规格 §9.1 第 3 条）
   */
  function applyAuraWithReaction(cs, x, y, newElem, sourceKey) {
    const cellAura = _getCellAura(cs, x, y);
    const reaction = Reactions.lookup(cellAura, newElem);

    // 同种元素 or 无反应异种 → 后者取代前者（规格 §9.1 第 4 条）
    if (!reaction) {
      // 异种但没反应 → 直接替换附着
      if (cellAura && cellAura !== newElem) {
        _setCellAura(cs, x, y, newElem, 0);
        _emit(cs, 'auraApplied', { x, y, elem:newElem, sourceKey });
      }
      return { reacted:false, kind:null };
    }

    // 有反应 → 立即处理（反应是游戏内最高优先级，暂停一切）
    _log(cs, `元素反应触发：${reaction.kind}`);
    _executeReaction(cs, x, y, newElem, sourceKey, reaction);
    // 反应后清空该地块元素附着（规格 §9.1 第 5 条）
    _clearCellAura(cs, x, y);
    return { reacted:true, kind:reaction.kind };
  }

  function _executeReaction(cs, x, y, newElem, sourceKey, reaction) {
    const ent = sourceKey ? _findEntity(cs, sourceKey) : null;

    switch (reaction.kind) {
      case 'evap_water': case 'evap_fire':
      case 'melt_fire':  case 'melt_ice':
        // 蒸发/融化：触发者（second=新附着者）获得 buff，独立叠加至多 2 层，无限持续，触发时一次性消耗
        if (ent) {
          const buffId = reaction.kind;
          let b = ent.buffs && ent.buffs.find(x => x.id === buffId);
          if (!b) {
            b = { id:buffId, layers:0, infinite:true };
            _addBuff(ent, b);
          }
          b.layers = Math.min(2, (b.layers || 0) + 1);
          _log(cs, `${ent.name||ent.key} 获得 ${reaction.kind} × ${b.layers} 层`);
        }
        break;

      case 'overload':
        // 超载：周围 5 格内与触发者敌对的单位，50% 基础攻击力火属性伤害
        {
          const targets = Reactions.overloadTargets(x, y, cs.map.n);
          let enemies = [];
          for (const t of targets) {
            const e = _entAt(cs, t.x, t.y);
            if (e && _isHostileTo(cs, e, sourceKey)) enemies.push(e);
          }
          for (const e of enemies) {
            const dmg = Math.max(1, Math.floor((ent && ent.atk || 1) * 0.5));
            _applyHpDelta(cs, e, -dmg, 'fire');
            _emit(cs, 'damageDone', { attackerKey: sourceKey, targetKey:e.key, damage:dmg, elem:'fire' });
          }
          _log(cs, `超载！造成 ${enemies.length} 名敌人 50% 攻击力火伤`);
        }
        break;

      case 'burn_zone': case 'electro_zone': case 'supercond_zone':
        _createZone(cs, x, y, reaction.meta.zoneType, 3, sourceKey);
        _log(cs, `生成 ${reaction.meta.zoneType} 结界（3 回合）`);
        break;

      case 'diffuse': {
        // 扩散：周围 9 格，顺时针。先原地清（主流程已清），然后子效果一圈（不含自身），子反应记录后处理
        const elem = newElem;  // 扩散的元素 = 新附着
        const targets = Reactions.diffusionTargets(x, y, cs.map.n);
        const pending = [];    // { x, y } —— 一圈内要施加新附着的格
        for (const t of targets) {
          const cell = cs.map.cells[t.y * cs.map.n + t.x];
          if (!cell || cell.terrain === 'void' || cell.terrain === 'obstacle') continue;
          // 扩散造成 30% 基础攻击力该元素伤害
          const dmg = Math.max(1, Math.floor((ent && ent.atk || 1) * 0.3));
          const e = _entAt(cs, t.x, t.y);
          if (e && _isHostileTo(cs, e, sourceKey)) {
            _applyHpDelta(cs, e, -dmg, elem);
            _emit(cs, 'damageDone', { attackerKey:sourceKey, targetKey:e.key, damage:dmg, elem });
          }
          // 记录要给该格施加新附着（扩散来源的第二元素）
          pending.push(t);
        }
        _log(cs, `扩散（${elem}）：顺时针处理 ${pending.length} 格`);
        // 一圈做完 → 对每一格施加第二元素（触发连锁）
        for (const t of pending) {
          applyAuraWithReaction(cs, t.x, t.y, elem, sourceKey);
        }
        // 计数器：扩散反应触发一次 +1（counter_diffuse trigger 依赖）
        cs.stats = cs.stats || { absorb: {}, reaction: {} };
        cs.stats.reaction.diffuse = (cs.stats.reaction.diffuse || 0) + 1;
        break;
      }

      case 'crystallize': {
        // 结晶：触发者立即获得 maxHp 8% 护盾（至少 10 点）；队友触发时改主角
        const target = ent && ent.faction === 'enemy' ? null :
          (ent && ent.ownerKey ? cs.hero : (ent && (ent.key === 'pro' || cs.allies[ent.key]) ? cs.hero : null));
        if (target && ent) {
          const shieldAmt = Math.max(10, Math.floor(target.maxHp * 0.08));
          _addBuff(target, { id:'shield', turnsLeft:1, amount: shieldAmt });
          _log(cs, `结晶：${target.name||target.key} 获得 ${shieldAmt} 护盾`);
        } else {
          _log(cs, `结晶：无合法目标（触发者 ${sourceKey}），跳过护盾`);
        }
        break;
      }

      case 'bloom': {
        // 绽放：周围 9 格的非实体地块，召唤一只草史莱姆（若自身格非实体则优先自身）
        let placed = null;
        const all = [{x, y}, ...Reactions.bloomTargets(x, y, cs.map.n)];
        for (const t of all) {
          const cell = cs.map.cells[t.y * cs.map.n + t.x];
          if (!cell || cell.terrain === 'void' || cell.terrain === 'obstacle') continue;
          if (_entAt(cs, t.x, t.y)) continue;
          placed = t; break;
        }
        if (placed) {
          const summonKey = 'summon_bloom_' + (cs.summons.length + 1);
          cs.summons.push({
            key: summonKey, name:'草史莱姆', ownerKey: sourceKey || 'pro',
            x: placed.x, y: placed.y, facing:'up',
            atk: 5, maxHp: 20, hp: 20, def: 0, speed: 3,
            faction: 'ally', alive: true, buffs: [], aiMode:'bloomSummon',
          });
          _log(cs, `绽放：生成一只草史莱姆（位于 ${placed.x},${placed.y}）`);
        } else {
          _log(cs, '绽放：周围 9 格都是实体，不召唤');
        }
        break;
      }

      case 'freeze': {
        // 冻结：地块上的实体获得 2 回合冻结 debuff
        const e = _entAt(cs, x, y);
        if (e && e.alive) {
          _addBuff(e, { id:'frozen', turnsLeft:2 });
          _log(cs, `${e.name||e.key} 被冻结（2 回合）`);
        }
        break;
      }

      case 'aggro': {
        // 激化：触发者所在阵营所有单位各获 2 层激化
        const faction = ent && ent.faction;
        const list = faction === 'ally' ? [cs.hero, ...Object.values(cs.allies)] :
                     faction === 'enemy' ? cs.enemies : [ent].filter(Boolean);
        for (const unit of list) {
          if (!unit) continue;
          let b = (unit.buffs || []).find(x => x.id === 'aggro');
          if (!b) { b = { id:'aggro', layers:0, infinite:true }; _addBuff(unit, b); }
          b.layers = Math.min(10, (b.layers || 0) + 2);
        }
        _log(cs, '激化：我方所有单位各 +2 层激化');
        break;
      }
    }
  }

  function _isHostileTo(cs, ent, sourceKey) {
    if (!ent) return false;
    const src = sourceKey ? _findEntity(cs, sourceKey) : null;
    const myFaction = src ? src.faction : 'ally';
    return ent.faction !== myFaction && ent.faction !== 'neutral';
  }

  /* ==================== 结界（zone） ==================== */
  function _createZone(cs, x, y, type, turns, ownerKey) {
    cs.zones = cs.zones || [];
    const zone = {
      id: type + '_' + (cs.zones.length + 1),
      type, x, y, turnsLeft: turns,
      ownerKey: ownerKey,
    };
    cs.zones.push(zone);
    _emit(cs, 'zoneCreated', zone);
  }
  function _tickZonesAt(cs, entity) {
    if (!cs.zones) return;
    for (const z of cs.zones) {
      if (z.turnsLeft <= 0) continue;
      const dx = Math.abs(entity.x - z.x), dy = Math.abs(entity.y - z.y);
      if (dx <= 0 && dy <= 0) {   // 结界只作用于自身格
        // 燃烧结界 → 自动给站在上面的单位 +burn debuff
        if (z.type === 'burn' && entity.faction !== 'neutral') {
          let b = entity.buffs && entity.buffs.find(x => x.id === 'burn');
          if (!b) { b = { id:'burn', turnsLeft:3 }; _addBuff(entity, b); }
          else if ((b.turnsLeft || 0) < 3) b.turnsLeft = 3;
        }
        // 超导结界 → 抗-40%（数据层直接挂 buff，结算时用）
        if (z.type === 'supercond' && entity.faction !== 'neutral') {
          let b = entity.buffs && entity.buffs.find(x => x.id === 'supercond');
          if (!b) _addBuff(entity, { id:'supercond', turnsLeft:1 });
        }
      }
    }
  }
  function _tickAllZones(cs) {
    if (!cs.zones) return;
    for (const z of cs.zones) {
      z.turnsLeft -= 1;
      if (z.turnsLeft <= 0) {
        // 超导结界消失时：离开即移除抗性减益 —— 在 entity.buffs 里 clean up 掉
        for (const e of _entityList(cs)) {
          e.buffs = (e.buffs || []).filter(b => !(b.id === 'supercond'));
        }
      }
    }
    cs.zones = cs.zones.filter(z => z.turnsLeft > 0);
  }

  /* ==================== 索敌 ====================
     规格：三条规则
     1) 技能描述文本里的关键词已经编码了索敌逻辑（skill.ruleTag / skill.hitTag 字段）
     2) 默认 "只打敌人"：target 在我方阵营里过滤掉
     3) skill.friendlyHit = true 时：允许命中我方（治疗 / buff）
  */
  function _resolveSkillTargets(cs, skill, owner, cx, cy) {
    const cells = Data.rangeOf(skill, cx, cy, owner.facing);
    const friendMode = !!skill.friendlyHit;
    const out = [];
    for (const c of cells) {
      const ent = _entAt(cs, c.x, c.y);
      if (!ent) continue;
      if (!ent.alive) continue;
      if (friendMode) {
        // 允许打我方
        out.push(ent);
      } else {
        // 默认只打敌人
        if (_isHostileTo(cs, ent, owner.key)) out.push(ent);
      }
    }
    // 自 buff 技能：自身也是合法目标
    if (skill.target === 'self') out.push(owner);
    // 去重
    const seen = new Set();
    return out.filter(e => { const k = e.key; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function _hasValidTarget(cs, skill, owner) {
    const targets = _resolveSkillTargets(cs, skill, owner, owner.x, owner.y);
    if (targets.length > 0) return true;
    // 纯自 buff 技能：自己就是目标（即使没其他敌人也可以释放）
    if (skill.target === 'self') return true;
    return false;
  }

  /* ==================== 技能释放（拆分成独立可测步骤） ==================== */
  function _ownerHasSkill(cs, ownerKey, slotIdx) {
    const slot = cs.skillGroup[slotIdx];
    if (!slot) return false;
    return slot.ownerKey === ownerKey;
  }
  function _cooldownAvailable(slot) { return (slot.cd || 0) <= 0; }

  function _castSkillPlan(cs, slotIdx, owner) {
    const slot = cs.skillGroup[slotIdx];
    if (!slot) return null;
    const skill = Data.getChar(slot.ownerKey)?.skills.find(s => s.id === slot.skillId);
    if (!skill) return null;
    const targets = _resolveSkillTargets(cs, skill, owner, owner.x, owner.y);
    return { slot, skill, targets, owner };
  }

  function _dealSkill(cs, plan) {
    const { slot, skill, targets, owner } = plan;
    _log(cs, `${owner.name||owner.key} 释放【${skill.name}】（${skill.kind}）`);

    // 冷却：立即置满（下次 cd-1 在敌方回合末尾统一 tick）
    slot.cd = skill.cd || 1;

    // 伤害源：实时取天赋叠加后的攻击力（depress/战斗中 buff 已在 charAtk 里处理）
    const atkNow = (typeof charAtk === 'function') ? charAtk(owner.key) : (owner.atk || 0);
    // 我方全局 buff：屏息 +10% 伤害（owner.buffs 里的屏息 debuff 被视为伤害 buff）
    const breathHold = (owner.buffs || []).some(b => b.id === 'breathHold');
    const breathBonus = breathHold ? 1.10 : 1.0;

    // 每个目标结算伤害
    for (const t of targets) {
      // 倍率伤害
      if (skill.mult && skill.mult > 0) {
        let base = atkNow * skill.mult;
        // 我方 buff：屏息 +10%
        base *= breathBonus;
        // 激化 buff：草/雷伤害 +10%/层；消耗 1 层
        const aggro = (owner.buffs || []).find(b => b.id === 'aggro');
        if (aggro && (skill.type === 'grass' || skill.type === 'thunder')) {
          const bonus = 1 + 0.10 * (aggro.layers || 1);
          base *= bonus; aggro.layers = Math.max(0, (aggro.layers || 1) - 1);
          if (aggro.layers <= 0) owner.buffs = owner.buffs.filter(b => b !== aggro);
        }
        // 暴击判定（按 owner.critRate，或硬编码 5%）
        let isCrit = false;
        const critChance = owner.critRate != null ? owner.critRate : 0.05;
        if (Math.random() < critChance) { isCrit = true; base *= 1.5; }
        // 目标防御 / 抗性修正
        let afterBase = base;
        // 物理伤害 → 减 def
        const elem = skill.type || 'physical';
        if (elem === 'physical') {
          const targetDef = t.def || 0;
          afterBase = Math.max(1, afterBase - targetDef);
        } else {
          // 元素伤害 → 查敌人 res 表里的抗性（0.0~1.0），或用默认 0
          const res = (t.res && t.res[elem]) || 0;
          afterBase = afterBase * (1 - Math.max(0, Math.min(0.8, res)));
        }
        // 目标易伤 debuff → 伤害 +50%
        const vuln = (t.buffs || []).some(b => b.id === 'vuln');
        if (vuln) afterBase *= 1.5;

        const dmg = Math.max(1, Math.floor(afterBase));
        _applyHpDelta(cs, t, -dmg, elem);
        _emit(cs, 'damageDone', { attackerKey:owner.key, targetKey:t.key, damage:dmg, elem, isCrit });
        const critTag = isCrit ? '（暴击！）' : '';
        _log(cs, `→ ${t.name||t.key} 受到 ${elem === 'physical' ? '物理' : elem + ' 元素'}伤害 ${dmg}${critTag}`);
      }
      // 技能自带 buff（燃烧/冻结/束缚/易伤）
      if (skill.burnDur) { _addBuff(t, { id:'burn', turnsLeft:skill.burnDur }); }
      if (skill.bind)   { _addBuff(t, { id:'bind', turnsLeft:skill.bind }); }
      if (skill.freeze) { _addBuff(t, { id:'frozen', turnsLeft:skill.freeze }); }
      if (skill.vulnDur && skill.vuln) { _addBuff(t, { id:'vuln', turnsLeft:skill.vulnDur }); }
    }

    // 地块附着（技能施加元素附着）
    if (skill.applyElem) {
      const cells = Data.rangeOf(skill, owner.x, owner.y, owner.facing);
      for (const c of cells) {
        applyAuraWithReaction(cs, c.x, c.y, skill.applyElem, owner.key);
        _emit(cs, 'auraApplied', { x:c.x, y:c.y, elem:skill.applyElem, sourceKey:owner.key });
      }
      // 计数器：每次我方技能施加元素附着都累加到 stats.absorb[elem]
      // （counter_fireAbsorb 等 trigger 依赖这个计数）
      cs.stats = cs.stats || { absorb: {}, reaction: {} };
      cs.stats.absorb[skill.applyElem] = (cs.stats.absorb[skill.applyElem] || 0) + cells.length;
    }

    // 行动计数（规格 §10.2：放主动/自动技能都算）
    cs.hero.actionCountThisTurn += (owner.key === 'pro') ? 1 : 0;
    // 连携窗口 check（ctx 含"刚才这个技能"的关键信息，供 trigger 判定）
    _checkLinkWindows(cs, owner, {
      skill,
      targets,
      applyElem: skill.applyElem || null,
      wasAuto: skill.kind === 'auto',
    });
  }

  /* ==================== 连携窗口队列 ==================== */
  /** LINK_TRIGGERS —— link 技能的 trigger 字段判定函数表
   *  每个函数签名: (cs, owner, ctx) => boolean
   *  ctx: { skill, targets, applyElem, wasAuto } —— 刚才释放的技能上下文
   *
   *  数据来源: js/data.js 里的 link 技能 trigger 字段
   */
  const LINK_TRIGGERS = {
    anyBurned: (cs) => cs.enemies.some(e => e.alive !== false && (e.buffs || []).some(b => b.id === 'burn')),

    elem4: (cs, owner) => {
      // 2 格内元素附着 ≥ 4
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (dx*dx + dy*dy > 4) continue;
          const c = cs.map.cells[(owner.y + dy) * cs.map.n + (owner.x + dx)];
          if (c && c.aura) n++;
        }
      return n >= 4;
    },

    allyApplyElem: (cs, owner, ctx) => !!ctx.applyElem,

    allyApplyFireWaterThunderIce: (cs, owner, ctx) => {
      const e = ctx.applyElem;
      return !!e && ['fire','water','thunder','ice'].indexOf(e) >= 0;
    },

    afterVehicleMove: (cs) => !!cs._lastWasVehicleMove,  // 当前战斗没载具移动，留口子

    enemyCharging: (cs) => cs.enemies.some(e => e.alive !== false && (e.buffs || []).some(b => b.id === 'charge' || b.id === 'inspire_charge')),

    counter_fireAbsorb: (cs) => {
      const n = (cs.stats && cs.stats.absorb && cs.stats.absorb.fire) || 0;
      // 一段 4 次吸收；二段 9 次吸收（焚灭）—— 4 次就能用（战斗中自动升级到二段）
      return n >= 4;
    },

    counter_diffuse: (cs) => {
      const n = (cs.stats && cs.stats.reaction && cs.stats.reaction.diffuse) || 0;
      return n >= 4;
    },
  };

  function _checkLinkWindows(cs, ownerJustActed, ctx) {
    // 触发条件：任何我方角色放完任意技能都检查
    if (!cs.pendingLinks) cs.pendingLinks = [];
    for (const slot of cs.skillGroup) {
      if (slot.kind !== 'link') continue;
      if (slot.cd > 0) continue;
      const skill = slot.skill;
      if (!skill) continue;
      const tr = skill.trigger;
      let ok = false;
      if (!tr) {
        // 没有 trigger 字段 → 任何技能释放都能触发（保守兜底）
        ok = true;
      } else if (LINK_TRIGGERS[tr]) {
        ok = !!LINK_TRIGGERS[tr](cs, ownerJustActed, ctx || {});
      } else {
        // 未知 trigger → 放行但打 warn（开发时让我们知道新触发没实现）
        console.warn('[Link] unknown trigger:', tr, 'for slot', slot.skillId);
        ok = true;
      }
      if (ok && !cs.pendingLinks.find(p => p.slotIdx === slot.slotIdx)) {
        cs.pendingLinks.push({ slotIdx: slot.slotIdx, ownerKey: slot.ownerKey });
        _log(cs, `连携条件满足：【${slot.skillName}】进入等待队列（2 秒内按 E 可使用）`);
      }
    }
    if (cs.pendingLinks.length > 0 && !cs.linkTimer) {
      _openNextLinkWindow(cs);
    }
  }

  function _openNextLinkWindow(cs) {
    if (!cs.pendingLinks || cs.pendingLinks.length === 0) return;
    const head = cs.pendingLinks[0];
    const slot = cs.skillGroup[head.slotIdx];
    cs.linkWindowOpen = true;
    cs.linkOwnerKey = head.ownerKey;
    cs.linkSlotIdx = head.slotIdx;
    _emit(cs, 'linkWindowChange', {
      open:true,
      skillName: slot && slot.skillName || slot.skillId,
      deadlineMs: Date.now() + LINK_WINDOW_MS,
    });
    if (cs.linkTimer) clearTimeout(cs.linkTimer);
    cs.linkTimer = setTimeout(() => {
      // 超时：shift 队列下一个（规格）
      cs.pendingLinks.shift();
      cs.linkWindowOpen = false;
      _emit(cs, 'linkWindowChange', { open:false });
      if (cs.pendingLinks.length > 0) {
        _openNextLinkWindow(cs);
      }
    }, LINK_WINDOW_MS);
  }

  /* ==================== Phase 驱动 ==================== */
  function _setPhase(cs, p) {
    const prev = cs.phase;
    cs.phase = p;
    _emit(cs, 'phaseChange', { from: prev, to: p });
  }
  function _phaseRoundStart(cs) {
    _log(cs, `—— 第 ${cs.round} 回合开始 ——`);
    // 清除上回合所有残存时间 / 自动次数
    cs.hero.autoUses = 1;  // 每回合主角仍可 1 次主动（规格明确：主动次数每回合独立）
    // 行动计数 +1 归零（规格：每回合）
    cs.hero.actionCountThisTurn = 0;
    // 队友的自动次数
    for (const k in cs.allies) cs.allies[k].autoUses = 1;

    // 所有我方单位的行动节点
    _triggerEntityNode(cs, cs.hero);
    for (const k in cs.allies) _triggerEntityNode(cs, cs.allies[k]);
    for (const e of cs.enemies) _triggerEntityNode(cs, e);
    for (const s of cs.summons) _triggerEntityNode(cs, s);

    _setPhase(cs, PHASES.MANUAL);
  }
  function _phaseAutoSkills(cs) {
    // 按技能组顺序遍历所有 kind==='auto' 的槽，自动释放
    for (const slot of cs.skillGroup) {
      if (slot.kind !== 'auto') continue;
      if (slot.cd > 0) continue;
      const owner = _findEntity(cs, slot.ownerKey);
      if (!owner || owner.alive === false) continue;
      if (_hasHardControl(owner)) continue;
      const plan = _castSkillPlan(cs, slot.slotIdx, owner);
      if (!plan || plan.targets.length === 0) {
        // 自动技能无合法目标：跳过，不转冷却
        continue;
      }
      _dealSkill(cs, plan);
      slot.cd = slot.skill?.cd || 1;
    }
    _setPhase(cs, PHASES.ENEMY);
  }
  function _phaseEnemy(cs) {
    // 按规格顺序：先 triggerNode（先扣冻结/束缚持续时间！）→ 再检查硬控 → 再 AI
    const order = cs.enemies.filter(e => e && e.alive !== false)
      .slice()
      .sort((a, b) => (a.x+a.y) - (b.x+b.y) || (a.key||'').localeCompare(b.key||''));
    for (const e of order) {
      _triggerEntityNode(cs, e);
      if (_hasHardControl(e)) {
        _log(cs, `${e.name||e.key} 被硬控制，跳过本回合`);
        continue;
      }
      _enemyAct(cs, e);
    }
    _setPhase(cs, PHASES.SUMMONS);
  }
  function _enemyAct(cs, e) {
    const hero = cs.hero;
    // 有合法攻击目标在 front2 就放普攻，否则移动 1 格
    const atkRange = Data.rangeOf({ target:'front2' }, e.x, e.y, e.facing);
    let attacked = false;
    for (const c of atkRange) {
      const t = _entAt(cs, c.x, c.y);
      if (t && _isHostileTo(cs, t, e.key)) {
        const dmg = Math.max(1, Math.floor(e.atk || 1));
        _applyHpDelta(cs, t, -dmg, 'physical');
        _emit(cs, 'damageDone', { attackerKey:e.key, targetKey:t.key, damage:dmg, elem:'physical' });
        _log(cs, `${e.name||e.key} 普攻 ${t.name||t.key} → ${dmg} 物理伤害`);
        attacked = true; break;
      }
    }
    if (attacked) return;
    // 移动：朝 hero 方向 1 格
    const dx = Math.sign(hero.x - e.x), dy = Math.sign(hero.y - e.y);
    const tryDir = [[dx,dy],[dx,0],[0,dy]];
    for (const [mx, my] of tryDir) {
      if (!mx && !my) continue;
      const nx = e.x + mx, ny = e.y + my;
      if (!_inBounds(cs, nx, ny)) continue;
      const cell = cs.map.cells[ny * cs.map.n + nx];
      if (cell.terrain === 'void' || cell.terrain === 'obstacle') continue;
      if (_entAt(cs, nx, ny)) continue;
      e.facing = (mx===1?'right':mx===-1?'left':my===1?'down':my===-1?'up':e.facing);
      e.x = nx; e.y = ny;
      return;
    }
  }
  function _phaseSummons(cs) {
    // 召唤物行动：按简单 AI（朝最近敌人逼近 + 普攻）
    for (const s of cs.summons) {
      if (!s || s.alive === false) continue;
      if (_hasHardControl(s)) continue;
      // 简易：攻击周围 4 格第一个敌对单位
      const cells = Data.rangeOf({ target:'adj4' }, s.x, s.y, s.facing);
      for (const c of cells) {
        const t = _entAt(cs, c.x, c.y);
        if (t && _isHostileTo(cs, t, s.key)) {
          const dmg = Math.max(1, Math.floor(s.atk || 1));
          _applyHpDelta(cs, t, -dmg, 'physical');
          _log(cs, `${s.name} 普攻 ${t.name||t.key} → ${dmg}`);
          break;
        }
      }
    }
    _setPhase(cs, PHASES.ROUND_END);
  }
  function _phaseRoundEnd(cs) {
    // 1) 冷却 tick：敌方回合末尾统一 tickAllCooldowns()（规格 §9.2 / §10）
    _tickAllCooldowns(cs);
    // 2) 结界 tick
    _tickAllZones(cs);
    // 3) 胜负检查
    const heroDead = cs.hero.alive === false;
    const enemiesAllDead = cs.enemies.every(e => e.alive === false);
    if (heroDead) {
      _log(cs, '主角倒下，战斗失败');
      _emit(cs, 'combatEnd', { win:false });
      _stopLoop(cs);
      return;
    }
    if (enemiesAllDead) {
      _log(cs, '全部敌人倒下，战斗胜利');
      _emit(cs, 'combatEnd', { win:true });
      _stopLoop(cs);
      return;
    }
    // 4) 进入下回合
    cs.round += 1;
    _setPhase(cs, PHASES.ROUND_START);
  }

  /* ==================== 主循环 ====================
     每 tick 检查一次：
     - 手动阶段：残存时间到期？ → 自动结束手动阶段
     - 非手动阶段：当前 phase 是不是"等待"状态？如果是则切下一 phase */
  function _tick(cs) {
    if (!cs || !cs.phase) return;

    // 手动阶段：残存时间到期 → 进入 autoSkills
    if (cs.phase === PHASES.MANUAL) {
      if (cs.remnantTimer && Date.now() >= cs.remnantTimer) {
        _log(cs, '残存时间到期，结束手动阶段');
        cs.remnantTimer = null;
        _setPhase(cs, PHASES.AUTO_SKILLS);
        return;
      }
      return;  // 手动阶段 tick 不动
    }

    // phase 状态驱动：ROUND_START / AUTO_SKILLS / SUMMONS / ENEMY / ROUND_END
    switch (cs.phase) {
      case PHASES.ROUND_START:   _phaseRoundStart(cs);   break;
      case PHASES.AUTO_SKILLS:   _phaseAutoSkills(cs);   break;
      case PHASES.SUMMONS:       _phaseSummons(cs);       break;
      case PHASES.ENEMY:         _phaseEnemy(cs);         break;
      case PHASES.ROUND_END:     _phaseRoundEnd(cs);     break;
    }
  }

  function _startLoop(cs) {
    if (cs._loopHandle) clearInterval(cs._loopHandle);
    cs._loopHandle = setInterval(() => _tick(cs), TICK_MS);
  }
  function _stopLoop(cs) {
    if (cs._loopHandle) { clearInterval(cs._loopHandle); cs._loopHandle = null; }
    if (cs.linkTimer) { clearTimeout(cs.linkTimer); cs.linkTimer = null; }
  }

  /* ==================== 玩家操作实现 ==================== */
  function _canInteractManual(cs) {
    return cs && cs.phase === PHASES.MANUAL;
  }

  /* public: selectChar */
  function selectChar(charKey) {
    const cs = _cs;
    if (!cs) return;
    const ent = _findEntity(cs, charKey);
    if (!ent || ent.faction === 'enemy') return;
    cs.currentCharKey = charKey;
    _emit(cs, 'charSelected', charKey);
  }

  /* public: selectSkill */
  function selectSkill(slotIdx) {
    const cs = _cs;
    if (!cs) return;
    if (!_canInteractManual(cs)) return;
    const slot = cs.skillGroup[slotIdx];
    if (!slot) return;
    cs.selectedSlotIdx = slotIdx;
    _emit(cs, 'skillSelected', slotIdx);
  }

  /* public: castSkill */
  function castSkill(slotIdx) {
    const cs = _cs;
    if (!cs) return false;
    if (!_canInteractManual(cs)) { _log(cs, '当前阶段不能释放技能'); return false; }
    const slot = cs.skillGroup[slotIdx];
    if (!slot) return false;
    if (slot.kind !== 'active') { _log(cs, '该技能不是主动技能，无法手动释放'); return false; }
    if (slot.ownerKey !== cs.hero.key) { _log(cs, '该技能不属于主角，由自动技能阶段自动释放'); return false; }
    if (slot.cd > 0) { _log(cs, `冷却中，剩余 ${slot.cd} 回合`); return false; }
    if (_hasHardControl(cs.hero)) { _log(cs, '被硬控制，无法释放'); return false; }
    const hero = cs.hero;
    const plan = _castSkillPlan(cs, slotIdx, hero);
    const skill = slot.skill;
    // 纯自 buff（target==='self'）：自身就是合法目标，允许释放
    const selfBuff = skill && skill.target === 'self';
    if (!plan || plan.targets.length === 0) {
      if (!selfBuff) {
        _log(cs, '当前没有可命中的目标'); return false;
      }
    }
    // ensure plan 存在（纯自 buff 也应该有，保险起见）
    const finalPlan = plan || _castSkillPlan(cs, slotIdx, hero) || {
      slot, skill, targets: [hero], owner: hero,
    };
    _dealSkill(cs, finalPlan);
    return true;
  }

  /* public: move */
  function move(dx, dy) {
    const cs = _cs;
    if (!cs) return false;
    if (!_canInteractManual(cs)) return false;
    if (_hasHardControl(cs.hero)) { _log(cs, '被硬控制，无法移动（按键已发出但效果空转——规格要求）'); }

    const hero = cs.hero;
    const facing = (dx===1?'right':dx===-1?'left':dy===1?'down':dy===-1?'up':hero.facing);
    hero.facing = facing;

    let moved = false;
    const nx = hero.x + dx, ny = hero.y + dy;
    if (_inBounds(cs, nx, ny)) {
      const cell = cs.map.cells[ny * cs.map.n + nx];
      if (cell.terrain !== 'void' && cell.terrain !== 'obstacle' && !_entAt(cs, nx, ny)) {
        hero.x = nx; hero.y = ny; moved = true;
      }
    }
    // 行动计数 +1（规格：移动无论成功与否都算）
    cs.hero.actionCountThisTurn += 1;
    _log(cs, `主角 ${moved ? '移动到' : '转向'} (${hero.x},${hero.y})`);

    // 进入地块 → 触发地块内容（当前简化：若地块上有元素附着则触发反应）
    const aura = _getCellAura(cs, hero.x, hero.y);
    if (aura) {
      // 主角站在带附着的地块上 → 触发地块的结界自身节点（燃烧/感电/超导）
    }
    // 残存时间：移动后启动 1 秒窗口
    cs.remnantTimer = Date.now() + REMNANT_MS;
    return true;
  }

  /* public: skipTurn */
  function skipTurn() {
    const cs = _cs;
    if (!cs) return;
    if (!_canInteractManual(cs)) return;
    // 规格：跳过也算行动（actionCountThisTurn += 1）
    cs.hero.actionCountThisTurn += 1;
    _log(cs, '主角跳过回合');
    // 结束手动阶段 → 进入 autoSkills
    cs.remnantTimer = null;
    _setPhase(cs, PHASES.AUTO_SKILLS);
  }

  /* public: tryLinkUse */
  function tryLinkUse() {
    const cs = _cs;
    if (!cs) return;
    if (!cs.linkWindowOpen) { _log(cs, '当前没有可使用的连携技能'); return; }
    const head = cs.pendingLinks[0];
    const slot = cs.skillGroup[head.slotIdx];
    const owner = _findEntity(cs, head.ownerKey);
    if (!owner) return;
    if (slot.cd > 0) {
      _log(cs, `${slot.skillId} 冷却中`);
      return;
    }
    const plan = _castSkillPlan(cs, head.slotIdx, owner);
    if (!plan || plan.targets.length === 0) {
      _log(cs, '连携：无合法目标，跳过');
    } else {
      _dealSkill(cs, plan);
    }
    slot.cd = (slot.skill?.cd || 1);
    // shift 队列 + 重置窗口
    cs.pendingLinks.shift();
    cs.linkWindowOpen = false;
    if (cs.linkTimer) { clearTimeout(cs.linkTimer); cs.linkTimer = null; }
    _emit(cs, 'linkWindowChange', { open:false });
    if (cs.pendingLinks.length > 0) _openNextLinkWindow(cs);
  }

  /* public: flee */
  function flee() {
    const cs = _cs;
    if (!cs) return false;
    const canFlee = (
      cs.phase === PHASES.MANUAL
      && cs.hero.actionCountThisTurn === 0
      && !_hasHardControl(cs.hero)
    );
    if (!canFlee) {
      _log(cs, '当前无法逃跑：需手动阶段 + 行动计数 = 0 + 主角无硬控');
      return false;
    }
    // 规格公式：主角速度 - max(敌人速度 × 剩余HP%)
    const proba = Math.max(
      0, Math.min(100,
        (cs.hero.speed || 30)
        - Math.max(...cs.enemies.map(e => (e.speed || 4) * ((e.hp / e.maxHp) || 0)))
      )
    );
    const success = Math.random() * 100 < proba;
    _log(cs, `逃跑判定（当前概率 ${Math.floor(proba)}%）：${success ? '成功！' : '失败！'}`);
    if (success) {
      _emit(cs, 'combatEnd', { win:false, fled:true });
      _stopLoop(cs);
      return true;
    }
    // 逃跑失败：主角视为跳过回合 + 失去本回合主动技能次数
    cs.hero.actionCountThisTurn += 1;
    cs.remnantTimer = null;
    _setPhase(cs, PHASES.AUTO_SKILLS);
    return false;
  }

  /* public: cancelSelection */
  function cancelSelection() {
    const cs = _cs;
    if (!cs) return;
    cs.selectedSlotIdx = null;
    _emit(cs, 'skillSelected', null);
  }

  /* public: getState — UI 只读查询用 */
  function getState() { return _cs ? _cs : null; }
  function getSkillDesc(slotIdx) {
    const cs = _cs; if (!cs) return null;
    const slot = cs.skillGroup[slotIdx]; if (!slot) return null;
    return Data.getChar(slot.ownerKey)?.skills.find(s => s.id === slot.skillId) || null;
  }

  /* public: onEvent — 事件订阅 */
  function onEvent(event, handler) {
    const cs = _cs; if (!cs) { console.warn('combat.onEvent: 未初始化'); return; }
    cs.handlers = cs.handlers || {};
    (cs.handlers[event] = cs.handlers[event] || []).push(handler);
  }

  /* ==================== startBattle ====================
     对外唯一的"进入战斗"入口
     
     enemies: [{ key:'slime_1', proto:'slime', x, y }, ...]  或 ENEMIES 里的 proto key
     opts: {
       mapSnapshot,          // 战斗时的地图快照（cells 数组）
       mapN,                 // 地图边长
       teamKeys,             // 参战队友 keys，默认 ['xiayang','luyouyou']
       heroStart,            // 主角起始 {x,y,facing}
       skillGroupOverride,   // 可选覆盖编队共用技能组
     }
  */
  function startBattle(enemies, opts) {
    opts = opts || {};
    const mapN = opts.mapN || (opts.mapSnapshot ? Math.sqrt(opts.mapSnapshot.length) : 9);
    const cells = opts.mapSnapshot || new Array(mapN * mapN).fill(null).map((_, i) => ({
      terrain:'ground', aura:null, auraDur:0, x: i % mapN, y: Math.floor(i / mapN),
    }));
    // 确保每个 cell 有 x,y
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].x === undefined) cells[i].x = i % mapN;
      if (cells[i].y === undefined) cells[i].y = Math.floor(i / mapN);
    }

    const teamKeys = opts.teamKeys || ['pro', 'xiayang', 'luyouyou'];
    const heroStart = opts.heroStart || { x:1, y:mapN-2, facing:'up' };

    // 构造 cs
    const cs = {
      phase: null,
      round: 1,
      currentCharKey: 'pro',
      selectedSlotIdx: null,
      actionCountThisTurn: 0,
      // 主角（数值从天赋叠加函数取；depress 会在 charAtk/totalHeroDefense 里处理）
      hero: {
        key:'pro', name:'主角', faction:'ally', alive:true,
        x: heroStart.x, y: heroStart.y, facing: heroStart.facing,
        maxHp: heroDisplayMaxHp(),
        hp: (window.G && window.G.hero) ? (window.G.hero.hp ?? heroDisplayMaxHp()) : heroDisplayMaxHp(),
        atk: charAtk('pro'),
        def: totalHeroDefense(),
        speed: (window.G && window.G.hero) ? (window.G.hero.speed ?? 30) : 30,
        critRate: (typeof baseCritRate === 'function' ? baseCritRate('pro') : 5) / 100,
        dodgeRate: (typeof heroDodgeRate === 'function' ? heroDodgeRate() : 0) / 100,
        buffs: [], autoUses: 1,
        // 残存时间计时
        remnantTimer: null,
      },
      allies: {},
      enemies: [],
      summons: [],
      map: { n: mapN, cells },
      zones: [],
      realm: null,
      reactionStack: [],
      // 连携
      pendingLinks: [],
      linkWindowOpen: false,
      linkTimer: null,
      windDashLeft: 0,
      // 统计计数器（counter_fireAbsorb / counter_diffuse 等 trigger 用）
      stats: { absorb: {}, reaction: {} },
      // 事件回调
      handlers: {
        phaseChange: [], log: [], combatEnd: [],
        skillSelected: [], charSelected: [],
        auraApplied: [], zoneCreated: [], damageDone: [], linkWindowChange: [],
      },
    };

    // 队友（有 buff/debuff 列表，可挂冻结/束缚/屏息/比翼等；但没有 HP/DEF/受伤系统）
    for (const k of teamKeys) {
      if (k === 'pro') continue;
      const def = Data.getChar(k); if (!def) continue;
      cs.allies[k] = {
        key: def.key, name: def.name, faction:'ally', alive:true,
        x: heroStart.x, y: heroStart.y, facing:'up',
        // atk 走天赋叠加（队友 scal.atk / scal.self 以及主角 scal.pro 都加进来）
        atk: (typeof charAtk === 'function') ? charAtk(k) : (def.base?.atk || 35),
        critRate: (typeof baseCritRate === 'function' ? baseCritRate(k) : 5) / 100,
        buffs: [], autoUses: 1,
      };
    }

    // 敌人
    for (const raw of enemies) {
      let protoKey = raw.proto || raw;
      const def = Data.ENEMIES[protoKey];
      if (!def) { console.warn('startBattle: unknown enemy proto', protoKey); continue; }
      cs.enemies.push({
        key: raw.key || (protoKey + '_' + (cs.enemies.length + 1)),
        name: def.name || protoKey, faction:'enemy', alive:true,
        x: raw.x !== undefined ? raw.x : 7,
        y: raw.y !== undefined ? raw.y : 3,
        facing:'up',
        maxHp: def.maxHp || 100, hp: def.maxHp || 100,
        atk: def.atk || 10, def: def.def || 0, speed: def.speed || 4,
        res: def.res || {},
        buffs: [],
      });
    }

    // 技能组（flat，按 active→auto→link 排序；每个 slot 都必须挂完整 skill 定义）
    const kOrder = { active:0, auto:1, link:2 };

    // 统一的技能组构建 helper：给一个 slot 原始条目，挂上完整 skill 定义
    function _buildSlot(rawSlot, slotIdx) {
      const ownerKey = rawSlot.ownerKey || rawSlot.charKey;
      const skillId = rawSlot.skillId;
      let sk = rawSlot.skill || null;
      if (!sk && ownerKey && skillId) {
        const c = window.Data.getChar(ownerKey);
        sk = c ? (c.skills||[]).find(s => s.id === skillId) : null;
      }
      const kind = rawSlot.kind || (sk && sk.kind) || 'active';
      return {
        slotIdx, skillId, skillName: (sk && sk.name) || rawSlot.skillName || skillId,
        ownerKey, kind, cd: 0, skill: sk,
      };
    }

    const groupOverride = opts.skillGroupOverride;
    let rawSlots = null;

    if (groupOverride && Array.isArray(groupOverride)) {
      rawSlots = groupOverride;
    } else {
      // 兜底：如果 G.skillGroup 已由编队编辑器保存 → 直接用它；
      // 否则用 buildDefaultSkillGroup 的默认数量（pro:3, xiayang:2, luyouyou:2）
      try { src = (typeof G !== 'undefined' && G && G.skillGroup) || null; } catch(e) { src = null; }
      if (src && src.length) {
        rawSlots = src;
      } else {
        const list = [];
        const perChar = { pro:3, xiayang:2, luyouyou:2 };
        for (const tk of teamKeys) {
          const def = Data.getChar(tk); if (!def) continue;
          const take = perChar[tk] || 2;
          const ids = (def.defaultSkillIds||[]).slice(0, take);
          for (const sid of ids) {
            const sk = (def.skills || []).find(s => s.id === sid);
            if (!sk) continue;
            list.push({ ownerKey: tk, skillId: sid, kind: sk.kind, skillName: sk.name, skill: sk });
          }
        }
        rawSlots = list;
      }
    }

    // 全部 buildSlot + 强制 active→auto→link 排序
    cs.skillGroup = rawSlots
      .map((r, i) => _buildSlot(r, i))
      .filter(s => s.skill)  // 没有 skill 定义的 slot 丢弃（避免 _dealSkill 里崩）
      .sort((a, b) => (kOrder[a.kind] ?? 9) - (kOrder[b.kind] ?? 9)
                     || (a.slotIdx || 0) - (b.slotIdx || 0));
    cs.skillGroup.forEach((s, i) => s.slotIdx = i);

    // 清掉旧 _cs，挂新的
    if (_cs && _cs._loopHandle) _stopLoop(_cs);
    _cs = cs;
    window.combatState = cs;  // 保留旧调用方式的兼容入口（ui.js / explore.js 里可能引用）

    // ⚠️ 必须在 tick 之前切 UI mode —— 只有 mode='combat' 时 #combatZone 才 display:flex
    // 不管走 Combat.startBattle 新 API 还是 window.startCombat 旧 shim 都会调到这里
    if (typeof window.switchMode === 'function') {
      try { window.switchMode('combat'); } catch(e) { console.warn('startBattle: switchMode fail', e.message); }
    }

    // 切 phase → ROUND_START → 开始 tick
    _setPhase(cs, PHASES.ROUND_START);
    _startLoop(cs);

    _emit(cs, 'charSelected', 'pro');
    _emit(cs, 'skillSelected', null);
    _log(cs, `战斗开始！共 ${cs.enemies.length} 名敌人`);
    return cs;
  }

  /* ==================== 公开 API 导出 ==================== */
  const publicAPI = {
    startBattle,
    selectChar, selectSkill, castSkill, move, skipTurn,
    tryLinkUse, flee, cancelSelection,
    getState, getSkillDesc, onEvent,
    // 兼容旧代码的 stopBattle（结算后由外部调用）
    stopBattle: () => { if (_cs) { _stopLoop(_cs); _cs = null; } window.combatState = null; },
  };

  window.Combat = publicAPI;

  /* 兼容旧代码：window.combatState 在 startBattle 里被赋值为 _cs；
     combat.js.bak 等旧文件里可能有 `window.combatState` 直接读。
     我们不阻止外部读，但外部**不**应该**写**它——所有写都走 publicAPI。 */

})();

/* ==================== 旧入口 shim（保持 explore.js / event.js / main.js 兼容）
   ──────────────────────────────────────────────
   旧签名：
     window.startCombat(target)    target 可以是战斗格对象 { content:{key:'slime'} } 或直接敌人 proto key
     window.reenterCombat(c)       c 是 G.combat（从存档读回来的快照）
   
   新签名：
     Combat.startBattle(enemies, opts?)  enemies 是数组 [{key, proto, x, y}, ...]
   ============================================== */
window.startCombat = function(target) {
  // 从 target 里提 enemy proto key
  let protoKey, sub='', done=false, rare=false;
  if (typeof target === 'string') { protoKey = target; }
  else if (target && target.content) {
    const ct = target.content;
    protoKey = ct.key; sub = ct.sub || ''; done = !!ct.done; rare = !!ct.rare;
    // 标记该格已进入战斗（避免重复触发）
    if (target && typeof target.content !== 'undefined') {
      // done 标记等战斗结束由 ui.js 里 win/fail 回调设置
    }
  } else { protoKey = String(target); }

  if (!protoKey) { console.warn('startCombat: 无法解析敌人'); return; }

  // 估算当前地图上敌人起始位置（避开主角）
  const mapN = (G && G.map && G.map.n) || 9;
  const px = G && G.px !== undefined ? G.px : 1;
  const py = G && G.py !== undefined ? G.py : 1;

  // 敌人数量：普通 2-3 只，紧急 3-4 只，boss 1 只
  let count = 2 + Math.floor(Math.random() * 2);  // 2 或 3
  if (sub === 'hard') count = 3 + Math.floor(Math.random() * 2);  // 3 或 4
  if (sub === 'boss') count = 1;

  const enemies = [];
  let ek = 0;
  for (let i = 0; i < count; i++) {
    let ex, ey, tries = 0;
    do {
      ex = Math.floor(Math.random() * mapN);
      ey = Math.floor(Math.random() * mapN);
      tries++;
      // 必须满足：离主角至少 2 格（曼哈顿） AND 不是障碍地块 AND 不是 void
      const cell = (G && G.map && G.map.cells) ? G.map.cells[ey*mapN + ex] : null;
      const isBlock = cell && (cell.terrain === 'obstacle' || cell.terrain === 'void');
      const farEnough = (Math.abs(ex - px) + Math.abs(ey - py) >= 2);
      if (farEnough && !isBlock) break;
    } while (tries < 60);
    enemies.push({ key: protoKey + '_' + (++ek), proto: protoKey, x: ex, y: ey });
  }

  const teamKeys = (G && G.team) ? G.team.slice() : ['pro', 'xiayang', 'luyouyou'];

  // 建地图快照（元素附着要完整拷贝）
  const rawCells = (G && G.map && G.map.cells) ? G.map.cells : null;
  const cells = rawCells ? rawCells.map(c => ({ ...c, aura: c.aura || null })) : null;

  // 先调用 startBattle 把 cs 挂好（window.combatState）
  const cs = Combat.startBattle(enemies, {
    mapSnapshot: cells,
    mapN,
    teamKeys,
    heroStart: { x: px, y: py, facing: (G && G.hero && G.hero.facing) || 'up' },
    skillGroupOverride: null,  // 用默认编队共用技能组（active→auto→link）
  });

  // 把 G.map 里那个触发战斗的 cell 引用 + 主角进入前位置存在 cs 上
  // 战斗结束时（胜利/逃跑）要把 cell.content.done = true 并恢复主角到这个格子
  cs.refCell = (G && G.map && typeof target === 'object') ? target : null;
  cs.refPos = { x: px, y: py };

  // 再切 mode='combat' + 渲染（此时 cs 已挂，renderMap 能画出敌人）
  if (typeof window.switchMode === 'function') window.switchMode('combat');
  if (typeof window.renderMap === 'function') window.renderMap();
};

window.reenterCombat = function(snap) {
  // 从存档读回来的 G.combat 快照：里面有 enemies / cells / skillGroup / round 等
  // 为保持旧存档可读，我们也能接受 snap 是 combatState 风格的对象
  if (!snap) return;
  const enemies = (snap.enemies || []).map(e => ({
    key: e.key || (e.proto + '_' + Math.random().toString(36).slice(2,6)),
    proto: e.proto || (e.constructor && e.constructor.name === 'Object' ? Object.keys(window.Data.ENEMIES)[0] : 'slime'),
    x: e.x, y: e.y,
  }));
  if (typeof window.switchMode === 'function') window.switchMode('combat');
  Combat.startBattle(enemies, {
    mapSnapshot: snap.mapCells || null,
    mapN: snap.mapN || 9,
    teamKeys: snap.teamKeys || (G && G.team) || ['pro', 'xiayang', 'luyouyou'],
    heroStart: { x: (snap.hero && snap.hero.x) || 1, y: (snap.hero && snap.hero.y) || 1, facing: (snap.hero && snap.hero.facing) || 'up' },
    skillGroupOverride: snap.skillGroup || null,
  });
};

/* 旧 combat.js.bak 里遗留的 tryCastSkill / combatMove 等 API —— 全部已废弃，
   由 Combat.castSkill / Combat.move / Combat.selectSkill / Combat.skipTurn 取代。
   兼容 shim 到此为止。 */
