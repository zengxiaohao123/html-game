// src/ui/TileHighlight.js
// 技能卡所在地块高亮（v0.5 §16.3 / §12.5）
//
// 三条规则（纯视觉，不改任何玩法数值、不拦截点击）：
//   1. 主动技能在其所在地块结算 → 该地块红色瞬时高亮 TILE_FLASH_MS 后自动恢复；
//   2. 连携技放置实例处于队列第一位 → 该地块金色持续高亮（跟随队首变化）；
//   3. 连携技被使用 → 该地块金色瞬时高亮 TILE_FLASH_MS 后自动恢复。
//
// 数据来源全部是 EventBus 事件 + 队列首位状态：
//   - GE.SKILL_USED_ON_TILE（SkillSystem 结算主动技能时 emit，带 tileIdx）
//   - GE.LINK_SKILL_READY / GE.LINK_SKILL_EXPIRE（队列变化；EXPIRE 且 triggered=true 表示"被使用"）
//   - GE.TILE_UPDATED / GE.MOVE / GE.BOOT / GE.STATE_RESET（地块节点重建后重新挂类）
// 队列首位由 gs.linkSkillQueue[0] 直接推导，拆卡 / 超时 / 前移都能立即反映。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { qs } from './dom.js';

/** 瞬时高亮时长（毫秒）—— 用户裁定 1 秒；集中在此，便于日后调整 */
export const TILE_FLASH_MS = 1000;

/** 队首跟随的轮询间隔（队列变化另有事件即时刷新） */
const HEAD_TICK_MS = 200;

/** 实例键 `${tileIdx}|${skillId}` → tileIdx */
function tileIdxFromKey(key) {
  const s = String(key ?? '');
  const i = s.indexOf('|');
  if (i <= 0) return null;
  const idx = Number(s.slice(0, i));
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}

/**
 * 队列首位对应的地块下标；无法定位（已过期 / 已拆卡 / 内容已替换）→ null
 * 纯函数，便于在 Node 冒烟脚本里直接断言。
 * @param {object} gs
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function linkSkillHeadTileIdx(gs, nowMs = Date.now()) {
  const head = gs?.linkSkillQueue?.[0];
  if (!head || !Number.isInteger(head.tileIdx)) return null;
  // 已过期但尚未被 prune 的队首不算「可触发」，不亮
  if (head.expireAtMs && head.expireAtMs <= nowMs) return null;
  // 拆卡 / 替换后 contentId 不再等于该实例技能 → 立即不亮
  const tile = gs?.map?.outerTiles?.[head.tileIdx];
  if (!tile || tile.contentId !== head.skillId) return null;
  return head.tileIdx;
}

export class TileHighlight {
  /**
   * @param {object} director GameDirector（取 gs 用）
   * @param {object} [opts]
   * @param {(tileIdx:number)=>HTMLElement|null} [opts.getTileEl] 地块节点提供器（测试可注入）
   */
  constructor(director, opts = {}) {
    this.director = director;
    this.getTileEl = opts.getTileEl
      || ((idx) => qs(`.map-tile[data-idx="${idx}"]`));
    this.headIdx = null;
    this.flashes = new Map(); // tileIdx → { kind: 'red'|'gold', timer }
    this._tick = null;
  }

  mount() {
    this._subscribe();
    this._tick = setInterval(() => this.syncHead(), HEAD_TICK_MS);
    if (this._tick && typeof this._tick.unref === 'function') this._tick.unref();
    this.syncHead();
  }

  _subscribe() {
    // 主动技能结算 → 红色瞬时高亮
    EventBus.on(GE.SKILL_USED_ON_TILE, ({ tileIdx, skillId } = {}) => {
      if (!Number.isInteger(tileIdx)) return;
      this._flash(tileIdx, 'red');
    });

    // 队列变化 → 队首金色持续高亮立即跟随；被使用 → 金色瞬时高亮
    EventBus.on(GE.LINK_SKILL_READY, () => this.syncHead());
    EventBus.on(GE.LINK_SKILL_EXPIRE, ({ key, triggered } = {}) => {
      if (triggered) {
        const idx = tileIdxFromKey(key);
        if (idx !== null) this._flash(idx, 'gold');
      }
      this.syncHead();
    });

    // 地块节点会被 MapView 在移动 / 局部更新时重建，重建后重新挂类
    EventBus.on(GE.MOVE, () => this._renderAll());
    EventBus.on(GE.TILE_UPDATED, () => { this.syncHead(); this._renderAll(); });
    // 农场扩建：缓存的队首 idx / 瞬时高亮键都按旧索引保存，必须随 remap 位移
    EventBus.on(GE.MAP_EXPANDED, ({ remap } = {}) => {
      const idxMap = remap?.outerIdx;
      if (!idxMap || typeof idxMap.get !== 'function') return;
      if (Number.isInteger(this.headIdx) && idxMap.has(this.headIdx)) {
        this.headIdx = idxMap.get(this.headIdx);
      }
      const nextFlashes = new Map();
      for (const [idx, v] of this.flashes) {
        nextFlashes.set(idxMap.has(idx) ? idxMap.get(idx) : idx, v);
      }
      this.flashes = nextFlashes;
      this.syncHead();
      this._renderAll();
    });
    EventBus.on(GE.BOOT, () => { this._reset(); this.syncHead(); });
    EventBus.on(GE.STATE_RESET, () => { this._reset(); this.syncHead(); });
  }

  /** 读取队列首位并与当前金色状态对齐 */
  syncHead() {
    const gs = this._getGS();
    const next = gs ? linkSkillHeadTileIdx(gs, Date.now()) : null;
    if (next === this.headIdx) return;
    const prev = this.headIdx;
    this.headIdx = next;
    if (prev !== null) this._render(prev);
    if (next !== null) this._render(next);
  }

  _flash(tileIdx, kind) {
    const prev = this.flashes.get(tileIdx);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      this.flashes.delete(tileIdx);
      this._render(tileIdx);
    }, TILE_FLASH_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    this.flashes.set(tileIdx, { kind, timer });
    this._render(tileIdx);
  }

  _reset() {
    for (const { timer } of this.flashes.values()) clearTimeout(timer);
    this.flashes.clear();
    const prev = this.headIdx;
    this.headIdx = null;
    if (prev !== null) this._render(prev);
  }

  _renderAll() {
    if (this.headIdx !== null) this._render(this.headIdx);
    for (const idx of this.flashes.keys()) this._render(idx);
  }

  /** 把该地块的高亮类与当前状态对齐（只动类名，不改其它样式） */
  _render(tileIdx) {
    const el = this.getTileEl(tileIdx);
    if (!el) return;
    const flash = this.flashes.get(tileIdx);
    el.classList.toggle('tile-hl-gold', this.headIdx === tileIdx);
    el.classList.toggle('tile-hl-red', !!flash && flash.kind === 'red');
    el.classList.toggle('tile-hl-gold-flash', !!flash && flash.kind === 'gold');
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (typeof window !== 'undefined' && window.__gameDirector?.getGS) {
      return window.__gameDirector.getGS();
    }
    return null;
  }
}

export default TileHighlight;
