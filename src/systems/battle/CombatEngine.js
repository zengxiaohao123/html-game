/**
 * systems/battle/CombatEngine.js —— 战斗主引擎
 *
 * 覆盖：回合流程（§4.2）、行动节点（§4.2.3）、伤害公式（§4.8）、
 *   护盾防御（§4.9）、闪避格挡（§4.9.1）、元素手牌（§4.7）、
 *   技能执行（DSL）、连携队列（§4.5.4）、敌人意图/AI（§4.11/§4.12）、
 *   逃跑（§4.10.4）、胜负与清理（§4.10）。
 *
 * 引擎通过 EventBus 广播战斗事件，UI 只读渲染；玩家操作由 UI 调引擎方法。
 */

import { CONFIG, BattleResult, DamageKind, SkillType } from '../../core/Const.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { GameLog, devLog } from '../../core/Logger.js';
import { rng } from '../../core/Rng.js';
import { BattleSession, BattleUnit } from './BattleSession.js';
import { getNode } from '../../data/battleNodes.js';
import { getEnemy, SLIME_IDS, SUMMONS } from '../../data/enemies.js';
import { getSkill, CHARACTERS } from '../../data/skills.js';
import { STATUS } from '../../data/buffs.js';
import { applyAura } from './ReactionEngine.js';

export class CombatEngine {
  constructor(gs) {
    this.gs = gs;
    this.session = null;
    this.ctx = { session: null, engine: this, reactionQueue: [] };
  }

  get S() { return this.session; }

  // ================= 开局 =================
  startBattle(nodeId) {
    const node = getNode(nodeId);
    if (!node) { devLog.error('combat', '未知战斗节点', nodeId); return null; }
    const S = new BattleSession({ gs: this.gs, node, party: this.gs.party });
    this.session = S;
    this.ctx.session = S;

    S.deployLeader(this.gs.party, this.gs);
    S.deployCompanions(this.gs.party);
    this._initTalents();
    this._deployWaves(1, true);

    S.phase = 'player';
    EventBus.emit(GE.BATTLE_START, { node });
    GameLog.system('combat', `战斗开始：${node.name}`);
    this._beginRound(true);
    return S;
  }

  _initTalents() {
    // 队友天赋基础攻加成
    for (const comp of this.S.companions) {
      for (const t of comp.talents) {
        if (t.impl === 'fearless') { comp.stats.atk += 45; comp.base.atk += 45; }
        if (t.impl === 'windbreath') { comp.stats.atk += 60; comp.base.atk += 60; this.S.leader.critRate += 0.30; }
        if (t.impl === 'cooking') { /* 主角 maxHp 已在探索侧加 */ }
      }
    }
    // 主角天赋 何以为我：本战斗元素伤害种类计数
    this.S.leader.meta.dealtElementKinds = new Set();
    this.S.leader.meta.physBonus = 0.50; // 物理 +50%
  }

  _deployWaves(round, isStart = false) {
    const node = this.S.node;
    for (const wave of node.waves || []) {
      if (wave.atRound !== round) continue;
      if (wave.chance !== undefined && wave.decideAtStart && !isStart) continue;
      if (wave.chance !== undefined && !rng.roll(wave.chance)) continue;
      // 指定敌人
      for (const eid of wave.enemies || []) this.S.deployEnemy(eid);
      if (wave.also) for (const eid of wave.also) this.S.deployEnemy(eid);
      // 随机史莱姆
      for (let i = 0; i < (wave.randomSlimes || 0); i++) {
        this.S.deployEnemy(rng.pick(SLIME_IDS));
      }
    }
    // 敌人入场天赋
    for (const u of this.S.enemies()) this._onEnemySpawn(u);
  }

  // ================= 回合流程 =================
  _beginRound(first = false) {
    const S = this.S;
    if (!first) S.round += 1; else S.round = 1;
    EventBus.emit(GE.BATTLE_ROUND, { round: S.round });

    // 每回合开始的波次
    if (!first) this._deployWaves(S.round);

    // 玩家主动阶段
    S.phase = 'player';
    S.leaderFledFailed = false;
    this._resetPlayerUses();
    this._drawHand();
    this._unitTurnStart(S.leader);
    // 敌人意图生成（在玩家行动前展示）
    for (const e of this.S.enemies(true)) this._generateIntent(e);
    EventBus.emit(GE.BATTLE_INTENT, {});
  }

  _resetPlayerUses() {
    const uses = {};
    for (const id of this.gs.party.members) uses[id] = 1; // 每角色每回合 1 次
    this.S.activeUses = uses;
  }

  _drawHand() {
    const pool = [];
    for (const [el, n] of this.gs.inventory.elements) for (let i = 0; i < n; i++) pool.push(el);
    this.S.hand = rng.shuffle(pool).slice(0, CONFIG.HAND_SIZE);
  }

  /** 行动节点（§4.2.3）：护盾清零重建→状态计时→控制→回合开始效果→地形附着 */
  _unitTurnStart(u) {
    if (!u?.alive || u.role === 'companion') return;
    // 1. 护盾清零，用防御力重建（clamp 0..99999）
    u.shield = 0;
    const def = Math.max(0, Math.min(99999, u.stats.def ?? 0));
    u.shield = def;
    // 结晶等额外护盾不在这里（回合内累加保留？规则：每回合清零后重建）

    // 2. buff/debuff 倒计时（控制在结算节点扣减并生效）
    this._tickStatuses(u);

    // 3/4. 回合开始效果：燃烧掉血
    this._onTurnStartEffects(u);

    // 5. 超导地块抗性（战斗态地块简化：若单位 meta.onSuperconduct）
    this._applyTileResist(u);

    if (!u.alive) this._handleDeaths();
  }

  _tickStatuses(u) {
    const remain = [];
    for (const st of u.statuses) {
      if ((st.duration ?? -1) === -1) { remain.push(st); continue; }
      st.duration -= 1;
      if (st.duration > 0) remain.push(st);
      else GameLog.info('combat', `${u.name} 的【${st.name || st.buffId}】结束了。`);
    }
    u.statuses = remain;
  }

  _onTurnStartEffects(u) {
    const burn = u.findStatus('burn');
    if (burn) {
      const dmg = Math.floor(u.stats.maxHp * 0.03);
      this.loseHp(u, dmg, '燃烧');
      GameLog.bad('combat', `${u.name} 受到燃烧伤害 ${dmg}。`);
    }
  }

  // ================= 玩家释放主动技能 =================
  /**
   * @param {string} skillId
   * @param {string} casterId 角色 id（hero/xiayang/...）
   * @param {object|null} target {side,pos,uid} 指示器选择
   */
  castActive(skillId, casterId, target) {
    const S = this.S;
    if (S.phase !== 'player') return { ok: false, msg: '还没轮到你行动' };
    const skill = getSkill(skillId);
    if (!skill || skill.type !== SkillType.ACTIVE) return { ok: false, msg: '技能不可用' };
    if (skill.owner !== casterId) return { ok: false, msg: '不是该角色的技能' };
    if ((S.activeUses[casterId] ?? 0) < 1) return { ok: false, msg: '该角色本回合已行动' };
    if (casterId === 'hero' && S.leaderFledFailed) return { ok: false, msg: '逃跑失败后本回合不能再用主角技能' };
    // 冷却
    if ((S.cooldowns.get(skillId) ?? 0) > 0) return { ok: false, msg: '技能冷却中' };
    // 主角被控制
    const caster = casterId === 'hero' ? S.leader : S.companions.find((c) => c.id === casterId);
    if (casterId === 'hero' && this._isControlled(S.leader)) return { ok: false, msg: '主角当前无法行动' };

    // 恐惧：不能用攻击型
    if (S.leader?.findStatus('fear') && skill.effects.some((e) => e.kind === 'damage')) {
      return { ok: false, msg: '处于恐惧中，无法使用攻击技能' };
    }

    // 元素手牌判定（不足仍可释放，但无元素附加，见 §4.7）
    const paid = this._payHand(skill.cost);

    // 执行
    this._executeSkill(caster, skill, target, { handPaid: paid });
    S.activeUses[casterId] -= 1;
    if (skill.cooldown > 0) S.cooldowns.set(skillId, skill.cooldown);

    // 统计攻击型技能次数（追猎用）
    if (skill.effects.some((e) => e.kind === 'damage' || e.kind === 'bounceDamage')) {
      S.counters.attackSkills += 1;
    }
    EventBus.emit(GE.BATTLE_SKILL, { skillId, casterId });

    this._afterAnyAction();
    // 次数耗尽自动 0.5s 后结束（UI 可稍候调用 endPlayerPhase）
    if (this._playerUsesLeft() <= 0) {
      return { ok: true, autoEnd: true };
    }
    return { ok: true };
  }

  _playerUsesLeft() {
    return Object.values(this.S.activeUses).reduce((a, b) => a + b, 0);
  }

  _payHand(cost) {
    if (!cost || !Object.keys(cost).length) return {};
    const paid = {};
    // 从手牌扣除（不区分顺序）
    const hand = this.S.hand;
    for (const [el, n] of Object.entries(cost)) {
      let need = n;
      for (let i = hand.length - 1; i >= 0 && need > 0; i--) {
        if (hand[i] === el) { hand.splice(i, 1); need -= 1; paid[el] = (paid[el] || 0) + 1; }
      }
      paid[`${el}_need`] = n;
    }
    return paid;
  }

  // ================= 目标选择 =================
  resolveTargets(caster, spec, context = {}) {
    const S = this.S;
    const sel = spec?.select;
    const enemies = S.enemies(true).sort((a, b) => a.pos - b.pos);
    const allies = S.allies(true).sort((a, b) => a.pos - b.pos);
    const enemySide = caster.side === 'ally' ? 'enemy' : 'ally';
    const foeList = enemySide === 'enemy' ? enemies : allies;
    const ownSideList = caster.side === 'ally' ? allies : enemies;

    const byUid = context.targetUid ? S.units.find((u) => u.uid === context.targetUid) : null;

    switch (sel) {
      case 'selected':
        return byUid ? [byUid] : [];
      case 'self': return [caster];
      case 'leader': return S.leader.alive ? [S.leader] : [];
      case 'randomEnemy':
      case 'randomAlly': {
        // 敌人技能的"我方"=玩家方；统一：攻击敌对阵营
        const list = foeList;
        return list.length ? [rng.pick(list)] : [];
      }
      case 'randomEnemies': {
        return rng.shuffle(foeList).slice(0, spec.count || 1);
      }
      case 'leftmostEnemy':
        return foes_leftmost(foeList);
      case 'allEnemy':
      case 'allAlly':
        return foeList;
      case 'sideLeft3':
        return sideLeft3(enemySide === 'enemy' ? enemies : allies);
      case 'allyRight3':
        return allyRight3(allies);
      case 'selectedAndSide1':
        return byUid ? this.unitsSide1(byUid) : [];
      case 'randomAllyAndSide1': {
        const center = rng.pick(foeList);
        return center ? this.unitsSide1(center) : [];
      }
      case 'randomFromSelectedNeighborhood': {
        const center = byUid ? byUid : rng.pick(enemies);
        if (!center) return [];
        return [rng.pick(this.unitsSide1(center))];
      }
      case 'highestAtkAlly': {
        const list = [S.leader, ...S.companions].filter((u) => u?.alive);
        const top = list.reduce((a, b) => (b.stats.atk > a.stats.atk ? b : a), list[0]);
        return top ? [top] : [];
      }
      case 'lowestHpOtherEnemy': {
        const others = enemies.filter((u) => u !== caster);
        if (!others.length) return [caster];
        return [others.reduce((a, b) => (b.hp < a.hp ? b : a))];
      }
      case 'burningEnemies': {
        let list = enemies.filter((u) => u.findStatus('burn'));
        if (!list.length) return foes_leftmost(enemies);
        return list.slice(0, spec.max || 3);
      }
      case 'within2OfRandomEnemy': {
        const center = rng.pick(enemies);
        if (!center) return [];
        return enemies.filter((u) => Math.abs(u.pos - center.pos) <= 2);
      }
      case 'lastAttacked': {
        const u = S.units.find((x) => x.uid === S.lastAttackedEnemyUid);
        return u?.alive ? [u] : (foeList.length ? [foeList[0]] : []);
      }
      default:
        return byUid ? [byUid] : [];
    }
  }

  /** 自身+左右1格（含空位跳过），按 self→left→right */
  unitsSide1(u) {
    const out = [];
    const self = this.S.units.find((x) => x.uid === u.uid);
    if (self?.alive) out.push(self);
    for (const p of [u.pos - 1, u.pos + 1]) {
      const t = this.S.unitAt(u.side, p);
      if (t && t.alive) out.push(t);
    }
    return out;
  }
  unitsSelfThenSide1Ordered(u) {
    return this.unitsSide1(u); // 已按 self,left,right
  }

  // ================= 伤害结算（§4.8 / §4.9.1） =================
  /**
   * 核心伤害方法。
   * @param {BattleUnit} caster
   * @param {BattleUnit} target
   * @param {string} element  physical/fire/...
   * @param {number} multiplier 相对 caster 攻击力倍率
   * @param {object} opt { dmgKind, critBonus, isMultiSegment, ignoreAura, flat }
   */
  dealDamage(caster, target, element, multiplier, opt = {}) {
    if (!target?.alive) return 0;

    // 元素伤害（x元素伤害）：先附着→反应→再吃本次伤害
    if (opt.dmgKind === DamageKind.ELEMENT_REACT && !opt.ignoreAura && element !== 'physical') {
      applyAura(this.ctx, target, element, caster);
      // 反应可能导致目标死亡/状态变化；继续本次伤害
    }

    // 闪避 → 格挡（真实伤害/DOT/控制不触发）
    const isTrue = opt.dmgKind === DamageKind.TRUE;
    const isDot = !!opt.isDot;
    if (!isTrue && !isDot) {
      // 闪避多来源乘算（这里用单位综合闪避率）
      if (target.dodge > 0 && rng.roll(target.dodge)) {
        GameLog.info('combat', `${target.name} 闪避了攻击！`);
        EventBus.emit(GE.BATTLE_DAMAGE, { dodged: true, target: target.uid });
        if (target.role === 'leader' && this.gs.party.has('luyouyou')) this._healLeader(30, '蹁跹·闪避');
        return 0;
      }
      if (target.block > 0 && rng.roll(target.block)) {
        GameLog.info('combat', `${target.name} 格挡了攻击！`);
        EventBus.emit(GE.BATTLE_DAMAGE, { blocked: true, target: target.uid });
        return 0;
      }
    }

    // 基础值
    let atk = caster ? caster.stats.atk : (opt.flatSource || 0);
    let base = (opt.flat ?? (atk * multiplier));

    // 暴击（默认 0%，暴击 ×2）
    let critRate = (caster?.critRate || 0) + (opt.critBonus || 0);
    const isCrit = rng.roll(Math.min(1, critRate));
    let critMult = isCrit ? 2 : 1;

    // 主角天赋 何以为我：元素伤害种类加成 / 物理衰减
    if (caster?.role === 'leader') {
      // 该加成在最终乘区处理
    }

    // 抗性
    let resist = target.resists[element] ?? 0;
    // 冻结目标受火/雷 +50%（此处表现为抗性 -0.5）
    if (target.findStatus('freeze') && (element === 'fire' || element === 'thunder')) {
      resist -= 0.50;
      target.removeStatus('freeze');
      target.addOrRefreshStatus({ buffId: 'freezeImmune', duration: 3 });
    }
    resist = Math.max(CONFIG.RESIST_MIN, Math.min(CONFIG.RESIST_MAX, resist));

    // 增伤乘区
    let boost = 1;
    // 施法方 虚弱（造成伤害减少）
    if (caster) boost *= (1 - this._highestPct(caster, 'weak'));
    // 目标 易伤
    boost *= (1 + this._highestPct(target, 'vulnerable'));
    // 目标 减伤
    boost *= (1 - this._highestPct(target, 'damageReduce'));
    // 蒸发/融化单次加成
    if (caster && element !== 'physical') {
      boost *= this._consumeReactionBuff(caster, element);
    }
    // 主角天赋
    if (caster?.role === 'leader') {
      const bonus = this._heroElementBonus(element);
      boost *= (1 + bonus);
    }
    // 激化层数（草/雷伤，每段消耗 1 层 +10%）
    if (caster && (element === 'grass' || element === 'thunder')) {
      const agg = caster.findStatus('aggravate');
      if (agg && agg.stacks > 0) { boost *= 1.10; agg.stacks -= 1; if (agg.stacks <= 0) caster.removeStatus('aggravate'); }
    }
    // 陆悠悠风息：暴击把物理转风
    let finalElement = element;
    if (caster?.id === 'luyouyou' && isCrit && element === 'physical') {
      finalElement = 'wind';
      resist = Math.max(CONFIG.RESIST_MIN, Math.min(CONFIG.RESIST_MAX, target.resists.wind ?? 0));
    }

    let dmg = base * (1 - resist) * boost * critMult;
    dmg = Math.max(0, Math.round(dmg));

    if (isTrue) {
      // 真实伤害无视减伤抗性闪避格挡，但护盾可挡
      dmg = Math.max(0, Math.round(base * critMult));
    }

    this._applyDamageToTarget(caster, target, dmg, { isCrit, element: finalElement, isDot, isTrue });
    return dmg;
  }

  /** x 属性伤害：不附着 */
  dealPropertyDamage(caster, target, element, multiplier, opt = {}) {
    return this.dealDamage(caster, target, element, multiplier, { ...opt, dmgKind: DamageKind.ELEMENT_PROPERTY });
  }

  _consumeReactionBuff(caster, element) {
    const map = {
      water: 'vaporizeWater', fire: null, ice: 'meltIce',
    };
    // fire 有两个（蒸发·火+50 / 融化·火+100），取较大者并消耗
    let bonus = 0, toRemove = null;
    if (element === 'fire') {
      const v = caster.findStatus('vaporizeFire');
      const m = caster.findStatus('meltFire');
      if (v && v.bonus > bonus) { bonus = v.bonus; toRemove = v; }
      if (m && m.bonus > bonus) { bonus = m.bonus; toRemove = m; }
    } else if (map[element]) {
      const st = caster.findStatus(map[element]);
      if (st) { bonus = st.bonus ?? 0; toRemove = st; }
    }
    if (toRemove) caster.removeStatus(toRemove.buffId);
    return bonus;
  }

  _heroElementBonus(element) {
    const leader = this.S.leader;
    if (!leader) return 0;
    if (element === 'physical') return leader.meta.physBonus ?? 0;
    // 每造成过 1 种元素伤，该元素 +10%（用 dealtElementKinds 计数）
    const kinds = leader.meta.dealtElementKinds;
    return kinds.has(element) ? 0.10 : 0;
  }

  _highestPct(unit, buffId) {
    const st = unit.findStatus(buffId);
    return st?.value ?? 0;
  }

  _applyDamageToTarget(caster, target, dmg, meta) {
    if (!target?.alive || dmg <= 0) {
      if (dmg === 0) EventBus.emit(GE.BATTLE_DAMAGE, { target: target?.uid, amount: 0, ...meta });
      return;
    }
    // 先扣护盾（护盾能挡真实伤害）
    let rest = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, rest);
      target.shield -= absorbed;
      rest -= absorbed;
    }
    if (rest > 0) {
      target.hp = Math.max(0, target.hp - rest);
      if (!meta.isDot) {
        // 睡眠受伤醒来
        if (target.findStatus('sleep')) { target.removeStatus('sleep'); GameLog.info('combat', `${target.name} 从睡眠中惊醒！`); }
        // 盔甲受击加盾
        if (target.role === 'leader' && this.gs.permAgg?.hurtShield) this.gainShield(target, this.gs.permAgg.hurtShield.next);
        // 皮衣受击回血
        if (target.role === 'leader' && this.gs.permAgg?.hurtHeal) {
          const hh = this.gs.permAgg.hurtHeal;
          if (rng.roll(hh.chance)) this._healLeader(Math.floor(target.stats.maxHp * hh.pct), '皮衣');
        }
      }
    }
    GameLog.info('combat', `${target.name} 受到 ${dmg} 点${meta.isCrit ? '暴击' : ''}${meta.isTrue ? '真实' : ''}伤害（剩余 ${target.hp}）`);
    EventBus.emit(GE.BATTLE_DAMAGE, { uid: caster?.uid, target: target.uid, amount: dmg, crit: meta.isCrit, element: meta.element, shieldLeft: target.shield });

    // 记录主角造成的元素伤害种类（何以为我）
    if (caster?.role === 'leader' && meta.element && meta.element !== 'physical') {
      const kinds = caster.meta.dealtElementKinds;
      if (!kinds.has(meta.element)) {
        kinds.add(meta.element);
        caster.meta.physBonus -= 0.20; // 物理 -20%
      }
    }
    if (caster?.side === 'enemy' || (target.side === 'enemy')) {
      if (target.side === 'enemy') this.S.lastAttackedEnemyUid = target.uid;
    }
    if (target.hp <= 0) this._killUnit(target, caster);
  }

  gainShield(unit, n) {
    unit.shield += n;
    EventBus.emit(GE.BATTLE_SHIELD, { uid: unit.uid, shield: unit.shield });
  }

  loseHp(unit, n, source) {
    // 流失生命：无视护盾（燃烧等 DOT）
    unit.hp = Math.max(0, unit.hp - n);
    EventBus.emit(GE.BATTLE_DAMAGE, { target: unit.uid, amount: n, dot: true, source });
    if (unit.hp <= 0) this._killUnit(unit, null);
  }

  _healLeader(n, reason) {
    const l = this.S.leader;
    if (!l?.alive) return;
    l.hp = Math.min(l.stats.maxHp, l.hp + n);
    EventBus.emit(GE.BATTLE_HEAL, { uid: l.uid, amount: n, hp: l.hp });
  }
  healUnit(unit, n) {
    if (unit.role === 'leader') return this._healLeader(n, '治疗');
    if (unit.stats.maxHp == null) return; // 队友无血
    unit.hp = Math.min(unit.stats.maxHp, unit.hp + n);
    EventBus.emit(GE.BATTLE_HEAL, { uid: unit.uid, amount: n, hp: unit.hp });
  }

  _isControlled(u) {
    return !!(u.findStatus('freeze') || u.findStatus('stun') || u.findStatus('sleep'));
  }

  // ================= 技能执行器（DSL） =================
  _executeSkill(caster, skill, targetSel, opts = {}) {
    const ctxTarget = targetSel?.uid
      ? { targetUid: this.S.units.find((u) => u.uid === targetSel.uid)?.uid }
      : (targetSel ? { targetUid: this.S.unitAt(targetSel.side, targetSel.pos)?.uid } : {});
    GameLog.info('combat', `${caster.name} 施放【${skill.name}】`);

    // 通灵：攻击前消耗至多 3 个任意元素，每元素 +25%
    let consumeBonus = 0;
    for (const eff of skill.effects) {
      if (eff.kind === 'consumeAnyHand') {
        let n = 0;
        while (n < eff.max && this.S.hand.length) { this.S.hand.pop(); n += 1; }
        consumeBonus += n * eff.multiplierPer;
      }
    }

    for (const eff of skill.effects) {
      this._execEffect(caster, eff, { ...ctxTarget, consumeBonus, skill });
      if (this.S.result) return; // 战斗结束
    }
  }

  _execEffect(caster, eff, ctx) {
    const S = this.S;
    switch (eff.kind) {
      case 'damage':
      case 'bounceDamage': {
        let targets = this.resolveTargets(caster, eff.target, ctx);
        if (eff.kind === 'bounceDamage') {
          // 弹射：主目标起，每次在左右1格随机
          let cur = targets[0];
          for (let b = 0; b <= (eff.bounces ?? 0) && cur; b++) {
            this._hitOne(caster, cur, eff, ctx);
            const pool = this.unitsSide1(cur).filter((u) => u.side === cur.side && u.alive);
            cur = pool.length ? rng.pick(pool) : null;
          }
        } else {
          for (const t of targets) this._hitSegments(caster, t, eff, ctx);
        }
        break;
      }
      case 'missilesLeft': {
        // 朝左发射 N 枚：命中每格第一名我方（简化：从最靠右的我方起依次打 N 次随机）
        const allies = S.allies(true).sort((a, b) => b.pos - a.pos);
        for (let i = 0; i < eff.shots && allies.length; i++) {
          const t = allies[i % allies.length];
          this._hitOne(caster, t, { ...eff, multiplier: eff.multiplier }, ctx);
        }
        break;
      }
      case 'aura': {
        for (const t of this.resolveTargets(caster, eff.target, ctx)) {
          applyAura(this.ctx, t, eff.element, caster);
        }
        break;
      }
      case 'buff': {
        for (const t of this.resolveTargets(caster, eff.target, ctx)) this._applyBuffEffect(t, eff);
        break;
      }
      case 'buffIfHandPaid': {
        // 鼓舞：消耗成功才加攻
        const costKey = Object.keys(ctx.skill.cost || {})[0];
        if (costKey && (ctx.handPaid?.[costKey] ?? 0) >= (ctx.skill.cost[costKey])) {
          for (const t of this.resolveTargets(caster, eff.target, ctx)) this._applyBuffEffect(t, eff);
        }
        break;
      }
      case 'heal': {
        for (const t of this.resolveTargets(caster, eff.target, ctx)) {
          const amount = eff.flat ?? Math.floor(caster.stats.atk * (eff.pctOfCasterAtk ?? 0));
          this.healUnit(t, amount);
        }
        break;
      }
      case 'selfHpCost':
        this.loseHp(caster, Math.floor(caster.stats.maxHp * eff.pct), '拼命');
        break;
      case 'selfLoseHp':
        this.loseHp(caster, eff.flat, eff.kind);
        break;
      case 'stealAllyAtk': {
        // 偷取其余我方角色各 20% 当前攻击力（不动 base）
        const list = [S.leader, ...S.companions].filter((u) => u && u.alive && u !== caster && u.stats.maxHp !== null || u === S.leader);
        let gained = 0;
        for (const u of list) {
          if (!u || u === caster) continue;
          const take = Math.floor(u.stats.atk * eff.pct);
          u.stats.atk -= take; gained += take;
        }
        caster.stats.atk += gained;
        GameLog.info('combat', `${caster.name} 偷取了 ${gained} 点攻击力。`);
        break;
      }
      case 'absorbAllAura': {
        let n = 0;
        for (const u of S.units) {
          if (u.alive && u.aura === eff.element) { u.aura = null; n += 1; }
        }
        if (n > 0 && eff.buff) {
          caster.addOrRefreshStatus({
            buffId: eff.buff.buffId, value: n * eff.buff.valuePer, duration: eff.buff.duration,
          });
        }
        if (eff.element === 'fire' && caster.id === 'xiayang') S.counters.absorbedFireByXiayang += n;
        break;
      }
      case 'absorbAuraNextAttack': {
        // 汲取：吸收触发来源的 1 个附着（简化：吸收场上 1 个非自身附着）
        const victim = S.units.find((u) => u.alive && u.aura && u !== caster);
        if (victim) {
          const el = victim.aura; victim.aura = null;
          caster.meta.nextAttackElement = el;
          GameLog.info('combat', `${caster.name} 汲取了${el}附着。`);
        }
        break;
      }
      case 'clearAllAura': {
        for (const u of S.units) if (u.alive) u.aura = null;
        GameLog.info('combat', '所有单位的元素附着被移除（乱魔）。');
        break;
      }
      case 'knockback': {
        const t = this.resolveTargets(caster, eff.target, ctx)[0];
        if (t) this._moveUnit(t, eff.dir, eff.distance);
        break;
      }
      case 'teleport': {
        this._teleport(caster, eff.range);
        break;
      }
      case 'moveRandomSide': {
        this._moveUnit(caster, rng.pick([-1, 1]), eff.distance);
        break;
      }
      case 'selfBuff': {
        caster.stats.atk += eff.atk || 0;
        caster.stats.def += eff.def || 0;
        GameLog.info('combat', `${caster.name} 攻击力/防御力提升。`);
        break;
      }
      case 'defDownAllAlly': {
        for (const u of S.allies(true)) {
          if (u.role === 'leader') { u.stats.def = Math.max(0, u.stats.def - eff.flat); }
        }
        break;
      }
      case 'flee': {
        // 古树逃跑 → 直接判玩家胜利
        this._endBattle(BattleResult.VICTORY, { enemyFled: true });
        break;
      }
      default:
        devLog.warn('combat', '未实现的技能效果', eff.kind);
    }
  }

  _applyBuffEffect(unit, eff) {
    const st = {
      buffId: eff.buffId,
      name: STATUS[eff.buffId]?.name,
      value: eff.value,
      duration: eff.duration ?? -1,
      stackable: STATUS[eff.buffId]?.stackable,
      maxStacks: STATUS[eff.buffId]?.maxStacks,
      keepHighest: STATUS[eff.buffId]?.keepHighest,
      stacks: eff.stacks,
    };
    const added = unit.addOrRefreshStatus(st);
    if (eff.target?.select === 'self' || unit === undefined) {/*noop*/}
    // 数值类即时生效在伤害公式里读 status，此处仅挂状态
    return added;
  }

  _hitSegments(caster, target, eff, ctx) {
    const hits = eff.hits || 1;
    for (let i = 0; i < hits; i++) {
      this._hitOne(caster, target, eff, ctx, i, hits);
      if (!target.alive) break;
    }
  }

  _hitOne(caster, target, eff, ctx, segIdx = 0, segTotal = 1) {
    if (!target?.alive) return;
    let mult = eff.multiplier ?? 1;
    if (eff.multiplierBonusFromConsume) mult += (ctx.consumeBonus || 0);
    // 主角汲取：下一击转元素
    let element = eff.element;
    let dmgKind = eff.dmgKind;
    if (caster.role === 'leader' && caster.meta.nextAttackElement && element === 'physical') {
      element = caster.meta.nextAttackElement;
      dmgKind = DamageKind.ELEMENT_REACT;
      caster.meta.nextAttackElement = null;
    }
    this.dealDamage(caster, target, element, mult, {
      dmgKind,
      critBonus: eff.critBonus,
    });
    // 命中后附加 buff（thenBuff / onHit）
    if (target.alive && eff.thenBuff) {
      this._applyBuffEffect(target, { buffId: eff.thenBuff.buffId, value: eff.thenBuff.value, duration: eff.thenBuff.duration });
    }
    if (target.alive && eff.onHit && rng.roll(eff.onHit.chance ?? 1)) {
      this._applyBuffEffect(target, { buffId: eff.onHit.buff.buffId, duration: eff.onHit.buff.duration, stacks: eff.onHit.buff.stacks, value: eff.onHit.buff.value });
    }
  }

  // ================= 位移 / 召唤 =================
  _moveUnit(u, dir, dist) {
    let pos = u.pos;
    for (let i = 0; i < dist; i++) {
      const np = pos + dir;
      if (np < 0 || np >= CONFIG.BATTLE_ROW) break;
      if (this.S.unitAt(u.side, np)) break;
      pos = np;
    }
    if (pos !== u.pos) { u.pos = pos; EventBus.emit(GE.BATTLE_SKILL, { move: true, uid: u.uid, pos }); }
  }
  _teleport(u, range) {
    const candidates = [];
    for (let p = 0; p < CONFIG.BATTLE_ROW; p++) {
      if (!this.S.unitAt(u.side, p)) {
        if (range < 0 || Math.abs(p - u.pos) <= range) candidates.push(p);
      }
    }
    if (candidates.length) { u.pos = rng.pick(candidates); }
  }

  summonGrassSlime(side) {
    const def = SUMMONS.grassSlimeSummon;
    const pos = this.S.randomEmptyPos(side);
    if (pos === null) return; // 满员不生成
    const growth = (this.gs.globalGrowth.grassSlimeSummon || 0);
    const atk = Math.round(def.atk * (1 + 0.10 * growth));
    const hp = Math.round(def.maxHp * (1 + 0.10 * growth));
    const u = new BattleUnit({
      side, pos, role: 'summon', id: def.id, defId: def.id, name: def.name,
      isSummon: true,
      base: { atk, maxHp: hp, def: 0, speed: null },
      stats: { atk, maxHp: hp, def: 0, speed: null },
      hp, skills: def.skills, talents: [], sprite: 'slime.grass',
    });
    this.S.units.push(u);
    EventBus.emit(GE.BATTLE_SKILL, { summon: true, uid: u.uid, side, pos });
    GameLog.good('combat', `召唤了草史莱姆（${side === 'ally' ? '我方' : '敌方'}）`);
  }

  applySuperconductTile(target) {
    // 战斗态地块绑定：给当前该格单位挂抗性降低；新单位走入由 _applyTileResist 处理
    const posKey = `${target.side}:${target.pos}`;
    this.S.meta.tiles = this.S.meta.tiles || {};
    this.S.meta.tiles[posKey] = { thunder: true, ice: true, physical: true };
    this._applyTileResist(target);
  }
  _applyTileResist(u) {
    const keyT = `${u.side}:${u.pos}`;
    const tile = this.S.meta.tiles?.[keyT];
    if (!tile) return;
    // 公式：max(R*0.4,10%) 减少量（§4.4.6）
    for (const el of ['thunder', 'ice', 'physical']) {
      const R = u.resists[el] ?? 0;
      const reduce = Math.max(R * 0.4, 0.10);
      u.resists[el] = Math.max(-1, Math.min(0.95, R - reduce));
    }
  }

  // ================= 敌人 =================
  _onEnemySpawn(u) {
    // 新手之友：前 12 天 -60血 -10攻
    if (u.talents.some((t) => t.impl === 'newbieFriend') && this.gs.day <= 12) {
      u.base.maxHp -= 60; u.stats.maxHp -= 60; u.hp = Math.max(1, u.hp - 60);
      u.base.atk -= 10; u.stats.atk = Math.max(0, u.stats.atk - 10);
    }
    // 元素亲和：免疫本元素伤、总附本元素
    const aff = u.talents.find((t) => t.impl === 'elementAffinity');
    if (aff) {
      u.resists[aff.element] = 1.0; // 免疫对应元素伤害
      u.aura = aff.element;
      if (aff.immuneBurn) u.meta.immuneBurn = true;
      if (aff.immuneFreeze) u.meta.immuneFreeze = true;
      if (aff.immuneElectro) u.meta.immuneElectro = true;
    }
    // 岩盾：最大生命 -10%，防御 +10
    if (u.talents.some((t) => t.impl === 'rockShield')) {
      u.stats.maxHp = Math.floor(u.stats.maxHp * 0.9); u.hp = u.stats.maxHp;
      u.stats.def += 10; u.base.def += 10;
    }
    // 熊：开局睡眠 3
    if (u.talents.some((t) => t.impl === 'hibernate')) {
      u.addOrRefreshStatus({ buffId: 'sleep', duration: 3 });
    }
    // 狗友
    const dog = u.talents.find((t) => t.impl === 'dogFriends');
    if (dog && !u.meta.dogFriendsDone) {
      u.meta.dogFriendsDone = true;
      let count = 1;
      if (dog.table.some((r) => r.spawn)) {
        // Pro 版：80 猎犬/20 Pro，1 只
        const pick = rng.weighted(dog.table.map((r) => ({ value: r, weight: r.p })));
        this.S.deployEnemy(pick.spawn);
      } else {
        const pick = rng.weighted(dog.table.map((r) => ({ value: r.count, weight: r.p })));
        count = pick;
        for (let i = 0; i < count; i++) this.S.deployEnemy('hound');
      }
    }
    // 中二病/猎犬 全局成长
    this._applyGlobalGrowth(u);
  }

  _applyGlobalGrowth(u) {
    const g = this.gs.globalGrowth;
    if (u.id === 'chuuniBoy') {
      const n = Math.min(5, g.chuuniDefeat || 0);
      u.stats.atk += 15 * n; u.base.atk += 15 * n;
      u.stats.maxHp += 40 * n; u.hp = u.stats.maxHp; u.speed += 5 * n;
    }
    if (u.id === 'hound' || u.id === 'houndPro') {
      const key = u.id;
      const n = Math.min(20, g[`${key}Day`] || 0);
      if (u.id === 'hound') {
        u.stats.atk = Math.round(u.stats.atk * (1 + 0.05 * n));
        u.stats.maxHp = Math.round(u.stats.maxHp * (1 + 0.05 * n));
        u.speed += n;
      } else {
        u.stats.atk = Math.round(u.stats.atk * (1 + 0.08 * n));
        u.stats.maxHp = Math.round(u.stats.maxHp * (1 + 0.10 * n));
        u.speed += n;
      }
      u.hp = u.stats.maxHp;
    }
    // 帅气闪避
    if (u.talents.some((t) => t.impl === 'dodgeRate')) u.dodge += 0.20;
  }

  _generateIntent(u) {
    if (u.notEnemy) { u.intent = { skillId: u.skills[0]?.id }; return; }
    const intent = getEnemy(u.defId)?.intent;
    if (!intent) { u.intent = { skillId: u.skills[0]?.id }; return; }

    // 睡眠/控制 → 意图替换为控制图标
    if (this._isControlled(u)) { u.intent = { controlled: u.findStatus('freeze') ? 'freeze' : u.findStatus('sleep') ? 'sleep' : 'stun' }; return; }

    if (intent.type === 'always') u.intent = { skillId: intent.skill };
    else if (intent.type === 'random') {
      const table = intent.table.filter((row) => {
        if (row.skill === 'water_bubble' && intent.skipIf?.water_bubble === 'allEnemyFullHp') {
          return this.S.enemies().some((e) => e.hp < e.stats.maxHp);
        }
        return true;
      });
      const pick = rng.weighted((table.length ? table : intent.table).map((r) => ({ value: r.skill, weight: r.w })));
      u.intent = { skillId: pick };
    } else if (intent.type === 'script') {
      const sk = intent.seq[u.scriptIdx % intent.seq.length];
      u.intent = { skillId: sk };
      u.meta.pendingNextScript = (u.scriptIdx + 1) % intent.seq.length;
    } else if (intent.type === 'scriptWait') {
      if (this.S.round >= intent.untilRound) u.intent = { skillId: intent.thenSkill };
      else u.intent = { skillId: intent.waitSkill };
    } else if (intent.type === 'special') {
      this._specialIntent(u, intent.impl);
    }
    EventBus.emit(GE.BATTLE_INTENT, { uid: u.uid, intent: u.intent });
  }

  _specialIntent(u, impl) {
    switch (impl) {
      case 'icefogPattern': {
        const m = u.meta.icefog || { phase: 'idle', cd: 0, consecutive: 0 };
        u.meta.icefog = m;
        if (m.cd > 0) { m.cd -= 1; u.intent = { skillId: 'slime_impact' }; }
        else if (m.phase === 'idle') { m.phase = 'charge'; u.intent = { skillId: 'ice_fog', charging: true }; }
        else if (m.phase === 'charge') { m.phase = 'burst'; m.consecutive = 0; u.intent = { skillId: 'ice_fog' }; }
        else { u.intent = { skillId: 'ice_fog' }; }
        break;
      }
      case 'dartPattern': {
        const c = (u.meta.featherCount = (u.meta.featherCount || 0) + 1);
        u.intent = { skillId: c % 3 === 0 ? (u.defId === 'blueDart' ? 'blue_blink' : 'red_blink') : (u.defId === 'blueDart' ? 'blue_feather' : 'red_feather') };
        break;
      }
      case 'bearPattern': {
        if (u.findStatus('sleep')) { u.intent = { controlled: 'sleep' }; break; }
        if (u.meta.rageEnd && this.S.round > u.meta.rageEnd) u.meta.raged = false;
        const cd = u.meta.roarCd || 0;
        if (cd > 0) { u.meta.roarCd -= 1; u.intent = { skillId: 'bear_slap' }; }
        else u.intent = { skillId: rng.roll(0.5) ? 'bear_roar' : 'bear_slap' };
        break;
      }
      case 'mechPattern': {
        // 满血只巡逻；掉血后循环践踏/飞弹；大清扫冷却好且入场>6回合优先（先蓄力）
        if (u.hp >= u.stats.maxHp) { u.intent = { skillId: 'mech_patrol' }; break; }
        const m = u.meta.mech || { sweepCd: 6, phase: 'normal' };
        u.meta.mech = m;
        if (m.sweepCd > 0) m.sweepCd -= 1;
        if (m.sweepCd <= 0 && this.S.round > 6) {
          if (m.phase !== 'sweepCharge') { m.phase = 'sweepCharge'; u.intent = { skillId: 'mech_sweep', charging: true }; }
          else { u.intent = { skillId: 'mech_sweep' }; }
        } else {
          u.intent = { skillId: rng.roll(0.5) ? 'mech_trample' : 'mech_missile' };
        }
        break;
      }
      case 'ironPattern': {
        u.intent = { skillId: this.S.round % 2 === 1 ? rng.pick(['iron_smash', 'iron_ram']) : 'iron_fortify' };
        break;
      }
      default:
        u.intent = { skillId: u.skills[0]?.id };
    }
  }

  // ================= 敌方阶段 =================
  endPlayerPhase() {
    if (this.S.phase !== 'player') return;
    this.S.phase = 'enemy';
    this._enemyPhase();
  }

  _enemyPhase() {
    const S = this.S;
    // 敌方从左到右依次行动
    const enemies = S.enemies(true).sort((a, b) => a.pos - b.pos);
    for (const e of enemies) {
      if (S.result) return;
      if (!e.alive) continue;
      this._unitTurnStart(e);
      if (!e.alive) continue;
      if (this._isControlled(e)) {
        GameLog.info('combat', `${e.name} 无法行动。`);
        this._advanceEnemyScript(e, null);
        continue;
      }
      this._enemyAct(e);
      this._advanceEnemyScript(e, e.intent?.skillId);
      if (S.result) return;
    }
    // 我方召唤物行动（玩家阶段结束后，从左到右自动）
    const summons = S.units.filter((u) => u.alive && u.side === 'ally' && u.isSummon).sort((a, b) => a.pos - b.pos);
    for (const s of summons) {
      if (S.result) return;
      this._unitTurnStart(s);
      if (s.alive) this._summonAct(s);
    }

    // 连携冷却 -1（按大回合）
    for (const [k, v] of S.cooldowns) if (v > 0) S.cooldowns.set(k, v - 1);

    if (S.result) return;
    this._beginRound(false);
  }

  _enemyAct(e) {
    const skillId = e.intent?.skillId;
    const skill = e.skills.find((s) => s.id === skillId) || e.skills[0];
    if (!skill) return;
    if (skill.type === 'support') {
      // 恐惧不影响辅助；睡眠等已在上层拦截
      this._executeEnemySkill(e, skill);
    } else {
      // 恐惧：不能用攻击型 → 跳过
      if (e.findStatus('fear')) { GameLog.info('combat', `${e.name} 在恐惧中无法攻击。`); return; }
      this._executeEnemySkill(e, skill);
    }
    // 熊怒吼冷却
    if (skill.id === 'bear_roar') e.meta.roarCd = 4;
    // 致命节奏
    if (e.talents?.some((t) => t.impl === 'deadlyRhythm') && skill.type === 'attack') {
      e.stats.atk += 8;
    }
  }

  _executeEnemySkill(e, skill) {
    GameLog.info('combat', `${e.name} 使用【${skill.name}】`);
    // 蓄力技：若该意图带 charging，则本回合只蓄力（不造成伤害）
    if (e.intent?.charging) {
      // 冰雾/大清扫：标记阶段，下回合释放
      if (skill.id === 'ice_fog') { e.meta.icefog.phase = 'burst'; e.meta.icefog.consecutive = 0; }
      if (skill.id === 'mech_sweep') { e.meta.mech.phase = 'sweepBurst'; e.meta.mech.sweepConsecutive = 0; }
      GameLog.info('combat', `${e.name} 正在蓄力……`);
      return;
    }
    // 冰雾连续 3 次后进入冷却
    for (const eff of skill.effects) this._execEffect(e, eff, { skill });
    if (skill.id === 'ice_fog') {
      const m = e.meta.icefog;
      m.consecutive += 1;
      if (m.consecutive >= 3) { m.phase = 'idle'; m.cd = 5; }
    }
    if (skill.id === 'mech_sweep') {
      const m = e.meta.mech;
      m.sweepConsecutive = (m.sweepConsecutive || 0) + 1;
      if (m.sweepConsecutive >= 3) { m.phase = 'normal'; m.sweepCd = 6; m.sweepConsecutive = 0; }
    }
  }

  _summonAct(s) {
    // 草史莱姆：意图已随生成；简化为每回合用撞击/破土
    const skill = s.skills[s.scriptIdx % s.skills.length];
    s.scriptIdx += 1;
    this._executeEnemySkill(s, skill);
  }

  _advanceEnemyScript(e, usedSkillId) {
    const def = getEnemy(e.defId);
    const intent = def?.intent;
    if (intent?.type === 'script') {
      e.scriptIdx = e.meta.pendingNextScript ?? (e.scriptIdx + 1);
    }
    // 被控制不改后续剧本（被篡改的本条直接丢弃）——script 已在生成意图时推进 idx，
    // 但控制回合不应消耗剧本，回退一格
    if (this._isControlled(e) && intent?.type === 'script') {
      e.scriptIdx = (e.scriptIdx + intent.seq.length - 1) % intent.seq.length;
    }
  }

  // ================= 死亡 / 胜负 =================
  _killUnit(u, killer) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    GameLog.bad('combat', `${u.name} 被击败。`);
    EventBus.emit(GE.BATTLE_DAMAGE, { died: true, uid: u.uid });

    // 火史莱姆自爆
    if (u.talents?.some((t) => t.impl === 'selfDestruct')) {
      u.stats.atk = Math.round(u.base.atk * 1.5);
      // 2 回合后爆炸（用 meta.bombTimer，由敌方阶段/回合推进；简化为挂残留单位）
      this._spawnBombResidue(u);
    }
    // 风史莱姆风旋
    if (u.talents?.some((t) => t.impl === 'windSwirl')) {
      const target = rng.pick(this.S.units.filter((x) => x.alive));
      if (target) {
        target.pos = u.pos;
        if (target.side === 'ally' && target.role === 'leader') {
          this.dealPropertyDamage(u, target, 'wind', 0.40);
        }
      }
    }
    // 古树反击
    if (u.talents?.some((t) => t.impl === 'thornCounter') && killer) {
      const trueDmg = Math.floor(u.base.atk * 0.40);
      if (killer.side === 'ally' && killer.role === 'leader') {
        this.dealDamage(u, killer, 'physical', 0, { flat: trueDmg, dmgKind: DamageKind.TRUE });
      }
      u.stats.atk = Math.min(Math.round(u.base.atk * 2.5), Math.round(u.base.atk * (1 + 1.50))); // +15%至多+150
    }
    this._handleDeaths();
  }

  _spawnBombResidue(slime) {
    const pos = slime.pos, side = slime.side;
    const residue = new BattleUnit({
      side, pos, role: 'residue', id: 'fireSlimeBomb', name: '即将爆炸的火史莱姆',
      notEnemy: true, base: { atk: slime.stats.atk, maxHp: 1, def: 0, speed: 0 },
      stats: { atk: slime.stats.atk, maxHp: 1, def: 0, speed: 0 }, hp: 1,
      skills: [], meta: { bombTimer: 2, bombAtk: slime.stats.atk },
    });
    this.S.units.push(residue);
  }

  _handleDeaths() {
    if (this.S.leaderDead()) { this._endBattle(BattleResult.DEFEAT); return; }
    if (this.S.allNativeEnemiesDead()) { this._endBattle(BattleResult.VICTORY); return; }
  }

  // ================= 逃跑（§4.10.4） =================
  tryFlee() {
    const S = this.S;
    if (S.phase !== 'player') return { ok: false };
    const leader = S.leader;
    let maxVal = 0;
    for (const e of S.enemies(false)) {
      const hpPct = e.hp / e.stats.maxHp;
      maxVal = Math.max(maxVal, hpPct * (e.speed || 0));
    }
    const p = Math.max(0, Math.min(1, (leader.speed - maxVal) / 100));
    if (rng.roll(p)) {
      this._endBattle(BattleResult.FLEE);
      return { ok: true, success: true };
    }
    S.leaderFledFailed = true;
    GameLog.bad('combat', '逃跑失败！本回合主角无法再行动。');
    return { ok: true, success: false };
  }

  // ================= 连携（§4.5.4） =================
  /** 触发条件检测在各结算点调用；这里负责入队/弹窗计时（UI 显示，计时也由引擎驱动） */
  triggerChain(skillId, payload) {
    const S = this.S;
    const skill = getSkill(skillId);
    if (!skill || skill.type !== SkillType.CHAIN) return;
    if ((S.cooldowns.get(skillId) ?? 0) > 0) return;
    // 同回合可多次触发；窗口仅 1 个
    if (S.chainQueue.some((c) => c.skillId === skillId && !c.expired)) return;
    S.chainQueue.push({ skillId, payload, expireAt: performance.now() + CONFIG.CHAIN_WINDOW_MS, expired: false });
    EventBus.emit(GE.BATTLE_CHAIN_PROMPT, { queue: S.chainQueue });
  }

  /** 玩家按 E：释放队首连携 */
  castChain() {
    const S = this.S;
    const head = S.chainQueue[0];
    if (!head) return;
    S.chainQueue.shift();
    const skill = getSkill(head.skillId);
    const caster = skill.owner === 'hero' ? S.leader : S.companions.find((c) => c.id === skill.owner);
    // 释放时不校验触发条件；元素不足/无目标仍算使用并进冷却
    this._executeChain(caster, skill, head.payload);
    S.cooldowns.set(skill.id, skill.cooldown);
    EventBus.emit(GE.BATTLE_CHAIN_PROMPT, { queue: S.chainQueue });
    this._afterAnyAction();
  }

  dismissChainHead() {
    const head = this.S.chainQueue.shift();
    EventBus.emit(GE.BATTLE_CHAIN_PROMPT, { queue: this.S.chainQueue });
    return head;
  }

  _executeChain(caster, skill, payload) {
    GameLog.info('combat', `连携！${caster?.name}【${skill.name}】`);
    // 焚灭分段
    if (skill.id === 'xy_incinerate') {
      const n = this.S.counters.absorbedFireByXiayang;
      const stage = n >= 7 ? skill.stages[1] : n >= 3 ? skill.stages[0] : null;
      if (!stage) { GameLog.info('combat', '吸收的火附着不足，焚灭没有效果。'); return; }
      this.S.counters.absorbedFireByXiayang -= stage.consume;
      const target = payload?.targetUid ? this.S.units.find((u) => u.uid === payload.targetUid) : this.S.enemies()[0];
      for (const eff of stage.effects) {
        this._execEffect(caster, eff, { targetUid: target?.uid, skill });
      }
      return;
    }
    const target = payload?.targetUid ? this.S.units.find((u) => u.uid === payload.targetUid) : null;
    for (const eff of skill.effects) {
      this._execEffect(caster, eff, { targetUid: target?.uid, skill });
    }
    if (skill.effects.some((e) => e.kind === 'damage' || e.kind === 'bounceDamage')) {
      this.S.counters.attackSkills += 1;
    }
  }

  /** 各结算点检查连携触发条件 */
  checkChainTriggers(hook, payload) {
    const S = this.S;
    const equippedChains = this.gs.party.skillSet.chain;
    for (const id of equippedChains) {
      const skill = getSkill(id);
      const trig = skill.trigger;
      if (!trig) continue;
      if (trig.kind === hook) this._evalTrigger(skill, trig, hook, payload);
    }
  }
  _evalTrigger(skill, trig, hook, payload) {
    const S = this.S;
    switch (hook) {
      case 'auraCountOnField':
        if (S.units.filter((u) => u.alive && u.aura).length >= trig.ge) this.triggerChain(skill.id, payload);
        break;
      case 'enemyBurning':
        if (S.enemies().some((e) => e.findStatus('burn'))) this.triggerChain(skill.id, payload);
        break;
      case 'spreadCount':
        if (S.counters.spread >= trig.ge) { this.triggerChain(skill.id, payload); S.counters.spread = 0; }
        break;
      case 'attackSkillCount':
        if (S.counters.attackSkills >= trig.ge) { this.triggerChain(skill.id, payload); }
        break;
      case 'enemyCharging':
        if (payload?.charging) this.triggerChain(skill.id, payload);
        break;
      case 'allyApplyAura':
        this.triggerChain(skill.id, payload);
        break;
      case 'allyApplyAuraElement':
        if (payload?.element && trig.elements.includes(payload.element)) this.triggerChain(skill.id, payload);
        break;
      case 'otherAllyChain':
        if (payload?.casterId && payload.casterId !== skill.owner) this.triggerChain(skill.id, payload);
        break;
    }
  }

  _afterAnyAction() {
    if (this.S.allNativeEnemiesDead()) this._endBattle(BattleResult.VICTORY);
    else if (this.S.leaderDead()) this._endBattle(BattleResult.DEFEAT);
  }

  // ================= 结束与清理（§4.10.5） =================
  _endBattle(result, extra = {}) {
    if (this.S.result) return;
    this.S.result = result;
    this.S.phase = 'end';
    // 主角 HP 回写（跨战斗继承）；附着带回探索态
    if (this.S.leader) {
      this.gs.heroHp = this.S.leader.hp;
      this.gs.heroAura = this.S.leader.aura;
    }
    // 统一清理：buff/debuff、护盾、元素手牌恢复（pool 不变，无需操作）、连携冷却
    // 注意：附着不清（跨战斗保留，已回写）
    EventBus.emit(GE.BATTLE_END, { result, ...extra });
    GameLog.system('combat', `战斗结束：${result === BattleResult.VICTORY ? '胜利' : result === BattleResult.DEFEAT ? '失败' : '逃跑成功'}`);
  }
}

// 目标选择辅助
function foes_leftmost(list) {
  if (!list.length) return [];
  return [list[0]];
}
function sideLeft3(list) {
  // 敌方阵营左侧 3 格 = pos 0,1,2
  return list.filter((u) => u.pos <= 2);
}
function allyRight3(list) {
  // 我方右侧 3 格（被冰雾打）= pos 2,3,4
  return list.filter((u) => u.pos >= 2);
}
