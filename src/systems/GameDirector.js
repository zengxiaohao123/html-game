/**
 * systems/GameDirector.js —— 顶层导演 / 状态机（§2）
 *
 * EXPLORE ⇄ COMBAT（事件/剧情作为探索态的暂停覆盖层）。
 * 职责：
 *   - 持有 GameState / ExploreSystem / CombatEngine
 *   - 地块 content → 战斗节点解析（随机挑同类型节点）
 *   - 战斗结束结算（奖励/健康/经验/地块清空）
 *   - 睡觉自动存档、内容段存档点
 *   - 周目失败（健康≤0）
 */

import { TopState, ContentType, BattleResult, Area } from '../core/Const.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { GameState } from '../state/GameState.js';
import { ExploreSystem } from './ExploreSystem.js';
import { CombatEngine } from './battle/CombatEngine.js';
import { BATTLE_NODES, ALL_NODE_IDS } from '../data/battleNodes.js';
import { rng } from '../core/Rng.js';
import { GameLog } from '../core/Logger.js';
import { writeSave, readSave } from '../core/Storage.js';
import { recomputePermanent } from './Permanent.js';

export class GameDirector {
  constructor() {
    this.state = null;
    this.explore = null;
    this.combat = null;
    this.topState = TopState.EXPLORE;
    this.battleEntry = null;   // {x,y,nodeId}
    this.pendingLevelUps = [];
  }

  newGame() {
    this.state = new GameState();
    // 初始背包：1 个帐篷
    this.state.inventory.add('tent', 1);
    recomputePermanent(this.state);
    this._wireSystems();
    this.explore._onNewDay(); // 启动时执行一次 on_new_day（第 1 天就刷新 content；主角格强制空地）
    this._setTop(TopState.EXPLORE);
    GameLog.system('explore', '新游戏开始。');
    return this.state;
  }

  loadFromSlot(slot) {
    const rec = readSave(slot);
    if (!rec) return false;
    this.state = GameState.deserialize(rec.snapshot);
    recomputePermanent(this.state);
    this._wireSystems();
    this._setTop(TopState.EXPLORE);
    return true;
  }

  _wireSystems() {
    this.explore = new ExploreSystem(this.state, {
      onBattle: (nodeId, kind, pos) => this._enterBattle(nodeId, kind, pos),
      onEvent: (eventId, pos) => this._enterEvent(eventId, pos),
    });
    this.combat = new CombatEngine(this.state);
  }

  _setTop(to) {
    const from = this.topState;
    this.topState = to;
    EventBus.emit(GE.STATE_CHANGE, { from, to });
  }

  // ---------------- 战斗进入 ----------------
  _enterBattle(nodeId, kind, pos) {
    // 内容段存档点：战斗前一帧（自动写 1 号槽之外的手动点？规则：进入内容段前一帧）
    this._checkpoint('battle');

    let id = nodeId;
    if (!id) {
      // 地块绑定节点或随机挑同类型
      const pool = ALL_NODE_IDS.filter((n) => BATTLE_NODES[n].kind === (kind === 'elite' ? 'elite' : 'battle'));
      id = rng.pick(pool);
    }
    this.battleEntry = { ...pos, nodeId: id };
    this._setTop(TopState.COMBAT);
    this.combat.startBattle(id);
  }

  _enterEvent(eventId, pos) {
    this._checkpoint('event');
    // 事件系统尚未接入剧情（按用户要求剧情暂不接入游戏）。
    // 目前事件格：先回落为空地，避免卡死；后续接入 EventSystem。
    GameLog.info('explore', '这里似乎发生过什么，但此刻一片平静。');
    this.explore.resolveCurrentContent();
  }

  /** 战斗结束由 UI 触发（看完结算弹窗后） */
  finishBattle() {
    const S = this.combat.S;
    const result = S.result;
    const node = S.node;
    const entry = this.battleEntry;

    if (result === BattleResult.VICTORY) this._grantVictory(node, S, entry);
    else if (result === BattleResult.DEFEAT) this._grantDefeat(node);
    else if (result === BattleResult.FLEE) GameLog.info('explore', '你成功逃离了战斗。');

    // 无论结果，地块 content 清空
    this.explore.resolveCurrentContent();
    this.battleEntry = null;
    this._setTop(TopState.EXPLORE);
  }

  _grantVictory(node, S, entry) {
    const rewards = (node.rewards || []).filter((r) => r.chance === undefined || rng.roll(r.chance));
    const loot = [];
    let xp = 0;
    for (const r of rewards) {
      if (r.xp) xp += r.xp;
      else if (r.item === 'randomTile') loot.push({ item: rng.pick(['tileGrass', 'tileWater', 'tileIce', 'tilePlain']), count: r.count });
      else if (r.item === 'randomTileWaterGrass') loot.push({ item: rng.pick(['tilePlain', 'tileWater', 'tileGrass']), count: r.count });
      else loot.push({ item: r.item, count: r.count });
    }
    // 古树特殊奖励
    if (node.specialReward === 'ancientTree') {
      const tree = S.units.find((u) => u.defId === 'ancientTree');
      if (tree?.meta?.fled) {
        const hp = tree.hp;
        const fruit = hp < 200 ? 4 : hp < 400 ? 3 : hp < 600 ? 2 : hp < 800 ? 1 : 0;
        if (fruit) loot.push({ item: 'fruit', count: fruit });
      } else {
        loot.push({ item: 'wood', count: 4 }, { item: 'tileForest', count: 1 });
        xp += 10;
      }
    }
    this.state.inventory.gainLoot(loot);
    if (xp) { this.state.party.gainXp(xp); this._drainLevelUps(); }
    GameLog.good('explore', `战斗胜利！${loot.map((g) => `${g.count}×${g.item}`).join('、')}${xp ? `，经验+${xp}` : ''}`);

    // 好奇心：30% 额外一次奖励，50% 额外 1 金币
    if (this.state.party.has('xiayang')) {
      if (rng.roll(0.30)) { this.state.inventory.gainLoot(loot.map((g) => ({ ...g }))); GameLog.good('explore', '好奇心：额外收获了一份奖励！'); }
      if (rng.roll(0.50)) this.state.inventory.addGold(1);
    }
    // 幸运硬币：每件 2% 额外一次奖励（整场战斗判 1 次，多件累加）
    const coin = (this.state.permAgg?.extraReward || 0);
    if (coin > 0 && rng.roll(coin) && loot.length) {
      this.state.inventory.gainLoot(loot.map((g) => ({ ...g })));
      GameLog.good('explore', '幸运硬币：额外获得一次奖励！');
    }
    // 中二病每次打败 +3 经验掉落（全局成长）
    if (node.waves?.some((w) => (w.enemies || []).includes('chuuniBoy'))) {
      const g = this.state.globalGrowth;
      g.chuuniDefeat = Math.min(5, (g.chuuniDefeat || 0) + 1);
    }
    // 二哈/草史莱姆按天成长在睡觉/新一天处理
  }

  _grantDefeat(node) {
    const pen = node.healthOnLose ?? -1;
    this.state.heroHp = 1; // 失败后 hp 重置为 1
    if (pen !== 0) this.explore.addHealth(pen, '战斗失败');
    GameLog.bad('explore', `战斗失败……健康 ${pen}，生命值恢复为 1。`);
  }

  _drainLevelUps() {
    this.pendingLevelUps.push(...this.state.party.drainLevelUps());
    EventBus.emit(GE.HERO_LEVELUP, { pending: this.pendingLevelUps.length });
  }
  takeNextLevelChoice(choice) {
    if (this.pendingLevelUps.length === 0) return null;
    const level = this.pendingLevelUps.shift();
    if (choice === 'gold') this.state.inventory.addGold(10);
    else this.state.party.applyLevelChoice(choice);
    return level;
  }

  // ---------------- 睡觉 / 新一天 ----------------
  sleep() {
    // 睡觉自动存档（1 号槽）在天数推进前
    const ok = this.explore.sleep();
    if (!ok) return false;
    recomputePermanent(this.state);
    // 二哈、草史莱姆召唤物按天成长
    const g = this.state.globalGrowth;
    g.houndDay = Math.min(20, (g.houndDay || 0) + 1);
    g.houndProDay = Math.min(20, (g.houndProDay || 0) + 1);
    g.grassSlimeSummon = (g.grassSlimeSummon || 0) + 1;
    this.autoSave();
    return true;
  }

  autoSave() {
    writeSave(0, this.state.serialize(), {
      kind: 'auto', label: '自动存档', day: this.state.day, location: '探索',
    });
  }
  manualSave(slot) {
    writeSave(slot, this.state.serialize(), {
      kind: 'manual', label: `手动存档·第${this.state.day}天`, day: this.state.day, location: '探索',
    });
  }
  _checkpoint(kind) {
    // 战斗/事件/剧情入口存档点（写入 0 号自动槽，读档从头开始该段）
    writeSave(0, this.state.serialize(), {
      kind: 'auto', label: `${kind === 'battle' ? '战斗' : '事件'}前`, day: this.state.day,
    });
  }
}
