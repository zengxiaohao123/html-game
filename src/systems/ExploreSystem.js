/**
 * systems/ExploreSystem.js —— 探索态全部规则
 *
 * 职责：移动（WASD/前往，含冰面滑动）、AP、content 触发（空地搜索/奖励/
 *   作战/紧急作战/事件入口）、每日刷新、建造地块、设施放置/拆除/交互、
 *   森林/矿脉摧毁、地形附着。
 *
 * 战斗/事件本身由各自系统接管；本系统只抛出"请求进入"的事件/回调，
 * 由 GameDirector 决定切换状态。
 */

import {
  Terrain, ContentType, CONFIG,
  TERRAIN_AURA, CONTENT_ROLL, Area,
} from '../core/Const.js';
import { rng } from '../core/Rng.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { GameMap, key } from '../state/GameMap.js';
import { GameLog } from '../core/Logger.js';
import {
  EMPTY_TILE_TIER_PROB, sampleTier, compensationResource, MINE_DROP_TABLE, GOLD_ID,
} from '../data/loot.js';
import { getFacility } from '../data/facilities.js';
import { getItem } from '../data/items.js';

const CH = 'explore';

export class ExploreSystem {
  /**
   * @param {import('../state/GameState.js').GameState} gs
   * @param {object} hooks 由 GameDirector 提供
   *   - onBattle(nodeId, kind)  进入战斗
   *   - onEvent(eventId)       进入事件
   *   - onReward(tile)         奖励地块（本期用通用搜索奖励）
   */
  constructor(gs, hooks = {}) {
    this.gs = gs;
    this.hooks = hooks;
    this.buildMode = false;
    this.viewport = { minX: -6, minY: -4, maxX: 6, maxY: 4 };
  }

  setViewport(vp) { this.viewport = vp; }
  toggleBuild() {
    this.buildMode = !this.buildMode;
    EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'buildMode', open: this.buildMode });
    return this.buildMode;
  }

  // ---------------- 移动 ----------------
  /**
   * 尝试向四方向移动（成功扣 1 AP）。返回实际停留格（冰面可能滑多格）。
   */
  moveDir(dx, dy) {
    if (this.buildMode) return null;
    return this.stepTo(this.gs.heroPos.x + dx, this.gs.heroPos.y + dy, true);
  }

  /** 点击"前往"：target 必须四方向相邻且可通行；原地踏步也走这里 */
  goTo(x, y) {
    const { x: hx, y: hy } = this.gs.heroPos;
    if (x === hx && y === hy) {
      // 原地踏步：扣 1 AP，重新触发本格 content
      return this._spendApAndTrigger(1, true);
    }
    if (GameMap.manhattan(hx, hy, x, y) !== 1) return null;
    return this.stepTo(x, y, true);
  }

  /**
   * 单步进入某格（调用方保证相邻）。处理冰面连锁滑动。
   */
  stepTo(x, y, fromInput) {
    const { gs } = this;
    const tile = gs.map.get(x, y);
    if (!tile) { GameLog.info(CH, '虚空之外，无路可走。'); return null; }
    if (!gs.map.enterable(x, y)) {
      // 撞 entity / 阻挡地形：不扣 AP
      GameLog.info(CH, '无法前往那里。');
      return null;
    }
    if (gs.ap < 1) { GameLog.bad(CH, '行动力不足，去帐篷休息吧。'); return null; }

    // 消耗 AP 并落位
    gs.ap -= 1;
    EventBus.emit(GE.EXPLORE_AP_CHANGE, { ap: gs.ap });
    const from = { ...gs.heroPos };
    gs.heroPos = { x, y };
    EventBus.emit(GE.EXPLORE_MOVE, { from, to: { x, y }, cost: 1 });

    // 冰面滑动：沿当前方向继续，直到不能滑
    let cx = x, cy = y, guard = 0;
    if (tile.terrain === Terrain.ICE) {
      const dx = Math.sign(x - from.x), dy = Math.sign(y - from.y);
      while (guard++ < 50) {
        const nx = cx + dx, ny = cy + dy;
        const nt = gs.map.get(nx, ny);
        // 前方非冰 / 有实体 / 阻挡 / Void → 停
        if (!nt || !gs.map.enterable(nx, ny) || nt.terrain !== Terrain.ICE) break;
        cx = nx; cy = ny;
        gs.heroPos = { x: cx, y: cy };
      }
      if (cx !== x || cy !== y) {
        GameLog.info(CH, '脚下冰面打滑，一路滑了出去！');
        EventBus.emit(GE.EXPLORE_MOVE, { from: { x, y }, to: { x: cx, y: cy }, cost: 0, slide: true });
      }
    }

    this._afterMoveApSpent();
    this._enterCurrentTile();
    return gs.heroPos;
  }

  /** 消耗 AP 后统一处理（移动/主动技能）：地形附着刷新、移动回血等 */
  _afterMoveApSpent() {
    const { gs } = this;
    const terrain = gs.heroTerrain();
    const aura = TERRAIN_AURA[terrain];
    if (aura) {
      gs.heroAura = aura;
      EventBus.emit(GE.BATTLE_AURA, { who: 'hero', aura });
    }
    // 永久物品：枯木新枝 移动回血；陆悠悠·蹁跹 移动回 30
    const agg = gs.permAgg;
    let heal = agg?.moveHealTotal ?? 0;
    if (gs.party.has('luyouyou')) heal += 30; // 蹁跹·等级1（测试期天赋生效）
    if (heal > 0) this._healHero(heal, '移动回复');
  }

  _healHero(n, reason) {
    const { gs } = this;
    const max = this.heroMaxHp();
    const before = gs.heroHp;
    gs.heroHp = Math.min(max, gs.heroHp + n);
    const real = gs.heroHp - before;
    if (real > 0) {
      EventBus.emit(GE.BATTLE_HEAL, { who: 'hero', amount: real, reason });
      GameLog.info(CH, `生命值回复 ${real} 点（${reason}）。`);
    }
  }

  // ---------------- 进入地块 content ----------------
  _enterCurrentTile() {
    const { gs } = this;
    const tile = gs.heroTile();
    if (!tile) return;
    const c = tile.content;
    if (tile.contentDoneToday && c !== ContentType.EMPTY) {
      tile.content = ContentType.EMPTY;
    }
    switch (tile.content) {
      case ContentType.EMPTY: this._searchEmpty(tile); break;
      case ContentType.REWARD: this._gainReward(tile); break;
      case ContentType.BATTLE: this._startBattle(tile, 'battle'); break;
      case ContentType.ELITE: this._startBattle(tile, 'elite'); break;
      case ContentType.EVENT: this._startEvent(tile); break;
      default: break;
    }
  }

  /** 空地三档搜索（§3.4.2）+ 愧怍补偿（§3.4.3） */
  _searchEmpty(tile) {
    const { gs } = this;
    const got = [];
    for (const tier of [1, 2, 3]) {
      if (rng.roll(EMPTY_TILE_TIER_PROB[tier])) {
        const e = sampleTier(tier, gs.area, rng);
        if (e) got.push(e);
      }
    }
    if (got.length === 0) {
      // 《愧怍》补偿：每件独立判定
      const kuizuoCount = gs.inventory.count('kuizuo');
      for (let i = 0; i < kuizuoCount; i++) {
        if (rng.roll(0.50)) {
          const r = rng.next();
          if (r < 0.25) got.push(compensationResource(gs.area, rng, 1));
          else if (r < 0.50) got.push(compensationResource(gs.area, rng, 2));
          // 50% 无补偿
        }
      }
    }
    if (got.length > 0) {
      gs.inventory.gainLoot(got);
      const text = got.map((g) => `${g.count}×${this._itemName(g.item)}`).join('、');
      GameLog.good(CH, `搜索收获：${text}`);
      EventBus.emit(GE.ITEM_TOAST, { loot: got });
    } else {
      GameLog.info(CH, '这里空空如也，什么也没找到。');
    }
    tile.content = ContentType.EMPTY;
    tile.contentDoneToday = true;
  }

  _itemName(id) {
    if (id === GOLD_ID) return '金币';
    return getItem(id)?.name ?? id;
  }

  _gainReward(tile) {
    // 奖励地块：给一份随机档（比空地更稳），直接进背包
    const tier = rng.weighted([{ value: 1, weight: 3 }, { value: 2, weight: 2 }, { value: 3, weight: 1 }]);
    const e = sampleTier(tier, this.gs.area, rng);
    if (e) {
      this.gs.inventory.gainLoot([e]);
      GameLog.good(CH, `奖励：${e.count}×${this._itemName(e.item)}`);
      EventBus.emit(GE.ITEM_TOAST, { loot: [e] });
    }
    tile.content = ContentType.EMPTY;
    tile.contentDoneToday = true;
  }

  _startBattle(tile, kind) {
    // 具体 node 由 Director 依据地块绑定决定；地块 extra.nodeId 存节点 id。
    const nodeId = tile.extra?.nodeId || null;
    EventBus.emit(GE.EXPLORE_CONTENT, { type: kind, pos: { ...this.gs.heroPos } });
    this.hooks.onBattle?.(nodeId, kind, { x: this.gs.heroPos.x, y: this.gs.heroPos.y });
  }

  _startEvent(tile) {
    const eventId = tile.extra?.eventId || null;
    EventBus.emit(GE.EXPLORE_CONTENT, { type: 'event', pos: { ...this.gs.heroPos } });
    this.hooks.onEvent?.(eventId, { x: this.gs.heroPos.x, y: this.gs.heroPos.y });
  }

  /** 战斗/事件结束回到探索：清空该格 content（§3.8.3） */
  resolveCurrentContent() {
    const tile = this.gs.heroTile();
    if (tile) { tile.content = ContentType.EMPTY; tile.contentDoneToday = true; }
  }

  // ---------------- 每日刷新（§3.8） ----------------
  sleep() {
    const { gs } = this;
    if (!this._canSleep()) { GameLog.bad(CH, '现在不能休息。'); return false; }

    // —— 睡觉结算（在天数增加前，基于"当天"的永久物品/天赋）——
    this._sleepSettle();

    gs.day += 1;
    this._onNewDay();
    gs.ap = gs.apMax;
    EventBus.emit(GE.EXPLORE_AP_CHANGE, { ap: gs.ap });
    EventBus.emit(GE.EXPLORE_NEW_DAY, { day: gs.day });
    GameLog.system(CH, `——第 ${gs.day} 天——`);
    return true;
  }

  _canSleep() {
    // 战斗/事件/剧情中由 Director 禁用入口；这里兜底
    return true;
  }

  /** 睡觉回血/健康/资源/抽水泵等（永久物品 + 天赋 + 设施） */
  _sleepSettle() {
    const { gs } = this;
    const agg = gs.permAgg;
    let healHp = agg?.sleepHealTotal ?? 0;
    let healHealth = 0;
    let apBonus = 0;

    // 夏阳·活力满满：睡觉回复的生命值、健康翻倍，额外 1 AP
    const vitality = gs.party.has('xiayang');
    // 陆悠悠·巧手：40% 随机资源
    // 陷阱：每个 50% 随机自然资源
    // 被子：每个 30 生命
    if (vitality) { healHp *= 2; healHealth *= 2; apBonus += 1; }

    if (healHp > 0) this._healHero(healHp, '休息');
    if (healHealth > 0) this.addHealth(healHealth, '休息');
    if (apBonus > 0) { gs.ap = Math.min(gs.ap + apBonus, gs.apMax + 99); }

    // 陷阱资源
    const trapN = gs.inventory.count('trap');
    const trapLoot = [];
    for (let i = 0; i < trapN; i++) {
      if (rng.roll(0.50)) trapLoot.push(compensationResource(Area.WILD, rng, 1));
    }
    // 巧手
    if (gs.party.has('luyouyou') && rng.roll(0.40)) {
      trapLoot.push(compensationResource(gs.area, rng, 1));
    }
    if (trapLoot.length) {
      gs.inventory.gainLoot(trapLoot);
      GameLog.good(CH, `睡前收获：${trapLoot.map((g) => `${g.count}×${this._itemName(g.item)}`).join('、')}`);
    }

    // 抽水泵每日产水（放置当天不获得：放置日记录在 extra.placeDay，次日起）
    for (const { tile } of gs.map.facilityTiles()) {
      if (tile.entity?.id === 'pump') {
        const e = tile.extra ?? (tile.extra = {});
        if (e.placeDay !== undefined && e.placeDay < gs.day) {
          e.stored = Math.min(10, (e.stored ?? 0) + 1);
        }
      }
      if (tile.entity?.id === 'campfire') {
        // 篝火 2 天自动熄灭（放置当天算第 1 天）
        const e = tile.extra ?? (tile.extra = {});
        if (e.litDay !== undefined && gs.day + 1 - e.litDay >= 2) {
          tile.entity.id = 'campfireOut';
          tile.entity.name = '熄灭的篝火';
          GameLog.info(CH, '篝火熄灭了。');
        }
      }
    }

    // 日级 debuff 扣减（如饥饿占位）、心理压力每日抑郁判定
    this._dailyMentalCheck();
  }

  _dailyMentalCheck() {
    const { gs } = this;
    const p = Math.max(0, Math.min(100, gs.party.mental)) / 100;
    // 移除旧抑郁
    gs.dayBuffs = gs.dayBuffs.filter((b) => b.buffId !== 'depression');
    if (rng.roll(p)) {
      gs.dayBuffs.push({ buffId: 'depression', days: 1 });
      GameLog.bad(CH, '心情沉到了谷底，今天提不起力气（【抑郁】）。');
    }
    // 其余整天 buff 天数 -1
    gs.dayBuffs = gs.dayBuffs
      .map((b) => ({ ...b, days: (b.days ?? 1) - 1 }))
      .filter((b) => b.days > 0);

    gs.flags.nirvanaUsedToday = false;
  }

  _onNewDay() {
    const { gs } = this;
    gs.dailyDestroy = { forest: 0, mine: 0 };
    const hx = gs.heroPos.x, hy = gs.heroPos.y;
    for (const [, tile] of gs.map.tiles) {
      if (tile.entity?.kind === 'facility') {
        tile.content = ContentType.EMPTY; tile.contentDoneToday = false;
      }
      // 主角格 & 设施格强制空地；其余 roll
    }
    // 主角当前坐标 key
    const heroK = key(hx, hy);
    for (const [k, tile] of gs.map.tiles) {
      if (tile.entity?.kind === 'facility') continue;
      if (k === heroK) { tile.content = ContentType.EMPTY; tile.contentDoneToday = false; continue; }
      tile.content = this._rollContent();
      tile.contentDoneToday = false;
      tile.extra = tile.extra || {};
      // 作战/紧急地块绑定随机节点（进入时由 Director 解析也可，这里先打标）
      if (tile.content === ContentType.BATTLE || tile.content === ContentType.ELITE) {
        tile.extra.pendingKind = tile.content;
      }
    }
    // 新一天默认对主角附着 1 次所在地形
    const aura = TERRAIN_AURA[gs.heroTerrain()];
    if (aura) { gs.heroAura = aura; EventBus.emit(GE.BATTLE_AURA, { who: 'hero', aura }); }
  }

  _rollContent() {
    let r = rng.next(), acc = 0;
    for (const row of CONTENT_ROLL) {
      acc += row.p;
      if (r < acc) {
        if (row.type === 'elite' && rng.roll(0.0)) {/*预留稀有降权*/}
        return row.type;
      }
    }
    return ContentType.EMPTY;
  }

  // ---------------- 建造地块（§3.9.1） ----------------
  buildTile(x, y, tileItemId) {
    const { gs } = this;
    const item = getItem(tileItemId);
    if (!item?.placeTile) return false;
    if (!gs.map.isVoid(x, y)) { this._failBuild('此处已经有地块了。'); return false; }
    if (!GameMap.inViewport(x, y, this.viewport)) { this._failBuild('超出视野，走近一些再建造。'); return false; }
    if (gs.inventory.count(tileItemId) < 1) { this._failBuild('材料不足。'); return false; }

    gs.inventory.remove(tileItemId, 1);
    const tile = {
      terrain: item.terrain || Terrain.NONE,
      content: this._rollContent(),
      entity: null,
      contentDoneToday: false,
      extra: { pendingKind: null },
    };
    if (tile.content === ContentType.BATTLE || tile.content === ContentType.ELITE) {
      tile.extra.pendingKind = tile.content;
    }
    gs.map.set(x, y, tile);
    EventBus.emit(GE.BUILD_TILE, { x, y, tile });
    GameLog.good(CH, `铺设了一块${item.name}。`);
    return true;
  }

  _failBuild(msg) {
    GameLog.bad(CH, msg);
    EventBus.emit(GE.UI_TOAST, { text: '无法在此处建造地块', kind: 'bad' });
  }

  // ---------------- 设施（§3.9.2 / §3.10 / §3.11） ----------------
  buildFacility(x, y, facilityId) {
    const { gs } = this;
    const fac = getFacility(facilityId);
    if (!fac?.cost) return false;
    const tile = gs.map.get(x, y);
    if (!tile) { this._failBuild('设施必须建在已有地块上。'); return false; }
    if (tile.entity) { this._failBuild('这一格已经被占用。'); return false; }
    if (fac.onWater && tile.terrain !== Terrain.WATER) { this._failBuild('抽水泵只能建在水面上。'); return false; }
    if (!fac.onWater && tile.terrain === Terrain.WATER) { this._failBuild('不能建在水面上。'); return false; }
    if (!GameMap.inViewport(x, y, this.viewport)) { this._failBuild('超出视野范围。'); return false; }
    if (!gs.inventory.payCost(fac.cost)) { this._failBuild('材料不足。'); return false; }

    tile.entity = { kind: 'facility', id: fac.id, name: fac.name };
    tile.extra = tile.extra || {};
    if (fac.id === 'pump') { tile.extra.placeDay = gs.day; tile.extra.stored = 0; }
    if (fac.id === 'campfire') { tile.extra.litDay = gs.day; }
    EventBus.emit(GE.BUILD_FACILITY, { x, y, facilityId });
    GameLog.good(CH, `建造了${fac.name}。`);
    return true;
  }

  /** 拆除：返还 ceil(材料×0.5)（§3.11） */
  demolish(x, y) {
    const { gs } = this;
    const tile = gs.map.get(x, y);
    const ent = tile?.entity;
    if (!ent || ent.kind !== 'facility') return false;
    const fac = getFacility(ent.id === 'campfireOut' ? 'campfireOut' : ent.id);
    // 抽水泵拆除：先收储水
    if (ent.id === 'pump' && tile.extra?.stored > 0) {
      gs.inventory.add('water', tile.extra.stored);
      GameLog.good(CH, `收取了 ${tile.extra.stored} 份水。`);
    }
    if (fac?.cost) {
      for (const [mat, n] of Object.entries(fac.cost)) {
        const back = Math.ceil(n * 0.5);
        if (back > 0) gs.inventory.add(mat, back);
      }
    }
    tile.entity = null;
    GameLog.info(CH, `拆除了${ent.name}，返还了一半材料。`);
    EventBus.emit(GE.BUILD_FACILITY, { x, y, demolished: true });
    return true;
  }

  /** 收取抽水泵 */
  collectPump(x, y) {
    const tile = this.gs.map.get(x, y);
    if (tile?.entity?.id !== 'pump') return false;
    const n = tile.extra?.stored ?? 0;
    if (n <= 0) { GameLog.info(CH, '抽水泵里还没有存水。'); return false; }
    this.gs.inventory.add('water', n);
    tile.extra.stored = 0;
    GameLog.good(CH, `收取了 ${n} 份水。`);
    return true;
  }

  /** 相邻可交互的设施列表 */
  adjacentFacilities() {
    const { gs } = this;
    const { x, y } = gs.heroPos;
    const out = [];
    for (const [nx, ny] of GameMap.neighbors4(x, y)) {
      const t = gs.map.get(nx, ny);
      if (t?.entity?.kind === 'facility') out.push({ x: nx, y: ny, entity: t.entity, tile: t });
    }
    return out;
  }

  // ---------------- 森林 / 矿脉摧毁（§3.2.1.1） ----------------
  attackTerrain(x, y) {
    const { gs } = this;
    const tile = gs.map.get(x, y);
    if (!tile) return false;
    const isF = tile.terrain === Terrain.FOREST;
    const isM = tile.terrain === Terrain.MINE;
    if (!isF && !isM) { GameLog.info(CH, '那里没有可攻击的地形。'); return false; }

    // 距离：主动技能可达（这里简化为四方向相邻；由技能系统精确化）
    if (GameMap.manhattan(gs.heroPos.x, gs.heroPos.y, x, y) > 3) return false;

    const kind = isF ? 'forest' : 'mine';
    if (gs.dailyDestroy[kind] >= 2) { GameLog.info(CH, '今天已经采集得够多了。'); return false; }

    // HP=2，徽章 -50% => 1
    const badge = gs.inventory.count(isF ? 'woodBadge' : 'mineBadge') > 0;
    const maxHp = badge ? 1 : 2;
    tile.extra = tile.extra || {};
    tile.extra.hp = (tile.extra.hp ?? maxHp) - 1; // 每次固定 1，多段只算 1
    if (tile.extra.hp > 0) { GameLog.info(CH, '击中了，但还没有被摧毁。'); return true; }

    // 摧毁
    tile.terrain = Terrain.NONE;
    tile.extra = {};
    gs.dailyDestroy[kind] += 1;
    if (isF) {
      gs.inventory.add('wood', 3);
      GameLog.good(CH, '砍倒树木，获得 木材×3。');
    } else {
      const drop = rng.weighted(MINE_DROP_TABLE.map((d) => ({ value: d.item, weight: d.p })));
      gs.inventory.add(drop, 1);
      GameLog.good(CH, `挖开矿脉，获得 ${this._itemName(drop)}×1。`);
    }
    return true;
  }

  // ---------------- 健康 ----------------
  addHealth(n, reason = '') {
    const { gs } = this;
    gs.health += n;
    EventBus.emit(GE.HEALTH_CHANGE, { health: gs.health, delta: n });
    if (n > 0) GameLog.good(CH, `健康 +${n}${reason ? `（${reason}）` : ''}`);
    if (gs.health <= 0) {
      EventBus.emit(GE.HEALTH_CHANGE, { health: gs.health, runFailed: true });
    }
  }

  heroMaxHp() {
    // 由 Permanent/Talent 系统给精确值；这里给基础+升级的兜底
    const { gs } = this;
    let max = 100 + gs.party.heroBonus.maxHp;
    if (gs.party.has('luyouyou')) max += 100; // 烹饪天赋
    max += (gs.permAgg?.baseMaxHp ?? 0);
    return max;
  }
}
