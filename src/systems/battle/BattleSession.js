/**
 * systems/battle/BattleSession.js —— 一场战斗的运行时数据（不直接持久化）
 *
 * 战场（§4.1）：左右两排各 5 格。
 * unit：
 *   side: 'ally' | 'enemy'
 *   pos:  0..4（左→右）
 *   role: 'leader' | 'companion' | 'summon' | 'enemy' | 'residue'
 *   id/defId/name/sprite
 *   base{} 进入战斗快照；stats{} 动态值
 *   hp/shield/speed/critRate/dodge/block
 *   aura（至多1）/ statuses[]（含 stacks、duration）
 *   resists{}
 *   intent 当前意图
 * 队友（companion）不占格、无 hp/def，技能由玩家主动阶段释放（§5.2）。
 */

import { CONFIG } from '../../core/Const.js';
import { CHARACTERS } from '../../data/skills.js';
import { getEnemy, SLIME_IDS } from '../../data/enemies.js';
import { rng } from '../../core/Rng.js';

let UID = 1;
export const nextUid = () => `u${UID++}`;

export class BattleUnit {
  constructor(init) {
    Object.assign(this, {
      uid: nextUid(),
      side: 'enemy', pos: 0, role: 'enemy',
      id: '', defId: '', name: '', sprite: null,
      base: { atk: 0, maxHp: 0, def: 0, speed: 0 },
      stats: { atk: 0, maxHp: 0, def: 0, speed: 0 },
      hp: 0, shield: 0,
      critRate: 0, dodge: 0, block: 0,
      aura: null,
      statuses: [],
      resists: { fire: 0, water: 0, grass: 0, thunder: 0, ice: 0, wind: 0, rock: 0, physical: 0 },
      intent: null,
      alive: true,
      isSummon: false,
      notEnemy: false,
      skills: [],
      talents: [],
      // 敌人剧本游标
      scriptIdx: 0,
      meta: {},
    }, init);
  }

  findStatus(buffId) { return this.statuses.find((s) => s.buffId === buffId) || null; }
  addOrRefreshStatus(st) {
    const exist = this.findStatus(st.buffId);
    if (exist) {
      if (st.stackable) {
        exist.stacks = (exist.stacks ?? 1) + (st.stacks ?? 1);
        if (st.maxStacks) exist.stacks = Math.min(exist.stacks, st.maxStacks);
      }
      if (st.keepHighest) exist.value = Math.max(exist.value ?? 0, st.value ?? 0);
      if ((st.duration ?? -1) > (exist.duration ?? -1)) exist.duration = st.duration;
      return exist;
    }
    this.statuses.push(st);
    return st;
  }
  removeStatus(buffId) {
    this.statuses = this.statuses.filter((s) => s.buffId !== buffId);
  }
}

export class BattleSession {
  /**
   * @param {object} opts { gs, node, party } 
   */
  constructor({ gs, node, party }) {
    this.gs = gs;
    this.node = node;
    this.rowN = CONFIG.BATTLE_ROW;
    this.units = [];           // 所有占格单位（不含队友）
    this.companions = [];      // 队友（不占格）
    this.leader = null;
    this.round = 0;
    this.phase = 'init';       // init / player / enemy / end
    this.result = null;
    this.hand = [];            // 元素手牌（每回合抽）
    this.activeUses = {};      // 角色本回合主动可用次数
    this.chainQueue = [];      // 连携提示队列
    this.cooldowns = new Map();// skillId -> 剩余回合
    this.counters = {
      absorbedFireByXiayang: 0,
      spread: 0,
      attackSkills: 0,
    };
    this.lastAttackedEnemyUid = null;
    this.leaderFledFailed = false;   // 本回合主角逃跑失败
    this.log = [];
    this.meta = { summonSide: {} };
  }

  unitAt(side, pos) {
    return this.units.find((u) => u.alive && u.side === side && u.pos === pos) || null;
  }
  livingBySide(side) {
    return this.units.filter((u) => u.alive && u.side === side)
      .sort((a, b) => a.pos - b.pos);
  }
  enemies(includeSummon = true) {
    return this.units.filter((u) => u.alive && u.side === 'enemy' &&
      (includeSummon || !u.isSummon) && !u.notEnemy);
  }
  allies(includeSummon = true) {
    return this.units.filter((u) => u.alive && u.side === 'ally' &&
      (includeSummon || !u.isSummon));
  }
  /** 原生敌人（非召唤、非残留）是否全灭 → 胜利 */
  allNativeEnemiesDead() {
    return !this.units.some((u) => u.alive && u.side === 'enemy' && !u.isSummon && !u.notEnemy);
  }
  leaderDead() {
    return !this.leader?.alive;
  }

  /** 找一个随机空位 */
  randomEmptyPos(side, rngSource = rng) {
    const used = new Set(this.units.filter((u) => u.alive && u.side === side).map((u) => u.pos));
    const empty = [];
    for (let i = 0; i < this.rowN; i++) if (!used.has(i)) empty.push(i);
    if (!empty.length) return null;
    return rngSource.pick(empty);
  }

  // ---------- 布阵 ----------
  deployLeader(party, gs) {
    const c = CHARACTERS.hero.def;
    const baseAtk = c.base.atk + party.heroBonus.atk;
    const baseMaxHp = c.base.maxHp + party.heroBonus.maxHp;
    const baseDef = c.base.def + party.heroBonus.def;
    const baseSpeed = c.base.speed + party.heroBonus.speed;
    const u = new BattleUnit({
      side: 'ally', pos: 2, role: 'leader', id: 'hero', defId: 'hero',
      name: c.name, sprite: null,
      base: { atk: baseAtk, maxHp: baseMaxHp, def: baseDef, speed: baseSpeed },
      stats: { atk: baseAtk, maxHp: baseMaxHp, def: baseDef, speed: baseSpeed },
      hp: gs.heroHp, // 跨战斗继承，不回满
      speed: baseSpeed,
      skills: [...CHARACTERS.hero.actives, ...CHARACTERS.hero.chains],
      talents: CHARACTERS.hero.talents,
      aura: gs.heroAura,
    });
    // 永久物品聚合
    if (gs.permAgg) {
      u.stats.atk += gs.permAgg.baseAtk ?? 0; u.base.atk += gs.permAgg.baseAtk ?? 0;
      u.stats.maxHp += gs.permAgg.baseMaxHp ?? 0; u.base.maxHp += gs.permAgg.baseMaxHp ?? 0;
      u.stats.def += gs.permAgg.baseDef ?? 0; u.base.def += gs.permAgg.baseDef ?? 0;
      u.critRate += gs.permAgg.critRate ?? 0;
      u.block += gs.permAgg.blockRate ?? 0;
    }
    u.stats.maxHp = u.base.maxHp;
    u.hp = Math.min(u.hp, u.stats.maxHp);
    this.leader = u;
    this.units.push(u);
  }

  deployCompanions(party) {
    for (const id of party.members.filter((m) => m !== 'hero')) {
      const c = CHARACTERS[id];
      if (!c) continue;
      const atk = party.companionAtk(id);
      const comp = new BattleUnit({
        side: 'ally', role: 'companion', id, defId: id,
        name: c.def.name,
        base: { atk, maxHp: null, def: null, speed: null },
        stats: { atk, maxHp: null, def: null, speed: null },
        skills: [...c.actives, ...c.chains],
        talents: c.talents,
      });
      // 天赋对自身基础攻击加成（无所畏惧+45 / 风息+60）在引擎天赋初始化里处理
      this.companions.push(comp);
      this.units.push(comp); // 便于统一检索，但不占格（pos 不用）
    }
  }

  deployEnemy(enemyId, pos = null, opts = {}) {
    const def = getEnemy(enemyId);
    if (!def) return null;
    const side = opts.side || 'enemy';
    const finalPos = pos ?? this.randomEmptyPos(side);
    if (finalPos === null) return null; // 满员直接消失
    const u = new BattleUnit({
      side, pos: finalPos, role: def.isSummon ? 'summon' : 'enemy',
      id: enemyId, defId: enemyId, name: def.name, sprite: def.sprite || null,
      isSummon: !!def.isSummon, notEnemy: !!def.notEnemy,
      base: { atk: def.atk, maxHp: def.maxHp, def: def.def, speed: def.speed ?? 0 },
      stats: { atk: def.atk, maxHp: def.maxHp, def: def.def, speed: def.speed ?? 0 },
      hp: def.maxHp, speed: def.speed ?? 0,
      skills: def.skills || [], talents: def.talents || [],
      resists: { fire: 0, water: 0, grass: 0, thunder: 0, ice: 0, wind: 0, rock: 0, physical: 0, ...(def.resists || {}) },
    });
    this.units.push(u);
    return u;
  }
}
