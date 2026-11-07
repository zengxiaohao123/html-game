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
import { POTIONS } from '../data/potions.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { ItemTargeting } from '../systems/ItemTargeting.js';
import { SKILLS } from '../data/characters.js';
import { CreatureView } from './CreatureView.js';
import * as Geometry from '../core/Geometry.js';
import { createEl, qs, iconEl } from './dom.js';

// 地图区留白（像素）：外圈边长可扩展时，由可用区域反算每格像素，避免扩图后错位/挤压。
// 3×3 在常规窗口下反算结果仍是上限 80px，与改造前完全一致。
const MAP_H_MARGIN = 32;
const MAP_V_MARGIN = 110;
const BASE_TILE_PX = 80; // 图标随格缩放的基准（仅影响大图缩放时的内容尺寸）

// §16.3 单格地块视觉层级：
//   地形 = 背景层（边长 97.5% → 面积约 95%，四周留少量空隙）
//   放置型道具 = 标志层（单个占 6%~20%，数量少偏大、数量多偏小，右下角起沿底边向左排）
const TERRAIN_FILL_SIDE = 0.975;
const FLAG_MAX_RATIO = 0.20;
const FLAG_MIN_RATIO = 0.06;

export class MapView {
  constructor() {
    this.root = null;
    this.playerEl = null;
    this.fenceEl = null;
    this.tileEls = new Map();
    this.fenceTileEls = new Map();  // fenceIdx → 栅栏格 DOM（地形背景层就地刷新用）
    this.gs = null;
    this.buildMode = false;
    this.tileSize = BASE_TILE_PX;
    // 生物层：按 renderPos 逐帧绘制，节点缓存、只更新 transform（不每帧重建 DOM）
    this.creatureLayer = null;
    this.creatureView = null;       // 纯色圆形表现层（节点缓存）
    this._creatureRafId = null;
    this._rafSyncProbe = false;
    // §16.3 视角缩放/拖拽平移（纯视觉，不影响数值；点击命中仍走 tile 自身事件）
    this._scale = 1;
    this._panX = 0;
    this._panY = 0;
    this._drag = null;
    this._dragMoved = false;
  }

  get _tileRatio() {
    return this.tileSize / BASE_TILE_PX;
  }

  mount(gs, parent = qs('#app')) {
    this.gs = gs;
    this.tileSize = this._computeTileSize(gs, parent);
    const dims = Geometry.mapDims(gs);
    const mapW = dims.cols * this.tileSize;
    const mapH = dims.rows * this.tileSize;

    this.root = createEl('div', {
      class: ['map-container'],
      style: {
        width: `${mapW}px`,
        height: `${mapH}px`,
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
    this._ensureCreatureLayer(gs);
    this._startCreatureLoop();

    this._bindDropEvents();
    this._bindViewControls();
    this._subscribeEvents();
    return this.root;
  }

  /** 从可用区域反算每格像素（外圈边长 size 变化 → 自动重算，栅栏偏移随尺寸联动） */
  _computeTileSize(gs, parent) {
    const parentW = parent && typeof parent.clientWidth === 'number' && parent.clientWidth > 0
      ? parent.clientWidth : 0;
    const parentH = parent && typeof parent.clientHeight === 'number' && parent.clientHeight > 0
      ? parent.clientHeight : 0;
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
    const availW = (parentW || vw || 960) - MAP_H_MARGIN * 2;
    const availH = (parentH || vh || 640) - MAP_V_MARGIN * 2;
    const dims = Geometry.mapDims(gs);
    return Geometry.computeTilePx({ availW, availH, rows: dims.rows, cols: dims.cols });
  }

  /** 地图尺寸变化（新游戏/读档）时重算像素并重绘整张图 */
  _relayout(gs) {
    if (!this.root) return;
    this.tileSize = this._computeTileSize(gs, this.root.parentNode);
    const dims = Geometry.mapDims(gs);
    this.root.style.width = `${dims.cols * this.tileSize}px`;
    this.root.style.height = `${dims.rows * this.tileSize}px`;
    this.renderAllTiles(gs);
    this.renderFence(gs);
    this.renderPlayer(gs);
    this._ensureCreatureLayer(gs);
  }

  /** 逻辑矩形 → 像素矩形（UI 层唯一的坐标换算出口，反向换算只在 drop 命中处） */
  _pxRect(rect) {
    const ts = this.tileSize;
    return {
      left: rect.x0 * ts,
      top: rect.y0 * ts,
      width: (rect.x1 - rect.x0) * ts,
      height: (rect.y1 - rect.y0) * ts,
    };
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
    // 几何层给出逻辑 AABB；UI 只做逻辑坐标 → 像素换算（外圈边长可扩展，不再写死 3×3/80px）
    const rect = Geometry.tileRect(gs, Geometry.outerTileRef(tile.idx));
    const box = this._pxRect(rect);
    const ratio = this._tileRatio;

    const tileEl = createEl('div', {
      class: ['map-tile', `tile-idx-${tile.idx}`],
      attrs: { 'data-idx': tile.idx },
      style: {
        position: 'absolute',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        boxSizing: 'border-box',
        border: '3px solid #3a3a3a',
        borderRadius: '10px',
        backgroundColor: '#f5f0e1',   // 层级 1：几何底色；地形在其上单独铺背景层
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${Math.round(36 * ratio)}px`,
        cursor: 'pointer',
        transition: 'all 0.15s ease-out',
        userSelect: 'none',
      },
      parent: this.root,
    });

    // 层级 2：地形背景层（约 95% 面积，铺满格子内部；不得占用右下角标志位）
    tileEl.appendChild(this._terrainLayer(normalizeTerrain(tile.terrain), ratio));

    // 层级 3/5：内容图标 + 放置型道具标志（内容相关子节点，可单独局部刷新）
    this._renderCellContent(tileEl, tile, box, ratio);

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
      // §16.3 缩放下 getBoundingClientRect 已被 scale 放大，需除回 _scale 换算回格子坐标；
      // 每格像素来自本次布局反算（不再固定 80px）
      const tilePx = this.tileSize * this._scale;
      const x = Math.floor((e.clientX - rect.left) / tilePx);
      const y = Math.floor((e.clientY - rect.top) / tilePx);
      const tileIdx = Distance.outerXYToIdx(gs.map, x, y);
      if (tileIdx === null || tileIdx === undefined) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 只能放在外圈地块上', duration: 2000 });
        return;
      }
      // 放置型消耗道具（陷阱 / 艾草熏香等）：拖拽与「背包点选 → 点地块」共用
      // ItemTargeting 的合法性判定、失败提示与结算，规则完全一致；拖拽不消耗道具。
      if (ItemTargeting.needsTarget(contentId)) {
        const res = ItemTargeting.useAtTile(gs, contentId, tileIdx);
        if (res?.ok) ItemTargeting.cancel('dropDone');
        return;
      }
      BuildSystem.placeContent(gs, tileIdx, contentId);
    });
  }

  /**
   * 地形背景层：面积约占格子 95%（边长 97.5%），居中铺开，四周留少量空隙。
   * 素材优先取 Assets 的 PNG（无地形也有自己的样子），缺失时回退纯地形底色。
   */
  _terrainLayer(terrainId, ratio) {
    const png = Assets.getIcon('terrains', terrainId);
    return createEl('div', {
      class: ['tile-terrain-bg'],
      attrs: {
        'data-terrain': terrainId,
        'data-fill-side': String(TERRAIN_FILL_SIDE),
        'data-fill-area': (TERRAIN_FILL_SIDE ** 2).toFixed(3),
      },
      style: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${TERRAIN_FILL_SIDE * 100}%`,
        height: `${TERRAIN_FILL_SIDE * 100}%`,
        borderRadius: `${Math.max(5, Math.round(9 * ratio))}px`,
        backgroundColor: this._terrainColor(terrainId),
        backgroundImage: png ? `url("${png}")` : 'none',
        backgroundSize: '100% 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        pointerEvents: 'none',
        zIndex: '0',
      },
    });
  }

  _terrainLayerElOf(tileEl) {
    if (!tileEl) return null;
    return Array.from(tileEl.children || []).find((c) => c?.classList?.contains('tile-terrain-bg')) || null;
  }

  /** 就地刷新一格地形背景层：只替换 .tile-terrain-bg 节点，不重建整格 DOM */
  _applyTerrainLayer(tileEl, terrainId, ratio) {
    if (!tileEl) return;
    const old = this._terrainLayerElOf(tileEl);
    const layer = this._terrainLayer(terrainId, ratio);
    if (old?.parentNode) old.parentNode.removeChild(old);
    if (tileEl.firstChild) tileEl.insertBefore(layer, tileEl.firstChild);
    else tileEl.appendChild(layer);
  }

  /** 外圈地块地形变化 → 只刷新该格背景层 */
  _updateOuterTerrain(tileIdx) {
    const tile = this.gs?.map?.outerTiles?.[tileIdx];
    if (!tile) return;
    this._applyTerrainLayer(this.tileEls.get(tileIdx), normalizeTerrain(tile.terrain), this._tileRatio);
  }

  /** 栅栏内地块地形变化 → 只刷新该格背景层（空地形时移除地形层） */
  _updateFenceTerrain(fenceIdx) {
    const cell = this.gs?.map?.fence?.[fenceIdx];
    const tileEl = this.fenceTileEls.get(fenceIdx);
    if (!cell || !tileEl) return;
    const terrainId = normalizeTerrain(cell.terrain);
    if (terrainId === 'terrain_none') {
      const old = this._terrainLayerElOf(tileEl);
      if (old?.parentNode) old.parentNode.removeChild(old);
      return;
    }
    this._applyTerrainLayer(tileEl, terrainId, this._tileRatio);
  }

  /** 无索引的全量广播（生物吃草等）→ 按数据比对栅栏地形层，只替换变化的那一格 */
  _syncFenceTerrainLayers() {
    if (!this.gs?.map?.fence) return;
    this.fenceTileEls.forEach((tileEl, fenceIdx) => {
      const terrainId = normalizeTerrain(this.gs.map.fence[fenceIdx]?.terrain);
      const cur = this._terrainLayerElOf(tileEl);
      const curId = cur?.getAttribute('data-terrain') || null;
      let changed = false;
      if (terrainId === 'terrain_none') {
        if (cur?.parentNode) { cur.parentNode.removeChild(cur); changed = true; }
      } else if (!cur || curId !== terrainId) {
        this._applyTerrainLayer(tileEl, terrainId, this._tileRatio);
        changed = true;
      }
      if (changed) {
        // 通知信息区等订阅者（不触发 MapView 重建）
        EventBus.emit(GE.FENCE_TILE_UPDATED, {
          fenceIdx,
          row: this.gs.map.fence[fenceIdx]?.row,
          col: this.gs.map.fence[fenceIdx]?.col,
        });
      }
    });
  }

  /** 数据驱动：放置型道具的通用标识（效果类型以 placed_ 开头，或显式 placement:true） */
  _isPlacementItem(itemId) {
    const eff = POTIONS[itemId]?.useEffect;
    if (!eff) return false;
    return eff.placement === true
      || (typeof eff.type === 'string' && eff.type.startsWith('placed_'));
  }

  /** 单个标志占比：1 个时接近 20%，数量增多逐步缩到 6%，夹在 6%~20% */
  _flagSizeRatio(count) {
    if (count <= 0) return 0;
    const raw = FLAG_MAX_RATIO / Math.max(1, count * 0.5);
    return Math.min(FLAG_MAX_RATIO, Math.max(FLAG_MIN_RATIO, raw));
  }

  /** 放置型道具标志层：右下角起沿底边向左依次排列，互不重叠 */
  _renderPlacedItemFlags(tileEl, tile, box, ratio) {
    const placed = (tile.contentState?.placedItems || [])
      .filter((p) => this._isPlacementItem(p.itemId));
    if (placed.length === 0) return;

    const sizeRatio = this._flagSizeRatio(placed.length);
    const flagPx = Math.max(4, Math.round(box.width * sizeRatio));
    const edgePx = Math.max(1, Math.round(2 * ratio));

    const wrap = createEl('div', {
      class: ['tile-flags'],
      attrs: { 'data-count': String(placed.length), 'data-order': 'right-to-left' },
      style: {
        position: 'absolute',
        right: `${edgePx}px`,
        bottom: `${edgePx}px`,
        display: 'flex',
        flexDirection: 'row-reverse',   // 第一个标志贴右下角，后续沿底边向左
        alignItems: 'flex-end',
        gap: `${Math.max(1, Math.round(2 * ratio))}px`,
        pointerEvents: 'none',
        zIndex: '3',                    // 高于地块内容图标
      },
      parent: tileEl,
    });

    for (const p of placed) {
      const def = POTIONS[p.itemId];
      const flag = createEl('div', {
        class: ['tile-flag'],
        attrs: {
          'data-item-id': p.itemId,
          'data-size-ratio': sizeRatio.toFixed(3),
          'title': def?.name || p.itemId,
        },
        style: {
          width: `${flagPx}px`,
          height: `${flagPx}px`,
          flexShrink: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        parent: wrap,
      });
      flag.appendChild(iconEl('items', p.itemId, {
        def,
        size: `${flagPx}px`,
        fallback: def?.emoji || Assets.getEmoji('items', p.itemId),
      }));
    }
  }

  /** 渲染内容相关子节点（内容图标 + 放置型道具标志）；重复调用即局部刷新，不动地形层 */
  _renderCellContent(tileEl, cell, box, ratio) {
    if (!tileEl) return;
    Array.from(tileEl.children || []).forEach((child) => {
      if (child?.classList?.contains('tile-content') || child?.classList?.contains('tile-flags')) {
        if (child.parentNode) child.parentNode.removeChild(child);
      }
    });

    if (cell?.contentId) {
      // 按 contentId 前缀选 group（facility_ → facilities, resource_ → resources, skill_ → characters.SKILLS）
      let group = 'facilities';
      let def = null;
      let fallback = null;
      if (cell.contentId.startsWith('resource_')) {
        group = 'resources';
        fallback = Assets.getEmoji('resources', cell.contentId);
      } else if (cell.contentId.startsWith('skill_')) {
        group = 'items';
        def = SKILLS?.[cell.contentId] || null;
        fallback = def?.emoji || null;
      }
      if (!fallback) {
        fallback = Assets.getEmoji('facilities', cell.contentId);
      }
      tileEl.appendChild(iconEl(group, cell.contentId, {
        def,
        fallback,
        size: `${Math.round(40 * ratio)}px`,
        cls: 'tile-content',
        style: {
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: '2',
          filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.3))',
        },
      }));
    }

    this._renderPlacedItemFlags(tileEl, cell || {}, box, ratio);
  }

  /** 外圈地块内容变化 → 只刷新该格内容/标志子节点 */
  _refreshOuterContent(tileIdx) {
    const gs = this.gs;
    const tile = gs?.map?.outerTiles?.[tileIdx];
    const tileEl = this.tileEls.get(tileIdx);
    if (!tile || !tileEl) return;
    const box = this._pxRect(Geometry.tileRect(gs, Geometry.outerTileRef(tileIdx)));
    this._renderCellContent(tileEl, tile, box, this._tileRatio);
    this._updateBuildModeTileClass(tileEl, tile, gs);
  }

  /** 栅栏格内容变化 → 只刷新该格内容/标志子节点 */
  _refreshFenceContent(fenceIdx) {
    const cell = this.gs?.map?.fence?.[fenceIdx];
    const tileEl = this.fenceTileEls.get(fenceIdx);
    if (!cell || !tileEl) return;
    const width = parseFloat(tileEl.style.width) || this.tileSize;
    this._renderCellContent(tileEl, cell, { width }, this._tileRatio);
  }

  _terrainColor(terrainValue) {
    switch (normalizeTerrain(terrainValue)) {
      case 'terrain_grass': return '#a8e6a1';
      case 'terrain_water': return '#87ceeb';
      case 'terrain_ice':   return '#d9f0ff';
      case 'terrain_none':
      default:              return '#f5f0e1';
    }
  }

  renderFence(gs) {
    if (!this.root) return;
    const fDims = Distance.fenceDimsOf(gs);
    const ts = this.tileSize;
    const ratio = this._tileRatio;

    // 栅栏原点恒为网格 (1,1)；外圈变大时栅栏内区域 = (rows-2)×(cols-2) 同步变大，
    // 位置与尺寸全部由几何层给出，不再用「容器 240px - 栅栏 80px」的写死居中算法。
    const fRect = Geometry.fenceRect(gs);
    const box = this._pxRect(fRect);

    if (this.fenceEl) this.fenceEl.remove();
    this.fenceTileEls.clear();
    this.fenceEl = createEl('div', {
      class: ['map-fence'],
      id: 'fence-container',
      style: {
        position: 'absolute',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        border: '4px dashed #5a5a5a',
        borderRadius: '8px',
        backgroundColor: 'rgba(220, 220, 220, 0.4)',
      },
      parent: this.root,
    });
    const fenceEl = this.fenceEl;

    for (let r = 0; r < fDims.rows; r++) {
      for (let c = 0; c < fDims.cols; c++) {
        const fenceIdx = r * fDims.cols + c;
        const cell = gs.map.fence[fenceIdx];
        // 栅栏格相对栅栏容器的偏移 = 逻辑坐标差 × 每格像素（原点恒 (1,1)，扩图不错位）
        const logicalCell = Geometry.fenceTileRect(r, c);
        const cellRect = this._pxRect(logicalCell);
        const cellLeft = (logicalCell.x0 - fRect.x0) * ts;
        const cellTop = (logicalCell.y0 - fRect.y0) * ts;
        const tileEl = createEl('div', {
          class: ['fence-tile'],
          attrs: {
            'data-fence-row': String(r),
            'data-fence-col': String(c),
            'data-fence-idx': String(fenceIdx),
          },
          style: {
            position: 'absolute',
            left: `${cellLeft}px`,
            top: `${cellTop}px`,
            width: `${cellRect.width}px`,
            height: `${cellRect.height}px`,
            boxSizing: 'border-box',
            border: '1px dashed rgba(100,100,100,0.25)',
            cursor: 'pointer',
          },
          parent: fenceEl,
        });
        this.fenceTileEls.set(fenceIdx, tileEl);

        const fenceTerrain = normalizeTerrain(cell?.terrain);
        if (cell && fenceTerrain !== 'terrain_none') {
          tileEl.appendChild(this._terrainLayer(fenceTerrain, ratio));
        }

        // 内容相关子节点（栅栏格与地块同一口径；当前无栅栏内容数据时不显示）
        this._renderCellContent(tileEl, cell, { width: cellRect.width }, ratio);

        // 生物不再按 fence[].creatures 主格缓存画在格子里：
        // 统一由 creatureLayer 按 renderPos 逐帧绘制（见 _paintCreatures）。

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

    // 玩家格中心同样由几何层给出，UI 只乘每格像素
    const center = Geometry.tileCenter(gs, Geometry.outerTileRef(gs.player.x));
    const centerX = center.x * this.tileSize;
    const centerY = center.y * this.tileSize;
    const ratio = this._tileRatio;

    this.playerEl = iconEl('ui', 'player', {
      size: `${Math.round(42 * ratio)}px`,
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

  // ── 生物逐帧渲染（renderPos → 像素，rAF；逻辑位置由 RealtimeClock 推进） ──

  _ensureCreatureLayer(gs) {
    if (!this.root) return;
    const dims = Geometry.mapDims(gs);
    const mapW = dims.cols * this.tileSize;
    const mapH = dims.rows * this.tileSize;
    if (this.creatureLayer) {
      this.creatureLayer.style.width = `${mapW}px`;
      this.creatureLayer.style.height = `${mapH}px`;
      // 保证在 tile / player 之上（重绘后仍压顶）
      this.root.appendChild(this.creatureLayer);
      return;
    }
    this.creatureLayer = createEl('div', {
      class: ['creature-layer'],
      style: {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: `${mapW}px`,
        height: `${mapH}px`,
        pointerEvents: 'none',
        zIndex: '20',
      },
      parent: this.root,
    });
    this.creatureView = new CreatureView(this.creatureLayer);
  }

  _startCreatureLoop() {
    if (this._creatureRafId != null) return;
    if (typeof requestAnimationFrame !== 'function') return;
    const step = () => {
      this._paintCreatures();
      // 测试环境里 requestAnimationFrame 可能被同步 stub：
      // 同步回调时只画一帧，不再自调度，避免无限递归。
      if (this._rafSyncProbe) return;
      this._creatureRafId = requestAnimationFrame(step);
    };
    this._rafSyncProbe = true;
    this._creatureRafId = requestAnimationFrame(step);
    this._rafSyncProbe = false;
  }

  /** 按 renderPos 逐帧画所有生物；完全重叠的两只各自保留独立节点 */
  _paintCreatures() {
    if (!this.creatureView) return;
    this.creatureView.paint(this.gs, this.tileSize);
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
      this._relayout(gs);
    });

    // STATE_RESET（兼容其他来源；读档后地图边长可能不同 → 重算像素与栅栏）
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      if (!gs) return;
      this.gs = gs;
      this._relayout(gs);
    });

    // 农场扩建：行/列变化 → 整图重排（地块索引已由 MapExpandSystem 重建）
    EventBus.on(GE.MAP_EXPANDED, ({ gs }) => {
      if (!gs) return;
      this.gs = gs;
      this._relayout(gs);
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

    // 地形变化：同一同步调用栈内只就地刷新受影响那一格的地形背景层
    EventBus.on(GE.TILE_TERRAIN_CHANGED, (payload = {}) => {
      if (!this.gs) return;
      const { tileIdx, fenceIdx } = payload;
      if (tileIdx !== undefined && tileIdx !== null) {
        this._updateOuterTerrain(tileIdx);
        // 复用既有广播让信息区/高亮同步刷新；terrainOnly 防止 MapView 重建整格
        EventBus.emit(GE.TILE_UPDATED, { tileIdx, terrainOnly: true });
      }
      if (fenceIdx !== undefined && fenceIdx !== null) {
        this._updateFenceTerrain(fenceIdx);
        EventBus.emit(GE.FENCE_TILE_UPDATED, { ...payload });
      }
    });

    // 内容变化（放置/拆除/放置型道具）：只刷新该格内容图标与标志层，不重建整格
    EventBus.on(GE.TILE_CONTENT_CHANGED, (payload = {}) => {
      if (!this.gs) return;
      const { tileIdx, fenceIdx } = payload;
      if (tileIdx !== undefined && tileIdx !== null) {
        this._refreshOuterContent(tileIdx);
        // 复用既有广播让信息区/高亮/任务同步；contentOnly 防止 MapView 重建整格
        EventBus.emit(GE.TILE_UPDATED, { tileIdx, contentOnly: true });
      }
      if (fenceIdx !== undefined && fenceIdx !== null) {
        this._refreshFenceContent(fenceIdx);
        EventBus.emit(GE.FENCE_TILE_UPDATED, { ...payload });
      }
    });

    // TILE_UPDATED
    EventBus.on(GE.TILE_UPDATED, (payload = {}) => {
      const { tileIdx } = payload;
      if (!this.gs) return;
      if (payload.terrainOnly || payload.contentOnly) return;   // 已就地刷新，禁止重建整格/整图
      this._syncFenceTerrainLayers();   // 无索引广播（生物吃草）也即时更新栅栏地形
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
