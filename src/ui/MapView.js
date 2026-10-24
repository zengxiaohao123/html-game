// src/ui/MapView.js
// 地图渲染：3×3 外圈 8 格回字形 + 中心 1×1 栅栏
// 玩家 🧑 绝对定位在当前格中心
// 布局严格参考 docs/ui-main.png（Q 版卡通风格：圆润、糖果色、粗描边）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Distance } from '../core/Distance.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

/** 每格尺寸（px）—— 可在 CSS 里覆盖 */
const TILE_SIZE = 80;
/** 地图格子数量（初始 3×3） */
const MAP_SIZE = 3;
/** 整个地图容器宽高 */
const MAP_PX = TILE_SIZE * MAP_SIZE;

/**
 * MapView 类：负责地图区 DOM 构建和渲染
 */
export class MapView {
  constructor() {
    /** 已挂载的地图根 DOM 节点 */
    this.root = null;
    /** 已挂载的玩家 DOM 节点 */
    this.playerEl = null;
    /** 缓存的 tile DOM 映射：idx → HTMLElement */
    this.tileEls = new Map();
    /** 当前 GS 引用（最近一次渲染用的） */
    this.gs = null;
  }

  /**
   * 构建地图 DOM 并挂载到 #app
   * @param {object} gs 初始 GS
   * @param {HTMLElement} parent 父容器（默认 #app）
   */
  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    // 1. 地图容器
    this.root = createEl('div', {
      class: ['map-container'],
      style: {
        width: `${MAP_PX}px`,
        height: `${MAP_PX}px`,
        position: 'relative',
        margin: '0 auto',
        flexShrink: '0',
      },
      parent,
    });

    // 2. 渲染所有外圈 tile
    this.renderAllTiles(gs);

    // 3. 渲染中心栅栏
    this.renderFence(gs);

    // 4. 渲染玩家
    this.renderPlayer(gs);

    // 5. 订阅事件：STATE_RESET 全量重绘；MOVE / TILE_UPDATED 增量更新
    this._subscribeEvents();

    return this.root;
  }

  /**
   * 渲染所有外圈 tile（回字形）
   * @param {object} gs
   */
  renderAllTiles(gs) {
    if (!this.root) return;

    // 先清空旧的 tile（栅栏和玩家不移除）
    this.tileEls.forEach(el => el.remove());
    this.tileEls.clear();

    const tiles = gs.map.outerTiles;
    for (const tile of tiles) {
      this._renderOneTile(tile, gs);
    }
  }

  /**
   * 渲染单个 tile（外圈格）
   * @param {object} tile tile 定义：{ idx, terrain, contentId, ... }
   * @param {object} gs
   */
  _renderOneTile(tile, gs) {
    const { x, y } = Distance.outerIdxToXY(gs.map.size, tile.idx);

    const tileEl = createEl('div', {
      class: ['map-tile', `tile-idx-${tile.idx}`],
      attrs: { 'data-idx': tile.idx },
      style: {
        position: 'absolute',
        left: `${x * TILE_SIZE}px`,
        top: `${y * TILE_SIZE}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
        boxSizing: 'border-box',
        border: '3px solid #3a3a3a',
        borderRadius: '10px',
        backgroundColor: this._tileBgColor(tile),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '36px',
        cursor: 'pointer',
        transition: 'all 0.15s ease-out',
        userSelect: 'none',
      },
      parent: this.root,
    });

    // 地形 emoji（小尺寸，内容 emoji 覆盖其上）
    if (tile.terrain && tile.terrain !== 'none') {
      createEl('span', {
        class: ['tile-terrain'],
        style: {
          position: 'absolute',
          bottom: '2px',
          right: '4px',
          fontSize: '16px',
          opacity: '0.6',
        },
        text: Assets.getEmoji('terrains', tile.terrain),
        parent: tileEl,
      });
    }

    // 内容 emoji（设施/资源）
    if (tile.contentId) {
      const contentEmoji = Assets.getEmoji('facilities', tile.contentId);
      createEl('span', {
        class: ['tile-content'],
        style: {
          position: 'relative',
          fontSize: '40px',
          lineHeight: '1',
          filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.3))',
        },
        text: contentEmoji,
        parent: tileEl,
      });
    } else {
      // 空 tile 显示虚空 emoji
      createEl('span', {
        class: ['tile-empty'],
        style: { fontSize: '32px', opacity: '0.3', lineHeight: '1' },
        text: Assets.terrains.none,
        parent: tileEl,
      });
    }

    // 点击事件：emit TILE_CLICKED
    tileEl.addEventListener('click', () => {
      EventBus.emit(GE.TILE_CLICKED, { tileIdx: tile.idx });
    });

    this.tileEls.set(tile.idx, tileEl);
  }

  /**
   * tile 背景色：根据 terrain 返回糖果色（Q 版风格）
   */
  _tileBgColor(tile) {
    switch (tile.terrain) {
      case 'grass': return '#a8e6a1';     // 草地 糖果绿
      case 'water': return '#87ceeb';     // 水 天空蓝
      case 'mud':   return '#c9a875';    // 泥 棕色
      case 'none':
      default:      return '#f5f0e1';    // 虚空 米白
    }
  }

  /**
   * 渲染中心栅栏
   */
  renderFence(gs) {
    if (!this.root) return;

    const fenceRowCols = gs.map.fenceRowCols;
    const fenceTileSize = TILE_SIZE; // 栅栏内格子尺寸和外圈一致
    const fencePx = fenceTileSize * fenceRowCols;
    const fenceOffset = (MAP_PX - fencePx) / 2; // 居中偏移

    // 栅栏容器
    const fenceEl = createEl('div', {
      class: ['map-fence'],
      id: 'fence-container',
      style: {
        position: 'absolute',
        left: `${fenceOffset}px`,
        top: `${fenceOffset}px`,
        width: `${fencePx}px`,
        height: `${fencePx}px`,
        border: '4px dashed #5a5a5a',
        borderRadius: '8px',
        backgroundColor: 'rgba(220, 220, 220, 0.4)',
      },
      parent: this.root,
    });

    // 栅栏内的小格子（Phase 1 暂时空着，Phase 3 放生物）
    for (let r = 0; r < fenceRowCols; r++) {
      for (let c = 0; c < fenceRowCols; c++) {
        createEl('div', {
          class: ['fence-tile'],
          style: {
            position: 'absolute',
            left: `${c * fenceTileSize}px`,
            top: `${r * fenceTileSize}px`,
            width: `${fenceTileSize}px`,
            height: `${fenceTileSize}px`,
            boxSizing: 'border-box',
          },
          parent: fenceEl,
        });
      }
    }
  }

  /**
   * 渲染玩家 🧑 （绝对定位，跟随 player.x 移动）
   */
  renderPlayer(gs) {
    if (!this.root) return;

    // 旧的玩家节点移除
    if (this.playerEl) this.playerEl.remove();

    const { x, y } = Distance.outerIdxToXY(gs.map.size, gs.player.x);
    const centerX = x * TILE_SIZE + TILE_SIZE / 2;
    const centerY = y * TILE_SIZE + TILE_SIZE / 2;

    this.playerEl = createEl('div', {
      class: ['player-avatar'],
      style: {
        position: 'absolute',
        left: `${centerX}px`,
        top: `${centerY}px`,
        transform: 'translate(-50%, -50%)',
        fontSize: '42px',
        lineHeight: '1',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 3px 2px rgba(0,0,0,0.4))',
        transition: 'left 0.2s ease-out, top 0.2s ease-out',
        zIndex: 10,
      },
      text: Assets.ui.player,
      parent: this.root,
    });
  }

  // ── 事件订阅 ──

  _subscribeEvents() {
    // STATE_RESET：全量重绘（Storage.load 后触发）
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.gs = gs;
      this.renderAllTiles(gs);
      this.renderPlayer(gs);
    });

    // MOVE：玩家位置移动
    EventBus.on(GE.MOVE, ({ toIdx }) => {
      if (!this.gs) return;
      this.renderPlayer(this.gs);
    });

    // TILE_UPDATED：某个 tile 内容变化
    EventBus.on(GE.TILE_UPDATED, ({ tileIdx }) => {
      if (!this.gs) return;
      if (tileIdx !== undefined && tileIdx !== null) {
        const tile = this.gs.map.outerTiles[tileIdx];
        if (tile) {
          // 只重绘这个 tile：先移除再重新渲染
          const oldEl = this.tileEls.get(tileIdx);
          if (oldEl) oldEl.remove();
          this.tileEls.delete(tileIdx);
          this._renderOneTile(tile, this.gs);
        }
      } else {
        // 没有指定 tileIdx：刷新所有 tile
        this.renderAllTiles(this.gs);
      }
    });
  }
}

export default MapView;
