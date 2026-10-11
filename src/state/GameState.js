/**
 * state/GameState.js —— 中央游戏世界状态（唯一权威数据）
 *
 * 持有：地图、主角位置/HP/附着、AP、天数、健康、区域、背包、编队、
 * 任务、永久效果聚合、日级 buff/debuff、统计计数（二哈成长/扩散次数等）。
 * 所有系统读/写都经由这里；UI 只读并订阅事件。
 *
 * 战斗态的临时数据放在 BattleSession（不持久化到世界快照之外），
 * 但主角 HP / 附着需要跨战斗继承（§4.10.2、§3.13.5）。
 */

import { CONFIG, Terrain, ContentType, Area } from '../core/Const.js';
import { GameMap, key } from './GameMap.js';
import { Inventory } from './Inventory.js';
import { Party } from './Party.js';

export class GameState {
  constructor() {
    this.version = 1;
    this.map = GameMap.initInitial();
    this.heroPos = { x: 0, y: 0 };

    // AP
    this.ap = CONFIG.AP_MAX_START;
    this.apMax = CONFIG.AP_MAX_START;

    // 时间 / 区域
    this.day = 1;
    this.area = Area.WILD;

    // 周目级资源
    this.health = CONFIG.HEALTH_START;
    this.heroHp = CONFIG.HERO_HP_START;
    this.heroAura = null;            // 主角元素附着（跨战斗保留）
    this.dayBuffs = [];              // 【持续整天】状态（抑郁、明心浆、啤酒等）

    this.inventory = new Inventory();
    this.party = new Party();
    this.quests = [];                // 任务运行态（§6.7）

    // 永久物品效果聚合（每次增删永久物品时重算，见 systems/Permanent.js）
    this.permAgg = null;

    // 每日摧毁计数（森林/矿脉各日限 2 次）
    this.dailyDestroy = { forest: 0, mine: 0 };

    // 跨战斗 / 跨天的怪物成长（二哈、中二病、草史莱姆召唤物）
    this.globalGrowth = {};
    // 稀有生物残血记忆（暴躁的熊）
    this.rareMemory = {};

    // 战斗中累计的跨技能计数（焚灭吸收数/扩散数/攻击技能数）由 BattleSession 管理；
    // 草史莱姆"生长"按天加 base，存这里。
    this.flags = {
      nirvanaUsedToday: false,       // 涅槃每天 1 次
    };

    // 已完成主线/事件记录（防止重复触发）
    this.records = { events: new Set(), quests: {} };
  }

  heroTile() {
    return this.map.get(this.heroPos.x, this.heroPos.y);
  }
  heroTerrain() {
    return this.heroTile()?.terrain ?? Terrain.NONE;
  }

  /** 重置为新周目（§健康归零等） */
  resetNewRun() {
    const fresh = new GameState();
    Object.assign(this, fresh);
  }

  serialize() {
    return {
      version: this.version,
      map: this.map.serialize(),
      heroPos: this.heroPos,
      ap: this.ap, apMax: this.apMax,
      day: this.day, area: this.area,
      health: this.health, heroHp: this.heroHp, heroAura: this.heroAura,
      dayBuffs: this.dayBuffs,
      inventory: this.inventory.serialize(),
      party: this.party.serialize(),
      quests: this.quests,
      permAgg: this.permAgg,
      dailyDestroy: this.dailyDestroy,
      globalGrowth: this.globalGrowth,
      rareMemory: this.rareMemory,
      flags: this.flags,
      records: { events: [...(this.records.events || [])], quests: this.records.quests || {} },
    };
  }

  static deserialize(d) {
    const gs = new GameState();
    gs.version = d.version ?? 1;
    gs.map = GameMap.deserialize(d.map);
    gs.heroPos = d.heroPos;
    gs.ap = d.ap; gs.apMax = d.apMax;
    gs.day = d.day; gs.area = d.area;
    gs.health = d.health; gs.heroHp = d.heroHp; gs.heroAura = d.heroAura ?? null;
    gs.dayBuffs = d.dayBuffs || [];
    gs.inventory = Inventory.deserialize(d.inventory);
    gs.party = Party.deserialize(d.party);
    gs.quests = d.quests || [];
    gs.permAgg = d.permAgg ?? null;
    gs.dailyDestroy = d.dailyDestroy || { forest: 0, mine: 0 };
    gs.globalGrowth = d.globalGrowth || {};
    gs.rareMemory = d.rareMemory || {};
    gs.flags = d.flags || { nirvanaUsedToday: false };
    gs.records = { events: new Set(d.records?.events || []), quests: d.records?.quests || {} };
    return gs;
  }
}
