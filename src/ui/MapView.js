// src/ui/MapView.js
// Phase 2B 扩展：
//   - 建造模式 UI 视觉反馈（placeable / unplaceable / player-tile 类由 CSS 处理）
//   - 建造模式下 tile 点击：若 HotBar 有选中内容 → BuildSystem.placeContent(gs, tileIdx, contentId)
//   - 建造模式切换通过订阅 GE.UI_MODE_CHANGE
//
// Phase 1 功能全部保留（玩家移动、TILE_UPDATED 增量重绘、TILE_CLICKED 事件等）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Distance } from '../core/Distance.js';
import { Assets } from '../core/Assets.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { createEl, qs } from './dom.js';

const TILE_SIZE = 80;
const MAP_SIZE = 3;
const MAP_PX = TILE_SIZE * MAP_SIZE;

export class MapView {
  constructor() {
    this.root = null;
    this.playerEl = null;
    this.tileEls = new Map();
    this.gs = null;
    this.buildMode = false;
  }

  mount(gs, parent = qs('#app')) {
    this.gs = gs;

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

    this.renderAllTiles(gs);
    this.renderFence(gs);
    this.renderPlayer(gs);

    // ── 拖拽放置支持（优先级3） ──
    this._bindDropEvents();

    this._subscribeEvents();
    return this.root;
  }

  /** 绑定拖拽事件到 map root（优先级3） */
  _bindDropEvents() {
    // dragover 必须阻止默认行为，否则 drop 不会触发
    this.root.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
    });

    this.root.addEventListener('dragenter', (e) => {
      e.preventDefault();
    });

    this.root.addEventListener('dragleave', (e) => {
      e.preventDefault();
    });

    // 核心：drop 处理
    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!e.dataTransfer) return;

      const contentId = e.dataTransfer.getData('text/plain');
      if (!contentId) return;

      // 天赋不可放置（优先级6 提前过滤，天赋前缀 talent_）
      if (contentId.startsWith('talent_')) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🚫 天赋不可放置到地图上', duration: 2000 });
        return;
      }

      // 计算 drop 位置对应的 tileIdx
      const rect = this.root.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
      const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);

      const gs = this.gs;
      if (!gs) return;

      const tileIdx = Distance.outerXYToIdx(gs.map.size, x, y);
      if (tileIdx === null || tileIdx === undefined) {
        // 不在外圈（可能在栅栏里）
        EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 只能放在外圈地块上', duration: 2000 });
        return;
      }

      // 检查背包数量
      const invEntry = gs.inventory?.items?.find(i => i.itemId === contentId);
      if (!invEntry || invEntry.qty < 1) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 背包里没有这个物品', duration: 2000 });
        return;
      }

      // 临时进入建造模式来放置（因为BuildSystem.placeContent要求buildMode=true）
      const wasBuildMode = gs.buildMode;
      if (!wasBuildMode) {
        gs.buildMode = true;
      }

      const result = BuildSystem.placeContent(gs, tileIdx, contentId);

      // 恢复之前的模式
      if (!wasBuildMode) {
        gs.buildMode = false;
      }

      if (result?.ok) {
        // 放置成功后刷新HotBar显示
        EventBus.emit(GE.INVENTORY_CHANGE);
      }
    });
  }

  renderAllTiles(gs) {
    if (!this.root) return;
    this.tileEls.forEach(el => el.remove());
    this.tileEls.clear();

    const tiles = gs.map.outerTiles;
    for (const tile of tiles) {
      this._renderOneTile(tile, gs);
    }
  }

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

    if (tile.terrain && tile.terrain !== 'none') {
      createEl('span', {
        class: ['tile-terrain'],
        style: {
          position: 'absolute', bottom: '2px', right: '4px',
          fontSize: '16px', opacity: '0.6',
        },
        text: Assets.getEmoji('terrains', tile.terrain),
        parent: tileEl,
      });
    }

    if (tile.contentId) {
      const contentEmoji = Assets.getEmoji('facilities', tile.contentId);
      createEl('span', {
        class: ['tile-content'],
        style: {
          position: 'relative', fontSize: '40px', lineHeight: '1',
          filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.3))',
        },
        text: contentEmoji,
        parent: tileEl,
      });
    } else {
      createEl('span', {
        class: ['tile-empty'],
        style: { fontSize: '32px', opacity: '0.3', lineHeight: '1' },
        text: Assets.terrains.none,
        parent: tileEl,
      });
    }

    // 玩家当前位置特殊标记
    if (gs.player.x === tile.idx) {
      tileEl.classList.add('player-tile');
    }

    // 受祝福地块：金色边框特效（边框不是背景色）
    const hasBlessed = (tile.states || []).some(
      s => s.type === 'blessed' && (s.remainingDays === undefined || s.remainingDays > 0),
    );
    if (hasBlessed) {
      tileEl.classList.add('blessed-tile');
    }

    // 建造模式下的视觉类
    this._updateBuildModeTileClass(tileEl, tile, gs);

    // 点击事件（优先级1：建造模式下InfoPanel不滑出）
    tileEl.addEventListener('click', () => {
      if (this.buildMode) {
        // 建造模式：只处理放置，不 emit TILE_CLICKED（InfoPanel 订阅的事件）
        this._handleBuildTileClick(tile.idx);
        return;
      }
      // 探索模式：正常 emit TILE_CLICKED，让 InfoPanel 滑出
      EventBus.emit(GE.TILE_CLICKED, { tileIdx: tile.idx });
    });

    this.tileEls.set(tile.idx, tileEl);
  }

  /** 根据建造模式 + tile 状态，给 tileEl 挂 placeable / unplaceable / player-tile 类 */
  _updateBuildModeTileClass(tileEl, tile, gs) {
    tileEl.classList.remove('placeable', 'unplaceable');
    if (!this.buildMode) return;

    if (gs.player.x === tile.idx) {
      // 玩家所在格：不允许放置
      tileEl.classList.add('unplaceable', 'player-tile');
      return;
    }

    const isUnreplaceable = tile.contentId === 'facility_home';
    if (isUnreplaceable) {
      tileEl.classList.add('unplaceable');
    } else {
      tileEl.classList.add('placeable');
    }
  }

  /** 建造模式下点击 tile → 调用 BuildSystem.placeContent */
  _handleBuildTileClick(tileIdx) {
    const gs = this.gs;
    if (!gs || !gs.buildMode) return;

    // 优先级5：先检查背包放置按钮的 pendingPlaceContentId（比HotBar选中优先）
    let contentId = gs.uiState?.pendingPlaceContentId;
    if (contentId) {
      // 用完清空
      gs.uiState.pendingPlaceContentId = null;
    } else {
      // 否则用 HotBar 选中的（HotBar 会把选中内容写到 gs.uiState.selectedBuildContentId）
      contentId = gs.uiState?.selectedBuildContentId;
    }

    if (!contentId) {
      EventBus.emit(GE.TOAST_SHOW, {
        text: '🛠️ 先在底部快捷栏选中要放置的设施，或打开背包点“放置”',
        duration: 2000,
      });
      return;
    }
    BuildSystem.placeContent(gs, tileIdx, contentId);
  }

  _tileBgColor(tile) {
    switch (tile.terrain) {
      case 'grass': return '#a8e6a1';
      case 'water': return '#87ceeb';
      case 'mud':   return '#c9a875';
      case 'none':
      default:      return '#f5f0e1';
    }
  }

  renderFence(gs) {
    if (!this.root) return;
    const fenceRowCols = gs.map.fenceRowCols;
    const fenceTileSize = TILE_SIZE;
    const fencePx = fenceTileSize * fenceRowCols;
    const fenceOffset = (MAP_PX - fencePx) / 2;

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

  renderPlayer(gs) {
    if (!this.root) return;
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

  _subscribeEvents() {
    // STATE_RESET
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.gs = gs;
      this.renderAllTiles(gs);
      this.renderPlayer(gs);
    });

    // MOVE
    EventBus.on(GE.MOVE, ({ toIdx }) => {
      if (!this.gs) return;
      this.renderPlayer(this.gs);
      // 移动后玩家格 class 可能变，刷新所有 tile
      this.renderAllTiles(this.gs);
    });

    // TILE_UPDATED
    EventBus.on(GE.TILE_UPDATED, (payload = {}) => {
      const { tileIdx } = payload;
      if (!this.gs) return;
      if (tileIdx !== undefined && tileIdx !== null) {
        const tile = this.gs.map.outerTiles[tileIdx];
        if (tile) {
          const oldEl = this.tileEls.get(tileIdx);
          if (oldEl) oldEl.remove();
          this.tileEls.delete(tileIdx);
          this._renderOneTile(tile, this.gs);
        }
      } else {
        this.renderAllTiles(this.gs);
      }
    });

    // 建造模式切换
    EventBus.on(GE.UI_MODE_CHANGE, ({ mode }) => {
      this.buildMode = mode === 'build';
      // 重新给所有 tile 挂 placeable / unplaceable 类
      this.tileEls.forEach((tileEl, idx) => {
        const tile = this.gs?.map?.outerTiles?.[idx];
        if (tile) this._updateBuildModeTileClass(tileEl, tile, this.gs);
      });
    });
  }
}

export default MapView;
