/**
 * state/Party.js —— 编队（§5）、好感/羁绊、主角等级/经验、心理压力
 *
 * - 编队 1..3 人，主角必在；初始默认 主角+夏阳+陆悠悠。
 * - 队友 base.atk = atkBase + atkPerBond × bondLevel。
 * - 羁绊等级每 10 点好感 +1，只升不降，上限 10；等级 1 可入队。
 * - 测试期：技能全解锁，初始羁绊 1、好感 10。
 * - 技能组整队共享：主动 ≤4，其余连携（§4.5.2）。
 */

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { CONFIG } from '../core/Const.js';
import { CHARACTERS, getSkill } from '../data/skills.js';

function defaultBond() {
  // 测试期调试参数
  return { xiayang: { affinity: 10, bond: 1 }, luyouyou: { affinity: 10, bond: 1 } };
}

export class Party {
  constructor() {
    /** 当前编队成员 id（主角必在首位） */
    this.members = ['hero', 'xiayang', 'luyouyou'];
    /** 同行状态（剧情决定）；测试期全员同行 */
    this.accompany = new Set(['xiayang', 'luyouyou']);
    /** 好感/羁绊 */
    this.relations = defaultBond();
    /** 整队技能组：主动 id 列表（≤4）+ 连携 id 列表 */
    this.skillSet = this.defaultSkillSet();

    // 主角成长
    this.heroLevel = 0;
    this.heroXp = 0;
    // 基础属性加成（升级/永久物品/天赋都会影响；这里只存"升级"加的部分，
    // 永久物品与天赋在构造 base 快照时动态叠加）
    this.heroBonus = { atk: 0, maxHp: 0, def: 0, speed: 0 };
    // 心理压力
    this.mental = 0;
  }

  defaultSkillSet() {
    // 初始给一套合法配置：主角斩击 + 夏阳淬火/鼓舞 + 陆悠悠精巧射击（4 主动）
    return {
      active: ['hero_slash', 'xy_quench', 'xy_inspire', 'lyy_sharp'],
      chain: ['hero_luanmo', 'xy_blaze', 'lyy_windrise'],
      // 协同技能元素配置（主角·协同），默认火
      heroCooperateElement: 'fire',
    };
  }

  get leaderId() { return 'hero'; }
  has(id) { return this.members.includes(id); }

  /** 校验编队合法性 */
  isLegal() {
    return this.members.includes('hero') &&
      this.members.length >= 1 && this.members.length <= 3;
  }

  /** 校验技能组合法性：主动 ≤4 */
  isSkillSetLegal(set = this.skillSet) {
    return (set.active?.length ?? 0) <= CONFIG.ACTIVE_SKILL_CAP;
  }

  /** 保存技能组（主动超限拒绝；自动把主动排到连携前） */
  saveSkillSet(set) {
    if ((set.active?.length ?? 0) > CONFIG.ACTIVE_SKILL_CAP) return false;
    this.skillSet = {
      active: (set.active || []).slice(0, CONFIG.ACTIVE_SKILL_CAP),
      chain: set.chain || [],
      heroCooperateElement: set.heroCooperateElement || this.skillSet.heroCooperateElement,
    };
    EventBus.emit(GE.PARTY_CHANGE, { kind: 'skillSet' });
    return true;
  }

  addMember(id) {
    if (id === 'hero' || this.has(id)) return false;
    if (!this.canJoin(id)) return false;
    if (this.members.length >= 3) return false;
    this.members.push(id);
    EventBus.emit(GE.PARTY_CHANGE, { kind: 'add', id });
    return true;
  }
  removeMember(id) {
    if (id === 'hero') return false;
    this.members = this.members.filter((m) => m !== id);
    EventBus.emit(GE.PARTY_CHANGE, { kind: 'remove', id });
    return true;
  }

  /** 入队条件：同行且羁绊≥1 */
  canJoin(id) {
    return this.accompany.has(id) && (this.relations[id]?.bond ?? 0) >= 1;
  }

  getRel(id) {
    if (!this.relations[id]) this.relations[id] = { affinity: 0, bond: 0 };
    return this.relations[id];
  }

  /** 增减好感；每满 10 点好感，羁绊 +1（只升不降） */
  addAffinity(id, delta) {
    const r = this.getRel(id);
    r.affinity += delta;
    while (r.affinity >= (r.bond + 1) * 10 && r.bond < 10) {
      r.bond += 1;
      EventBus.emit(GE.AFFINITY_CHANGE, { id, bondUp: true, bond: r.bond });
    }
    EventBus.emit(GE.AFFINITY_CHANGE, { id, affinity: r.affinity, bond: r.bond });
  }

  bondLevel(id) { return this.relations[id]?.bond ?? 0; }

  /**
   * 队友当前攻击力（含羁绊成长）。
   * 天赋"自身基础攻击力+45/60"等在战斗 base 快照时叠加。
   */
  companionAtk(id) {
    const c = CHARACTERS[id];
    if (!c) return 0;
    const b = c.def.base;
    const lv = this.bondLevel(id);
    return (b.atk ?? 0) + (b.atkPerBond ?? 0) * lv;
  }

  // ---------- 主角经验/升级 ----------
  /** 升到下一级所需经验：初始20，每 5 级后每级 +5（§4.10.6） */
  xpForNextLevel(level = this.heroLevel) {
    return 20 + Math.floor(level / 5) * 5;
  }
  gainXp(n) {
    this.heroXp += n;
    EventBus.emit(GE.XP_GAIN, { xp: this.heroXp, level: this.heroLevel });
  }
  /** 结算连续升级，返回每次升级的待选加成（由 UI 弹出二选一） */
  drainLevelUps() {
    const ups = [];
    while (this.heroLevel < CONFIG.HERO_LEVEL_CAP && this.heroXp >= this.xpForNextLevel()) {
      this.heroXp -= this.xpForNextLevel();
      this.heroLevel += 1;
      ups.push(this.heroLevel);
      EventBus.emit(GE.HERO_LEVELUP, { level: this.heroLevel });
    }
    return ups;
  }
  /** 应用升级选项 */
  applyLevelChoice(choice) {
    switch (choice) {
      case 'atk': this.heroBonus.atk += 5; break;
      case 'hp': this.heroBonus.maxHp += 25; break;
      case 'gold': EventBus.emit(GE.GOLD_CHANGE, {}); return 'gold10';
      case 'def': this.heroBonus.def += 4; break;
      case 'speed': this.heroBonus.speed += 5; break;
    }
  }

  addMental(n) {
    this.mental = Math.max(-999, Math.min(999, this.mental + n));
    EventBus.emit(GE.MENTAL_CHANGE, { value: this.mental });
  }

  serialize() {
    return {
      members: this.members,
      accompany: [...this.accompany],
      relations: this.relations,
      skillSet: this.skillSet,
      heroLevel: this.heroLevel,
      heroXp: this.heroXp,
      heroBonus: this.heroBonus,
      mental: this.mental,
    };
  }
  static deserialize(d) {
    const p = new Party();
    p.members = d.members || ['hero'];
    p.accompany = new Set(d.accompany || []);
    p.relations = d.relations || {};
    p.skillSet = d.skillSet || p.defaultSkillSet();
    p.heroLevel = d.heroLevel ?? 0;
    p.heroXp = d.heroXp ?? 0;
    p.heroBonus = d.heroBonus || { atk: 0, maxHp: 0, def: 0, speed: 0 };
    p.mental = d.mental ?? 0;
    return p;
  }
}

/** 升级选项池（等概率 5 选 2，不重复） */
export const LEVEL_CHOICES = [
  { id: 'atk', text: '基础攻击力 +5' },
  { id: 'hp', text: '基础最大生命值 +25' },
  { id: 'gold', text: '金币 +10' },
  { id: 'def', text: '基础防御力 +4' },
  { id: 'speed', text: '基础速度 +5' },
];

export { getSkill };
