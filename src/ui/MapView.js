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
import { normalizeTerrain } from '../data/terrains.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { ItemTargeting } from '../systems/ItemTargeting.js';
import { SKILLS } from '../data/characters.js';
import { getCreatureDef } from '../data/creatures.js';
import { createEl, qs, iconEl } from './dom.js';

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
    // §16.3 视角缩放/拖拽平移（纯视觉，不影响数值；点击命中仍走 tile 自身事件）
    this._scale = 1;
    this._panX = 0;
    this._panY = 0;
    this._drag = null;
    this._dragMoved = false;
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
        transformOrigin: 'center center',
        willChange: 'transform',
      },
      parent,
    });

    this.renderAllTiles(gs);
    this.renderFence(gs);
    this.renderPlayer(gs);

    this._bindDropEvents();
    this._bindViewControls();
    this._subscribeEvents();
    return this.root;
  }

  /** §16.3 滚轮缩放（0.5~2.5，以中心缩放）+ 鼠标按住拖拽平移；只改视觉 transform */
  _bindViewControls() {
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 2.5;

    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.1 : 0.1;
      this._scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this._scale + step));
      this._applyViewTransform();
    }, { passive: false });

    this.root.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // 第 9 批 §16.15：背包拖拽放置期间（window.__invDrag）不得触发地图拖拽平移
      if (window.__invDrag) return;
      this._drag = { startX: e.clientX, startY: e.clientY, panX: this._panX, panY: this._panY };
      this._dragMoved = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.startX;
      const dy = e.clientY - this._drag.startY;
      if (!this._dragMoved && Math.hypot(dx, dy) < 4) return;
      this._dragMoved = true;
      this._panX = this._drag.panX + dx;
      this._panY = this._drag.panY + dy;
      this._applyViewTransform();
    });
    window.addEventListener('mouseup', () => {
      if (!this._drag) return;
      const moved = this._dragMoved;
      this._drag = null;
      // click 在 mouseup 之后派发；延迟复位保证拖拽后的 click 被抑制
      if (moved) setTimeout(() => { this._dragMoved = false; }, 0);
    });

    // 拖拽平移结束后抑制误触发的 tile 点击（capture 阶段，先于 tile 自身 click 监听）
    this.root.addEventListener('click', (e) => {
      if (this._dragMoved) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  _applyViewTransform() {
    if (!this.root) return;
    this.root.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._scale})`;
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

    if (tile.terrain && normalizeTerrain(tile.terrain) !== 'terrain_none') {
      tileEl.appendChild(iconEl('terrains', normalizeTerrain(tile.terrain), {
        size: '16px',
        fallback: Assets.getEmoji('terrains', tile.terrain),
        cls: 'tile-terrain',
        style: { position: 'absolute', bottom: '2px', right: '4px', opacity: '0.6' },
      }));
    }

    if (tile.contentId) {
      // 按 contentId 前缀选 group（facility_ → facilities, resource_ → resources, skill_ → characters.SKILLS）
      let group = 'facilities';
      let def = null;
      let fallback = null;
      if (tile.contentId.startsWith('resource_')) {
        group = 'resources';
        fallback = Assets.getEmoji('resources', tile.contentId);
      } else if (tile.contentId.startsWith('skill_')) {
        group = 'items';
        def = SKILLS?.[tile.contentId] || null;
        fallback = def?.emoji || null;
      }
      if (!fallback) {
        fallback = Assets.getEmoji('facilities', tile.contentId);
      }
      tileEl.appendChild(iconEl(group, tile.contentId, {
        def,
        fallback,
        size: '40px',
        cls: 'tile-content',
        style: {
          position: 'relative',
          filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.3))',
        },
      }));
    } else {
      tileEl.appendChild(iconEl('terrains', 'terrain_none', {
        size: '32px',
        fallback: Assets.terrains.none,
        cls: 'tile-empty',
        style: { opacity: '0.3' },
      }));
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

    // 点击事件（建造模式不 emit TILE_CLICKED，InfoPanel 不滑出）
    tileEl.addEventListener('click', () => {
      // 指向模式（使用需要指定地块的道具）优先于其它点击行为
      if (ItemTargeting.isActive()) {
        ItemTargeting.handleTileClick(this.gs, tile.idx);
        return;
      }
      if (this.buildMode) {
        this._handleBuildTileClick(tile.idx);
        return;
      }
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
    if (!gs) return;

    // 先查 InventoryPanel 放置按钮的 pendingPlaceContentId
    let contentId = gs.uiState?.pendingPlaceContentId;
    if (contentId) {
      gs.uiState.pendingPlaceContentId = null;
    } else {
      // 再查 HotBar 选中的
      contentId = gs.uiState?.selectedBuildContentId;
    }
    if (!contentId) {
      EventBus.emit(GE.TOAST_SHOW, {
        text: '🛠️ 先在 HotBar 选中或背包点“放置”',
        duration: 2000,
      });
      return;
    }
    BuildSystem.placeContent(gs, tileIdx, contentId);
  }

  /** 拖拽放置（探索/建造模式都有效） */
  _bindDropEvents() {
    this.root.addEventListener('dragover', (e) => { e.preventDefault(); });
    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      // drop 必然结束拖拽：兜底复位全局拖拽标记。
      // 若拖拽源节点在 drop 后被重建导致 dragend 不触发，标记残留会永久抑制地图平移（卡住）。
      window.__invDrag = false;
      if (!e.dataTransfer) return;
      const contentId = e.dataTransfer.getData('text/plain');
      if (!contentId) return;
      if (contentId.startsWith('talent_')) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🚫 天赋不可放置到地图上', duration: 2000 });
        return;
      }
      const gs = this.gs;
      if (!gs) return;
      const rect = this.root.getBoundingClientRect();
      // §16.3 缩放下 getBoundingClientRect 已被 scale 放大，需除回 _scale 换算回格子坐标
      const x = Math.floor((e.clientX - rect.left) / (TILE_SIZE * this._scale));
      const y = Math.floor((e.clientY - rect.top) / (TILE_SIZE * this._scale));
      const tileIdx = Distance.outerXYToIdx(gs.map.size, x, y);
      if (tileIdx === null || tileIdx === undefined) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 只能放在外圈地块上', duration: 2000 });
        return;
      }
      BuildSystem.placeContent(gs, tileIdx, contentId);
    });
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

    // terrain → emoji 映射
    const TERRAIN_EMOJI = {
      terrain_none: null,
      terrain_grass: '🌱',
      terrain_water: '💧',
      terrain_ice: '🧊',
      none: null,
      grass: '🌱',
      flower: '🌸',
      wood: '🪵',
      stone: '🪨',
      water: '💧',
      sand: '🏖️',
      wheat: '🌾',
    };

    for (let r = 0; r < fenceRowCols; r++) {
      for (let c = 0; c < fenceRowCols; c++) {
        const fenceIdx = r * fenceRowCols + c;
        const cell = gs.map.fence[fenceIdx];
        const tileEl = createEl('div', {
          class: ['fence-tile'],
          'data-fence-row': r,
          'data-fence-col': c,
          'data-fence-idx': fenceIdx,
          style: {
            position: 'absolute',
            left: `${c * fenceTileSize}px`,
            top: `${r * fenceTileSize}px`,
            width: `${fenceTileSize}px`,
            height: `${fenceTileSize}px`,
            boxSizing: 'border-box',
            border: '1px dashed rgba(100,100,100,0.25)',
            cursor: 'pointer',
          },
          parent: fenceEl,
        });

        // terrain 图标（如果有）
        if (cell?.terrain && normalizeTerrain(cell.terrain) !== 'terrain_none') {
          const emoji = TERRAIN_EMOJI[cell.terrain];
          if (emoji) {
            tileEl.appendChild(iconEl('terrains', normalizeTerrain(cell.terrain), {
              size: '26px',
              fallback: emoji,
              style: {
                position: 'absolute', left: '50%', top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              },
            }));
          }
        }

        // creatures（如果有）—— 每只生物一个图标
        if (cell?.creatures && cell.creatures.length > 0) {
          const wrap = createEl('div', {
            style: {
              position: 'absolute', left: '50%', bottom: '2px',
              transform: 'translateX(-50%)',
              display: 'flex', gap: '1px',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            },
            parent: tileEl,
          });
          for (const creatureId of cell.creatures) {
            const c = gs.creatures?.find(x => x.id === creatureId);
            if (!c) continue;
            const def = getCreatureDef?.(c.kind);
            wrap.appendChild(iconEl('creatures', c.kind, {
              def,
              size: '14px',
              fallback: def?.emoji || '🐾',
            }));
          }
        }

        // 点击 → emit FENCE_TILE_CLICKED → InfoPanel 显示
        tileEl.addEventListener('click', (e) => {
          e.stopPropagation();
          EventBus.emit(GE.FENCE_TILE_CLICKED, { row: r, col: c, fenceIdx });
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

    this.playerEl = iconEl('ui', 'player', {
      size: '42px',
      fallback: Assets.ui.player,
      cls: 'player-avatar',
      style: {
        position: 'absolute',
        left: `${centerX}px`,
        top: `${centerY}px`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 3px 2px rgba(0,0,0,0.4))',
        transition: 'left 0.2s ease-out, top 0.2s ease-out',
        zIndex: '10',
      },
    });
    this.root.appendChild(this.playerEl);
  }

  /** 指向模式的浮动提示条 */
  _showAimHint(on) {
    if (!on) {
      if (this._aimHintEl) { this._aimHintEl.remove(); this._aimHintEl = null; }
      return;
    }
    if (this._aimHintEl) return;
    this._aimHintEl = createEl('div', {
      class: ['aim-hint'],
      text: '🎯 点击高亮地块使用道具 · ESC 取消',
      style: {
        position: 'absolute', left: '50%', top: '-38px', transform: 'translateX(-50%)',
        padding: '6px 16px', borderRadius: '999px',
        background: 'linear-gradient(135deg,#fff6c0,#f7d674)',
        border: '2px solid #c07a20', color: '#6b4410',
        fontSize: '13px', fontWeight: '800', whiteSpace: 'nowrap',
        boxShadow: '0 3px 10px rgba(0,0,0,0.25)', zIndex: '50',
        pointerEvents: 'none',
      },
      parent: this.root,
    });
  }

  /** 指向模式下 ESC 只取消指向，不打开设置面板 */
  _bindAimEsc() {
    if (this._aimEsc) return;
    this._aimEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (!ItemTargeting.isActive()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      ItemTargeting.cancel('esc');
    };
    window.addEventListener('keydown', this._aimEsc, true);
  }

  _unbindAimEsc() {
    if (!this._aimEsc) return;
    window.removeEventListener('keydown', this._aimEsc, true);
    this._aimEsc = null;
  }

  _subscribeEvents() {
    // BOOT（新游戏启动 / startNewGame）
    EventBus.on(GE.BOOT, ({ gs }) => {
      if (!gs) return;
      this.gs = gs;
      this.renderAllTiles(gs);
      this.renderPlayer(gs);
    });

    // STATE_RESET（兼容其他来源）
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      if (!gs) return;
      this.gs = gs;
      this.renderAllTiles(gs);
      this.renderPlayer(gs);
    });

    // 道具指向模式：高亮合法地块、其余变暗
    EventBus.on(GE.TARGETING_START, ({ valid }) => {
      const ok = new Set(valid || []);
      this.tileEls.forEach((el, idx) => {
        el.classList.toggle('tile-aim-ok', ok.has(idx));
        el.classList.toggle('tile-aim-dim', !ok.has(idx));
      });
      this._showAimHint(true);
      this._bindAimEsc();
    });
    EventBus.on(GE.TARGETING_END, () => {
      this.tileEls.forEach((el) => {
        el.classList.remove('tile-aim-ok', 'tile-aim-dim');
      });
      this._showAimHint(false);
      this._unbindAimEsc();
    });

    // MOVE
    EventBus.on(GE.MOVE, ({ toIdx }) => {
      if (!this.gs) return;
      this.renderPlayer(this.gs);
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
