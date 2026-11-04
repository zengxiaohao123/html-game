// src/ui/InfoPanel.js
// 第 5 批 UI 对齐（§16.4 信息区）：
//   * 平时隐藏；点地块 / 精灵唤起，从屏幕右侧中部向左滑入（动画保留）。
//   * 宽度约 1/4 屏宽（25vw + clamp），垂直居中于屏幕中右侧；高度中间一块，
//     不与顶部 UI、底部快捷栏、右上功能区重叠，右下适当留白。
//   * 顶部 tab 固定按序：地块内容、状态、单位（祈福模式仅显示"祈福"）。
//   * 单位 tab（栅栏内）：头像 + 血条网格 → 点击生物进入详情页
//     （详情页为本面板内视图切换：数值 / 技能 / 状态 三个子 tab，左上角返回箭头）。
//   * 面板栈接线：滑入时 emit UI_PANEL_OPEN('info')（去重、建造模式拦截）；
//     订阅 UI_PANEL_CLOSE('info') 向右滑出（§16.20 中央逻辑由 GameDirector 发）。
//   * 图标渲染统一走 dom.js 的 iconEl（PNG 优先 → emoji 回退）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { Distance } from '../core/Distance.js';
import { BlessSystem, BLESS_STAMINA_COST, BLESS_GOLD_COST } from '../systems/BlessSystem.js';
import { SkillSystem } from '../systems/SkillSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { getDef, huntCreature } from '../data/facilities.js';
import { depositHenhouseFeed } from '../systems/CreatureSystem.js';
import { SKILLS } from '../data/characters.js';
import { SPIRITS } from '../data/characters.js';
import { CHARACTERS } from '../data/characters.js';
import { VEHICLES } from '../data/vehicles.js';
import { VehicleSystem } from '../systems/VehicleSystem.js';
import { getCreatureDef } from '../data/creatures.js';
import { POTIONS } from '../data/potions.js';
import { getBuff } from '../data/buffs.js';
import { createEl, qs, iconEl } from './dom.js';

/** 滑入/滑出 transform（面板 top:52% + translateY(-50%) 垂直居中，横向位移做滑入滑出） */
const SLIDE_IN_TRANSFORM = 'translate(0, -50%)';
const SLIDE_OUT_TRANSFORM = 'translate(calc(100% + 60px), -50%)';

/** Phase 2B 完整词条描述字典（10 设施 + 5 资源） */
const FACILITY_DESCRIPTIONS = {
  facility_home: [
    '【永恒】不可被替换',
    '【经过时】获得 1 金币（每天限 1 次）',
    '【进入时】获得 1 金币（每天限 1 次）',
    '【睡觉时】行动力回满',
    '【受祝福时】立即 +1 金币',
  ],
  facility_tent: [
    '【睡觉时】行动力回满',
    '【替换时】原来的地块内容被放回背包',
    '【受祝福时】下次帐篷睡觉额外 +3 行动力',
  ],
  facility_wheat: [
    '【每日开始】产出 2 小麦（草地 +1）',
    '【受祝福时】立即额外 ×3 产出一次小麦',
  ],
  facility_rice: [
    '【每日开始】稻草 ×1（草地 +1，相邻水面 +2）',
    '【受祝福时】未来 5 日每日开始额外 +1 稻草',
  ],
  facility_potato: [
    '【每日开始】储存土豆 ×3（上限 30）',
    '【受祝福时】立即储存 +5 土豆',
    '【进入时】取走已储存的土豆',
  ],
  facility_tulip: [
    '【每日开始】价值随机 -4 ~ +10',
    '【受祝福时】立即触发 2 次每日效果',
  ],
  facility_strawberry: [
    '【经过时】储存草莓 ×1（每天限 1 次，上限 5）',
    '【进入时】若草莓已满（≥5），取走全部',
    '【受祝福时】储存 2 ~ 5 个（不超上限）',
  ],
  facility_pea: [
    '【使用技能时】储存豌豆 ×1（每 2 回合限 1 次，上限 10）',
    '【进入时】取走已储存的豌豆',
    '【受祝福时】自动取走储存的豌豆',
  ],
  facility_henhouse: [
    '【进入时】生成 1 只小鸡（Phase 3）',
    '【进入时】取走储存的鸡蛋（上限 10）',
    '【受祝福时】随机 1 只小鸡立刻长大（Phase 3）',
  ],
  facility_slimehouse: [
    '【每日开始】生成 1 只史莱姆（Phase 3）',
    '【受祝福时】未来 3 天每日生成数量 ×2',
  ],

  // —— 资源类地块内容：描述以 facilities.js 定义（物品库 RES-001~006 原文）为准，不在此覆盖 ——
};

const TERRAIN_DESCRIPTIONS = {
  terrain_none:      '无地形：可在此放置设施 / 资源 / 技能',
  terrain_grass:     '草地：10 草元素量，生物可啃食，部分设施产出加成',
  terrain_water:     '水面：10 水元素量，不阻碍移动，相邻稻田 +2 稻草',
  terrain_ice:       '冰面：10 冰元素量，徒步进入会被迫向前滑行（载具不受影响）',
  // 旧 id 别名（兼容旧存档）
  none:  '无地形：可在此放置设施 / 资源 / 技能',
  grass: '草地：10 草元素量',
  water: '水面：10 水元素量',
  mud:   '无地形',
};

/** 地形 id 归一化（旧存档里可能是 'none' / 'grass'） */
const normTerrain = (v) => (!v ? 'terrain_none' : (TERRAIN_DESCRIPTIONS[v] ? (v.startsWith('terrain_') ? v : 'terrain_' + v) : 'terrain_none'));

import { SHOP_KINDS } from '../systems/ShopSystem.js';

/** 状态类型 → emoji + 显示名 */
const STATE_META = {
  blessed:      { emoji: '✨', name: '祝福' },
  tent_bless:   { emoji: '⛺', name: '帐篷祝福（下次睡觉+3）' },
  rice_bless:   { emoji: '🌱', name: '稻田祝福（每日 +1 稻草）' },
  slime_bless:  { emoji: '🟢', name: '史莱姆屋祝福（每日 ×2）' },
  slime:        { emoji: '🟢', name: '粘液' },   // 第 9 批：§15 状态词条「粘液」中文登记
  // Phase 3 再扩展 buffs
};

/** 生物分类显示名 */
const CATEGORY_NAMES = { friendly: '友善', danger: '危险', extreme: '极度危险' };

export class InfoPanel {
  constructor() {
    this.root = null;
    this.tabsWrap = null;
    this.bodyWrap = null;
    this.currentTileIdx = null;     // 当前选中的外圈地块 idx（null = 未选中，InfoPanel 滑出）
    this.currentFenceIdx = null;    // 当前选中的栅栏内地块 idx
    this.currentGs = null;
    this.mode = 'tile';             // 'tile' | 'fence' | 'bless'
    this.activeTabIdx = 0;
    this._currentTabs = [];
    this.creatureDetailId = null;   // 生物详情页（null = 头像列表视图）
    this.creatureSubTab = 'stats';  // 详情页子 tab：'stats' | 'skills' | 'states'
    this._panelOpen = false;        // 已 emit UI_PANEL_OPEN('info') 标记（防重复 emit）
    this._slideTimeout = null;
  }

  mount(parent = qs('#app')) {
    // 外层：初始 transform 滑出屏幕右侧；宽度约 1/4 屏宽，垂直居中于屏幕中右侧
    this.root = createEl('div', {
      class: ['info-panel'],
      style: {
        position: 'absolute',
        right: '20px',
        top: '52%',
        width: 'clamp(280px, 25vw, 400px)',
        maxHeight: 'calc(100vh - 240px)',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        borderRadius: '16px',
        border: '3px solid #3a3a3a',
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
        padding: '15px',
        zIndex: 100,
        fontFamily: '"LXGW WenKai TC", sans-serif',
        color: '#3a2e20',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        overflow: 'hidden',
        // 滑入滑出动画：transform 过渡 0.35s
        transform: SLIDE_OUT_TRANSFORM,
        transition: 'transform 0.35s cubic-bezier(0.33, 1, 0.68, 1)',
      },
      parent,
    });

    // tab bar 容器（每次 renderBody 动态重建；第 10 批：与背包基准 .tab-btn 同一套尺寸语言）
    this.tabsWrap = createEl('div', {
      style: {
        display: 'flex', gap: '8px', flexShrink: '0', flexWrap: 'wrap',
        borderBottom: '2px solid #b8a888', paddingBottom: '6px',
      },
      parent: this.root,
    });

    // body 容器（内容过多时允许上下滚动）
    this.bodyWrap = createEl('div', {
      style: { flex: '1', overflowY: 'auto', minHeight: '60px' },
      parent: this.root,
    });

    this._subscribeEvents();
    return this.root;
  }

  /** 滑入屏幕（§16.14：建造模式不滑入、不 emit OPEN；已显示时不重复 emit） */
  slideIn() {
    if (!this.root) return;
    const gs = this._getGS();
    if (gs?.buildMode === true) return;
    this.root.style.transform = SLIDE_IN_TRANSFORM;
    if (!this._panelOpen) {
      this._panelOpen = true;
      EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'info' });
    }
  }

  /** 滑出屏幕（仅动画，不管面板栈） */
  slideOut() {
    if (!this.root) return;
    this.root.style.transform = SLIDE_OUT_TRANSFORM;
  }

  /**
   * 隐藏面板并重置选中态。
   * @param {boolean} notify true 且面板已在栈中时，补发 UI_PANEL_CLOSE('info') 保持栈一致
   */
  _hideSelf(notify) {
    this.currentTileIdx = null;
    this.currentFenceIdx = null;
    this.mode = 'tile';
    this.creatureDetailId = null;
    this.slideOut();
    if (notify && this._panelOpen) {
      this._panelOpen = false;
      EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
      return;
    }
    this._panelOpen = false;
  }

  /** 根据当前模式重建 tab 按钮条（§16.4：地块内容 / 状态 / 单位 恒存在；祈福仅祈福模式） */
  _rebuildTabs() {
    if (!this.tabsWrap) return;
    // 清空
    while (this.tabsWrap.firstChild) this.tabsWrap.removeChild(this.tabsWrap.firstChild);

    const tabs = [];
    if (this.mode === 'bless') {
      // 祈福模式：只显示祈福 tab（无其他三个 tab）
      tabs.push({ label: '祈福', render: 'bless' });
    } else if (this.mode === 'fence') {
      // 栅栏内地块：地块内容 / 状态 / 单位 总是存在
      tabs.push({ label: '地块内容', render: 'fenceContent' });
      tabs.push({ label: '状态', render: 'fenceState' });
      tabs.push({ label: '单位', render: 'fenceUnits' });
    } else {
      // 外圈地块：地块内容 / 状态 / 单位 总是存在
      tabs.push({ label: '地块内容', render: 'content' });
      tabs.push({ label: '状态', render: 'state' });
      tabs.push({ label: '单位', render: 'unit' });
    }

    if (tabs.length === 0) return;

    if (this.activeTabIdx === undefined || this.activeTabIdx >= tabs.length) {
      this.activeTabIdx = 0;
    }
    const prevRender = this._currentTabs?.[this.activeTabIdx]?.render;
    const stillValid = tabs.some(t => t.render === prevRender);
    if (!stillValid && prevRender !== undefined) {
      this.activeTabIdx = 0;
    }

    tabs.forEach((t, i) => {
      createEl('button', {
        class: i === this.activeTabIdx ? ['tab-btn', 'active'] : ['tab-btn'],
        style: { flex: '1', minWidth: '60px' },
        text: t.label,
        parent: this.tabsWrap,
        onclick: () => {
          this.activeTabIdx = i;
          this._renderBody();
        },
      });
    });

    this._currentTabs = tabs;
  }

  _renderBody() {
    if (!this.bodyWrap || !this.root) return;
    while (this.bodyWrap.firstChild) this.bodyWrap.removeChild(this.bodyWrap.firstChild);

    this._rebuildTabs();

    const gs = this._getGS();

    // 无内容 → 滑出
    if (this.mode === 'tile' && this.currentTileIdx === null) {
      this._hideSelf(true);
      return;
    }
    if (this.mode === 'fence' && this.currentFenceIdx === null) {
      this._hideSelf(true);
      return;
    }

    this.slideIn();

    // 祈福模式
    if (this.mode === 'bless') {
      this._renderBlessTab();
      return;
    }

    // 栅栏内模式
    if (this.mode === 'fence') {
      const fenceCell = gs?.map?.fence?.[this.currentFenceIdx];
      if (!fenceCell) {
        this._hideSelf(true);
        return;
      }
      const tabs = this._currentTabs || [];
      const active = tabs[this.activeTabIdx];
      if (!active) { this.activeTabIdx = 0; this._rebuildTabs(); return this._renderBody(); }
      switch (active.render) {
        case 'fenceContent': this._renderFenceContentTab(fenceCell, gs); break;
        case 'fenceState':   this._renderFenceStateTab(fenceCell, gs); break;
        case 'fenceUnits':   this._renderFenceUnitsTab(fenceCell, gs); break;
      }
      return;
    }

    // 外圈地块模式
    const tile = gs?.map?.outerTiles?.[this.currentTileIdx];
    if (!tile) {
      this._hideSelf(true);
      return;
    }

    const tabs = this._currentTabs || [];
    const active = tabs[this.activeTabIdx];
    if (!active) { this.activeTabIdx = 0; this._rebuildTabs(); return this._renderBody(); }

    switch (active.render) {
      case 'content': this._renderContentTab(tile, gs); break;
      case 'state':   this._renderStateTab(tile, gs); break;
      case 'unit':    this._renderUnitTab(tile, gs); break;
      case 'bless':   this._renderBlessTab(); break;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab —— 地块内容（第一行图标+名字；词条逐行；收获滑动条；文字功能按钮一行一个）
  // ════════════════════════════════════════════════════════════
  _renderContentTab(tile, gs) {
    const titleRow = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        fontSize: '20px', fontWeight: '700', color: '#5a4a3a', marginBottom: '12px',
      },
      parent: this.bodyWrap,
    });

    let iconNode, name, descriptions;
    const contentId = tile.contentId;
    if (contentId) {
      if (contentId.startsWith('skill_')) {
        // 技能卡地块：从 SKILLS 查中文名
        const sk = SKILLS[contentId];
        iconNode = iconEl('ui', contentId, { def: sk, fallback: sk?.emoji || '⚡', size: '32px' });
        name = sk?.name || contentId;
        descriptions = sk?.description ? [sk.description] : ['（词条未配置）'];
      } else {
        const group = contentId.startsWith('resource_') ? 'resources' : 'facilities';
        const def = getDef(contentId);
        iconNode = iconEl(group, contentId, {
          def, size: '32px',
          fallback: def?.emoji || Assets.getEmoji(group, contentId),
        });
        name = (def && def.name) || contentId;
        descriptions = FACILITY_DESCRIPTIONS[contentId] || ['（词条未配置）'];
      }
    } else {
      // 空地：显示地形（含"无地形"）
      const tId = normTerrain(tile.terrain);
      iconNode = iconEl('terrains', tId, {
        size: '32px',
        fallback: Assets.getEmoji('terrains', tile.terrain || 'terrain_none'),
      });
      name = (TERRAIN_DESCRIPTIONS[tile.terrain || 'terrain_none'] || '空地').split('：')[0];
      descriptions = [TERRAIN_DESCRIPTIONS[tile.terrain || 'terrain_none'] || '可在此建造设施'];
    }

    titleRow.appendChild(iconNode);
    createEl('span', { text: name, parent: titleRow });

    // 地形提示
    if (tile.terrain && normTerrain(tile.terrain) !== 'terrain_none') {
      const tRow = createEl('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#8a6a3a', marginBottom: '8px' },
        parent: this.bodyWrap,
      });
      tRow.appendChild(iconEl('terrains', tile.terrain, {
        size: '18px',
        fallback: Assets.getEmoji('terrains', tile.terrain),
      }));
      // 第 10 批：显示中文地形名（不再露出原始 id）
      const tName = (TERRAIN_DESCRIPTIONS[tile.terrain] || '').split('：')[0] || tile.terrain;
      createEl('span', { text: `地形：${tName}`, parent: tRow });
    }

    // 词条描述（每条一行）
    for (const desc of descriptions) {
      createEl('div', {
        class: ['facility-desc-row'],
        text: desc,
        parent: this.bodyWrap,
      });
    }

    // 设施类地块 —— 功能选项区（§16.4：区分"身处该格"vs"随时可点"）
    if (contentId && contentId.startsWith('facility_')) {
      const tileIdx = this.currentTileIdx;
      const onTile = gs.player.x === tile.idx; // 玩家是否身处该格

      createEl('div', { style: { marginTop: '12px', textAlign: 'center' }, parent: this.bodyWrap });
      createEl('div', {
        style: {
          fontSize: '13px', fontWeight: '700', color: '#8a6a3a',
          borderTop: '2px dashed #b8a888', paddingTop: '8px', marginBottom: '6px',
        },
        text: onTile ? '⚡ 功能选项（你在该格）' : '⚡ 功能选项（未在该格）',
        parent: this.bodyWrap,
      });

      // 每个设施的功能选项
      switch (contentId) {
        case 'facility_potato': {
          // 🥔 土豆田：onTile 时显示滑动条收获
          const stored = tile.contentState?.potatoStored ?? 0;
          if (onTile) {
            createEl('div', {
              style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
              text: `🥔 已储存 ${stored} / 30`,
              parent: this.bodyWrap,
            });
            const range = this._mkHarvestSlider(this.bodyWrap, stored);
            const qtyLabel = createEl('div', {
              style: { fontSize: '13px', color: '#5a4a3a', textAlign: 'center', margin: '4px 0' },
              text: `选择收获数量：${stored}`,
              parent: this.bodyWrap,
            });
            range.addEventListener('input', () => {
              qtyLabel.textContent = `选择收获数量：${range.value}`;
            });
            createEl('button', {
              class: 'action-btn',
              style: { width: '100%', fontSize: '13px', background: '#fff0c0' },
              text: '🥔 确认收获',
              disabled: stored <= 0,
              parent: this.bodyWrap,
              onclick: () => {
                const qty = parseInt(range.value, 10) || 0;
                if (qty <= 0) return;
                const curTile = gs.map.outerTiles[tileIdx];
                const cs = curTile.contentState || (curTile.contentState = {});
                const actually = Math.min(qty, cs.potatoStored || 0);
                InventorySystem.addItem(gs, 'item_potato', actually);
                cs.potatoStored = (cs.potatoStored || 0) - actually;
                EventBus.emit(GE.INVENTORY_CHANGE);
                EventBus.emit(GE.TILE_UPDATED, { tileIdx });
                EventBus.emit(GE.TOAST_SHOW, { text: `🥔 收获 +${actually} 土豆`, duration: 1800 });
                this._renderBody();
              },
            });
          } else {
            createEl('div', {
              style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
              text: `（走到该格可收获 🥔 ${stored}/30）`,
              parent: this.bodyWrap,
            });
          }
          break;
        }

        case 'facility_strawberry': {
          // 🍓 草莓田：onTile + 满时出现"取走草莓"按钮
          const stored = tile.contentState?.strawberryStored ?? 0;
          const full = stored >= 5;
          if (onTile) {
            createEl('div', {
              style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
              text: `🍓 已储存 ${stored} / 5${full ? '（已满！）' : ''}`,
              parent: this.bodyWrap,
            });
            createEl('button', {
              class: 'action-btn',
              style: { width: '100%', fontSize: '13px', background: '#ffcce0' },
              text: '🍓 取走草莓',
              disabled: !full,
              parent: this.bodyWrap,
              onclick: () => {
                const curTile = gs.map.outerTiles[tileIdx];
                const cs = curTile.contentState || (curTile.contentState = {});
                const qty = cs.strawberryStored || 0;
                if (qty <= 0) return;
                InventorySystem.addItem(gs, 'item_strawberry', qty);
                cs.strawberryStored = 0;
                EventBus.emit(GE.INVENTORY_CHANGE);
                EventBus.emit(GE.TILE_UPDATED, { tileIdx });
                EventBus.emit(GE.TOAST_SHOW, { text: `🍓 收获 +${qty} 草莓`, duration: 1800 });
                this._renderBody();
              },
            });
          } else {
            createEl('div', {
              style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
              text: `（走到该格可取走 🍓 满时按钮出现 ${stored}/5）`,
              parent: this.bodyWrap,
            });
          }
          break;
        }

        case 'facility_pea': {
          // 🫛 豌豆架：onTile 时显示滑动条收获
          const stored = tile.contentState?.peaStored ?? 0;
          if (onTile) {
            createEl('div', {
              style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
              text: `🫛 已储存 ${stored} / 10`,
              parent: this.bodyWrap,
            });
            const range = this._mkHarvestSlider(this.bodyWrap, stored);
            const qtyLabel = createEl('div', {
              style: { fontSize: '13px', color: '#5a4a3a', textAlign: 'center', margin: '4px 0' },
              text: `选择收获数量：${stored}`,
              parent: this.bodyWrap,
            });
            range.addEventListener('input', () => {
              qtyLabel.textContent = `选择收获数量：${range.value}`;
            });
            createEl('button', {
              class: 'action-btn',
              style: { width: '100%', fontSize: '13px', background: '#d0f0d0' },
              text: '🫛 确认收获',
              disabled: stored <= 0,
              parent: this.bodyWrap,
              onclick: () => {
                const qty = parseInt(range.value, 10) || 0;
                if (qty <= 0) return;
                const curTile = gs.map.outerTiles[tileIdx];
                const cs = curTile.contentState || (curTile.contentState = {});
                const actually = Math.min(qty, cs.peaStored || 0);
                InventorySystem.addItem(gs, 'item_pea', actually);
                cs.peaStored = (cs.peaStored || 0) - actually;
                EventBus.emit(GE.INVENTORY_CHANGE);
                EventBus.emit(GE.TILE_UPDATED, { tileIdx });
                EventBus.emit(GE.TOAST_SHOW, { text: `🫛 收获 +${actually} 豌豆`, duration: 1800 });
                this._renderBody();
              },
            });
          } else {
            createEl('div', {
              style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
              text: `（走到该格可收获 🫛 ${stored}/10）`,
              parent: this.bodyWrap,
            });
          }
          break;
        }

        case 'facility_tulip': {
          // 🌷 郁金香：随时可点采摘
          const value = Math.max(0, tile.contentState?.tulipValue || 0);
          createEl('div', {
            style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
            text: `🌷 当前价值：${value}`,
            parent: this.bodyWrap,
          });
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: '#ffe0f0' },
            text: `🌷 采摘（获得 1 × 郁金香）`,
            parent: this.bodyWrap,
            onclick: () => {
              const curTile = gs.map.outerTiles[tileIdx];
              const v = Math.max(0, curTile.contentState?.tulipValue || 0);
              // 任何时候都能采摘（价值 ≤ 0 时按 0 算，玩家亏金币但花田清空）
              InventorySystem.addItem(gs, 'item_tulip', 1, { value: v });
              curTile.contentId = null;
              curTile.contentState = {};
              EventBus.emit(GE.TILE_UPDATED, { tileIdx });
              EventBus.emit(GE.INVENTORY_CHANGE);
              EventBus.emit(GE.TOAST_SHOW, { text: `🌷 采摘成功！获得价值 ${v} 的郁金香`, duration: 2000 });
              this._renderBody();
            },
          });
          break;
        }

        case 'facility_dandelion': {
          // 🌼 蒲公英田地：价值随移动距离增长，随时可采摘（采摘后地块内容消失）
          const v = Math.max(0, tile.contentState?.dandelionValue || 1);
          createEl('div', {
            style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
            text: `🌼 当前价值：${v}（每移动 1 格 +1）`,
            parent: this.bodyWrap,
          });
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: '#fff2cc' },
            text: '🌼 采摘（获得 1 × 蒲公英）',
            parent: this.bodyWrap,
            onclick: () => {
              const curTile = gs.map.outerTiles[tileIdx];
              const cur = Math.max(0, curTile.contentState?.dandelionValue || 1);
              InventorySystem.addItem(gs, 'item_dandelion', 1, { value: cur });
              curTile.contentId = null;
              curTile.contentState = {};
              EventBus.emit(GE.TILE_UPDATED, { tileIdx });
              EventBus.emit(GE.INVENTORY_CHANGE);
              EventBus.emit(GE.TOAST_SHOW, { text: `🌼 采摘成功！获得价值 ${cur} 的蒲公英`, duration: 2000 });
              this._renderBody();
            },
          });
          break;
        }

        case 'facility_ghost_grass': {
          // 🌙 幽怜草田地：受祝福加价，本日未受祝福次日枯萎（站该格采摘）
          const v = Math.max(0, tile.contentState?.ghostValue || 12);
          createEl('div', {
            style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
            text: `🌙 当前价值：${v}`,
            parent: this.bodyWrap,
          });
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: '#e8e0ff' },
            text: '🌙 采摘（获得 1 × 幽怜草）',
            parent: this.bodyWrap,
            onclick: () => {
              const curTile = gs.map.outerTiles[tileIdx];
              const cur = Math.max(0, curTile.contentState?.ghostValue || 12);
              InventorySystem.addItem(gs, 'item_ghost_grass', 1, { value: cur });
              curTile.contentId = null;
              curTile.contentState = {};
              EventBus.emit(GE.TILE_UPDATED, { tileIdx });
              EventBus.emit(GE.INVENTORY_CHANGE);
              EventBus.emit(GE.TOAST_SHOW, { text: `🌙 采摘成功！获得价值 ${cur} 的幽怜草`, duration: 2000 });
              this._renderBody();
            },
          });
          break;
        }

        case 'facility_henhouse': {
          // 🐔 鸡舍：onTile 时显示鸡蛋收获（普通/优质分开占格）+ 投放饲料；随时显示开门/关门
          // 2026-11-04 裁决①：鸡蛋与优质蛋共享同一储存额度（合计上限 10），满额产出直接丢弃；
          //   收获进背包时鸡蛋与优质蛋为两个不同物品分别占格。
          // 2026-11-04 裁决③：「投放饲料」真实 UI 入口（背包稻草/小麦 → 鸡舍储存），与取回逻辑对称。
          const stored = tile.contentState?.eggStored ?? 0;
          const storedGolden = tile.contentState?.eggStoredGolden ?? 0;
          const storedTotal = stored + storedGolden;
          const doorOpen = tile.contentState?.doorOpen ?? true;
          if (onTile) {
            createEl('div', {
              style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
              text: `🥚 已储存 ${storedTotal} / 10${storedGolden > 0 ? `（含 ⭐ 优质蛋 ${storedGolden}）` : ''}`,
              parent: this.bodyWrap,
            });
            // ── 收获：普通鸡蛋 ──
            const range = this._mkHarvestSlider(this.bodyWrap, stored);
            const qtyLabel = createEl('div', {
              style: { fontSize: '13px', color: '#5a4a3a', textAlign: 'center', margin: '4px 0' },
              text: `选择收获数量：${stored}`,
              parent: this.bodyWrap,
            });
            range.addEventListener('input', () => {
              qtyLabel.textContent = `选择收获数量：${range.value}`;
            });
            createEl('button', {
              class: 'action-btn',
              style: { width: '100%', fontSize: '13px', background: '#fff0c0', marginBottom: '6px' },
              text: '🥚 确认收获鸡蛋',
              disabled: stored <= 0,
              parent: this.bodyWrap,
              onclick: () => {
                const qty = parseInt(range.value, 10) || 0;
                if (qty <= 0) return;
                const curTile = gs.map.outerTiles[tileIdx];
                const cs = curTile.contentState || (curTile.contentState = {});
                const actually = Math.min(qty, cs.eggStored || 0);
                InventorySystem.addItem(gs, 'item_egg', actually);
                cs.eggStored = (cs.eggStored || 0) - actually;
                EventBus.emit(GE.INVENTORY_CHANGE);
                EventBus.emit(GE.TILE_UPDATED, { tileIdx });
                EventBus.emit(GE.TOAST_SHOW, { text: `🥚 收获 +${actually} 鸡蛋`, duration: 1800 });
                this._renderBody();
              },
            });
            // ── 收获：优质蛋（与鸡蛋为不同物品，分别占格） ──
            if (storedGolden > 0) {
              const rangeG = this._mkHarvestSlider(this.bodyWrap, storedGolden);
              const qtyLabelG = createEl('div', {
                style: { fontSize: '13px', color: '#5a4a3a', textAlign: 'center', margin: '4px 0' },
                text: `选择优质蛋收获数量：${storedGolden}`,
                parent: this.bodyWrap,
              });
              rangeG.addEventListener('input', () => {
                qtyLabelG.textContent = `选择优质蛋收获数量：${rangeG.value}`;
              });
              createEl('button', {
                class: 'action-btn',
                style: { width: '100%', fontSize: '13px', background: '#ffe8a0', marginBottom: '6px' },
                text: '⭐ 确认收获优质蛋',
                parent: this.bodyWrap,
                onclick: () => {
                  const qty = parseInt(rangeG.value, 10) || 0;
                  if (qty <= 0) return;
                  const curTile = gs.map.outerTiles[tileIdx];
                  const cs = curTile.contentState || (curTile.contentState = {});
                  const actually = Math.min(qty, cs.eggStoredGolden || 0);
                  InventorySystem.addItem(gs, 'item_golden_egg', actually);
                  cs.eggStoredGolden = (cs.eggStoredGolden || 0) - actually;
                  EventBus.emit(GE.INVENTORY_CHANGE);
                  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
                  EventBus.emit(GE.TOAST_SHOW, { text: `⭐ 收获 +${actually} 优质蛋`, duration: 1800 });
                  this._renderBody();
                },
              });
            }
            // ── 投放饲料（裁决③：背包 → 鸡舍储存，与取回逻辑对称） ──
            const strawBag = InventorySystem.countItem(gs, 'item_rice_straw');
            const wheatBag = InventorySystem.countItem(gs, 'item_wheat');
            const feedStore = tile.contentState?.henhouseFeed || {};
            createEl('div', {
              style: { fontSize: '12px', color: '#666', margin: '8px 0 4px' },
              text: '🌾 投放饲料（背包 → 鸡舍储存）',
              parent: this.bodyWrap,
            });
            createEl('div', {
              style: { fontSize: '12px', color: '#8a7a5a', marginBottom: '4px' },
              text: `稻草：背包 ${strawBag} / 已存 ${feedStore.item_rice_straw || 0} · 小麦：背包 ${wheatBag} / 已存 ${feedStore.item_wheat || 0}`,
              parent: this.bodyWrap,
            });
            const feedMax = Math.max(strawBag, wheatBag);
            if (feedMax > 0) {
              const feedRange = this._mkHarvestSlider(this.bodyWrap, feedMax);
              feedRange.value = '1';
              const feedLabel = createEl('div', {
                style: { fontSize: '13px', color: '#5a4a3a', textAlign: 'center', margin: '4px 0' },
                text: '选择投放数量：1',
                parent: this.bodyWrap,
              });
              feedRange.addEventListener('input', () => {
                feedLabel.textContent = `选择投放数量：${feedRange.value}`;
              });
              const mkDeposit = (itemId, name, bg) => createEl('button', {
                class: 'action-btn',
                style: { width: '100%', fontSize: '13px', background: bg, marginBottom: '6px' },
                text: `🌾 投放${name}`,
                disabled: InventorySystem.countItem(gs, itemId) <= 0,
                parent: this.bodyWrap,
                onclick: () => {
                  const qty = parseInt(feedRange.value, 10) || 0;
                  if (qty <= 0) return;
                  const r = depositHenhouseFeed(gs, tileIdx, itemId, qty);
                  if (!r.ok) {
                    EventBus.emit(GE.TOAST_SHOW, { text: '🌾 背包中没有可投放的饲料', duration: 1500 });
                    return;
                  }
                  EventBus.emit(GE.TOAST_SHOW, { text: `🌾 已投放 ${name} ×${r.deposited} 进鸡舍储存`, duration: 1600 });
                  this._renderBody();
                },
              });
              mkDeposit('item_rice_straw', '稻草', '#d8f0c0');
              mkDeposit('item_wheat', '小麦', '#f0e0b0');
            }
          } else {
            createEl('div', {
              style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
              text: `（走到该格可收获 🥚 ${storedTotal}/10、投放饲料）`,
              parent: this.bodyWrap,
            });
          }
          // 随时可点：开门/关门
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: '#e0e0ff' },
            text: doorOpen ? '🚪 关门（限制鸡舍生物活动范围）' : '🚪 开门（鸡舍生物可自由活动）',
            parent: this.bodyWrap,
            onclick: () => {
              const curTile = gs.map.outerTiles[tileIdx];
              const cs = curTile.contentState || (curTile.contentState = {});
              cs.doorOpen = !cs.doorOpen;
              EventBus.emit(GE.TILE_UPDATED, { tileIdx });
              EventBus.emit(GE.TOAST_SHOW, {
                text: cs.doorOpen ? '🚪 鸡舍门已打开' : '🚪 鸡舍门已关闭',
                duration: 1500,
              });
              this._renderBody();
            },
          });
          break;
        }

        case 'facility_slimehouse': {
          // 🟢 史莱姆屋：随时显示开门/关门
          const doorOpen = tile.contentState?.doorOpen ?? true;
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: '#c0f0c0' },
            text: doorOpen ? '🚪 关门（限制史莱姆活动范围）' : '🚪 开门（史莱姆可自由活动）',
            parent: this.bodyWrap,
            onclick: () => {
              const curTile = gs.map.outerTiles[tileIdx];
              const cs = curTile.contentState || (curTile.contentState = {});
              cs.doorOpen = !cs.doorOpen;
              EventBus.emit(GE.TILE_UPDATED, { tileIdx });
              EventBus.emit(GE.TOAST_SHOW, {
                text: cs.doorOpen ? '🚪 史莱姆屋门已打开' : '🚪 史莱姆屋门已关闭',
                duration: 1500,
              });
              this._renderBody();
            },
          });
          break;
        }

        default: {
          // 其他设施（home/tent/wheat/rice/corn/cabbage）：暂不渲染额外按钮
          createEl('div', {
            style: { fontSize: '11px', color: '#b0a090', textAlign: 'center', margin: '4px 0' },
            text: '（暂无额外功能选项）',
            parent: this.bodyWrap,
          });
        }
      }

      // "前往"按钮在下面统一渲染（任何格都能前往，§7）
    }

    // 资源类地块 / 技能卡地块 —— 功能选项区（第 4 批：资源点交互接线）
    if (contentId && (contentId.startsWith('resource_') || contentId.startsWith('skill_'))) {
      createEl('div', {
        style: { marginTop: '12px', textAlign: 'center' },
        parent: this.bodyWrap,
      });

      const onTile = gs.player.x === tile.idx;

      // 🏹 狩猎点（RES-003）：选择狩猎普通 / 危险生物，每日限一次，需身处该格
      if (contentId === 'resource_hunt') {
        const hunted = !!(tile.dailyFlags && tile.dailyFlags['resource_hunt_hunt']);
        const huntBlessed = !!tile.contentState?.huntBlessPending;
        if (huntBlessed) {
          createEl('div', {
            style: { fontSize: '12px', color: '#8a6a3a', marginBottom: '6px', textAlign: 'left' },
            text: '✨ 受祝福：下一次进入本格狩猎地块时狩猎成功率 +50%（超出 100% 按 100% 计）',
            parent: this.bodyWrap,
          });
        }
        if (hunted) {
          createEl('div', {
            style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
            text: '（今日已狩猎，明日可再次狩猎）',
            parent: this.bodyWrap,
          });
        } else {
          createEl('div', {
            style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
            text: onTile ? '选择狩猎目标：' : '（需身处狩猎点才可狩猎）',
            parent: this.bodyWrap,
          });
          const mkHuntBtn = (option, label, bg) => createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '13px', background: bg, marginBottom: '6px' },
            text: label,
            disabled: !onTile,
            parent: this.bodyWrap,
            onclick: () => {
              const curIdx = this.currentTileIdx;
              const r = huntCreature(gs, curIdx, option);
              if (!r.ok) {
                EventBus.emit(GE.TOAST_SHOW, { text: '🏹 现在无法狩猎', duration: 1500 });
                return;
              }
              EventBus.emit(GE.TILE_UPDATED, { tileIdx: curIdx });
              this._renderBody();
            },
          });
          mkHuntBtn('normal', '🏹 狩猎普通生物（成功率 40%~90%）', '#ffe0b0');
          mkHuntBtn('danger', '🏹 狩猎危险生物（成功率 15%~75%）', '#f0c0c0');
        }
      }

      // 🎲 事件点（RES-001）：踏上即触发，此处仅显示今日状态
      if (contentId === 'resource_event') {
        const done = !!(tile.dailyFlags && tile.dailyFlags['resource_event_onEnter']);
        createEl('div', {
          style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
          text: done ? '🎲 今日已遇到事件（每日限一次）' : '🎲 踏上此地即遇到随机事件（每日限一次）',
          parent: this.bodyWrap,
        });
      }

      // 🎁 奖励点（RES-002）：踏上即触发，此处仅显示今日状态
      if (contentId === 'resource_reward') {
        const done = !!(tile.dailyFlags && tile.dailyFlags['resource_reward_onEnter']);
        const rewardBlessed = !!tile.contentState?.rewardBlessPending;
        if (rewardBlessed) {
          createEl('div', {
            style: { fontSize: '12px', color: '#8a6a3a', marginBottom: '6px', textAlign: 'left' },
            text: '✨ 受祝福：下次进入高价值奖励概率提升',
            parent: this.bodyWrap,
          });
        }
        createEl('div', {
          style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
          text: done ? '🎁 今日已领取奖励（每日限一次）' : '🎁 踏上此地即获得随机奖励（每日限一次）',
          parent: this.bodyWrap,
        });
      }

      // 🚌 巴士站（RES-005）：踏上即结算，此处仅显示今日行动力状态
      if (contentId === 'resource_bus') {
        const gotStamina = !!(tile.dailyFlags && tile.dailyFlags['resource_bus_onEnter_stamina']);
        createEl('div', {
          style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
          text: gotStamina
            ? '🚌 今日行动力 +1 已领取；每次进入仍可获得 1 轮子'
            : '🚌 踏上此地：行动力 +1（每日限一次）并获得 1 轮子',
          parent: this.bodyWrap,
        });
      }

      // §11.1：进入过一次后，地块内容 tab 预览剩余商品（数量与剩余格）
      // 只读已存在的 contentState.shop（visited 由 enterShop 置位）；不在此调 getShop，避免未进店就预生成库存
      const shopSt = tile.contentState && tile.contentState.shop;
      if ((contentId === 'resource_shop' || contentId === 'resource_magic_shop') && shopSt && shopSt.visited) {
        const unsold = (shopSt.stock || []).filter((it) => it && !it.sold);
        const totalSlots = (SHOP_KINDS[shopSt.kind] && SHOP_KINDS[shopSt.kind].slots) || unsold.length;
        createEl('div', {
          style: { fontSize: '12px', color: '#666', margin: '6px 0 4px' },
          text: `📦 剩余商品 ${unsold.length} 件 / 空格 ${Math.max(0, totalSlots - unsold.length)} 格`,
          parent: this.bodyWrap,
        });
        const prevRow = createEl('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', marginBottom: '8px' },
          parent: this.bodyWrap,
        });
        unsold.forEach((it) => createEl('span', {
          text: `${it.emoji || '🛒'} ${it.name}`,
          style: {
            fontSize: '11px', padding: '1px 6px', color: '#3a2e20',
            background: 'rgba(255,255,255,0.8)', border: '1px solid #d8ccb0', borderRadius: '6px',
          },
          parent: prevRow,
        }));
      }

      if (contentId === 'resource_shop') {
        createEl('button', {
          class: 'action-btn',
          style: { width: '100%', fontSize: '14px' },
          text: '🏪 进入商店',
          parent: this.bodyWrap,
          onclick: () => EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx: tile.idx }),
        });
      } else if (contentId === 'resource_magic_shop') {
        createEl('button', {
          class: 'action-btn',
          style: { width: '100%', fontSize: '14px' },
          text: '🔮 进入魔法商店',
          parent: this.bodyWrap,
          onclick: () => EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'magicShop', tileIdx: tile.idx }),
        });
      } else if (contentId.startsWith('skill_')) {
        // Phase 4 —— 技能卡地块：显示技能详情 + 手动触发
        const skillObj = SkillSystem.getSkillById?.(contentId) || SKILLS[contentId];
        if (skillObj) {
          createEl('div', {
            style: {
              padding: '8px 10px', background: 'rgba(255,255,255,0.8)',
              borderLeft: '3px solid #e8a900', borderRadius: '4px',
              fontSize: '12px', color: '#3a2e20', lineHeight: '1.6', marginBottom: '6px',
            },
            text: `${skillObj.emoji} ${skillObj.name}\n${skillObj.description || ''}`,
            parent: this.bodyWrap,
          });
          createEl('button', {
            class: 'action-btn',
            style: { width: '100%', fontSize: '14px', background: '#ffe099' },
            text: '⚡ 使用技能卡',
            parent: this.bodyWrap,
            onclick: () => {
              const tileIdx = this.currentTileIdx;
              EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
              SkillSystem.triggerSkillAtTile(gs, tileIdx);
            },
          });
        }
      }
      // 其他 resource_ 前缀（如未来的新资源点）— 词条自动触发，无额外功能选项
    }

    // ── "前往"按钮（根据载具状态决定可达范围和调用方式） ──
    if (gs && tile.idx !== gs.player.x) {
      const hasVehicle = !!(gs.vehicle?.current);
      let canGo = false;
      let goLabel = '🚪 前往（一步抵达）';
      let goDisabled = false;
      let goReason = null;
      let reachInfo = null;  // { pattern, maxRange, ... }

      if (!hasVehicle) {
        // 无载具：只允许相邻格
        const isAdj = Distance.isOuterAdjacent(gs.map.size, gs.player.x, tile.idx);
        if (isAdj) {
          canGo = true;
        } else {
          canGo = false;
          goReason = '不是相邻格';
        }
      } else {
        // 有载具：按载具 movePattern 判断可达性
        const reach = VehicleSystem.canVehicleReach(gs, tile.idx);
        if (reach.ok) {
          canGo = true;
          reachInfo = reach.def;
          // 动态拼按钮文字
          if (reachInfo.movePattern === 'directional') {
            goLabel = `🚗 ${reachInfo.emoji || ''} ${reachInfo.name}：前往（同方向最多 ${reachInfo.maxRange} 格）`;
          } else if (reachInfo.movePattern === 'line') {
            goLabel = `🧹 ${reachInfo.emoji || ''} ${reachInfo.name}：前往（同行/同列任意格）`;
          } else if (reachInfo.movePattern === 'any') {
            goLabel = `✨ ${reachInfo.emoji || ''} ${reachInfo.name}：前往（任意格）`;
          }
          goLabel += ` · 剩 ${gs.vehicle.current.usageLeft} 次`;
        } else {
          canGo = false;
          goReason = reach.reason;
        }
      }

      createEl('div', {
        style: { marginTop: '10px', textAlign: 'center' },
        parent: this.bodyWrap,
      });

      if (canGo) {
        createEl('button', {
          class: 'action-btn',
          style: { width: '100%', fontSize: '14px', background: '#fff0c0' },
          text: goLabel,
          disabled: goDisabled,
          parent: this.bodyWrap,
          onclick: () => {
            const director = window.__gameDirector;
            if (!director) return;
            if (!hasVehicle) {
              // 无载具：普通 1 步相邻移动（保持原逻辑）
              const { x: px, y: py } = Distance.outerIdxToXY(gs.map.size, gs.player.x);
              const { x: tx, y: ty } = Distance.outerIdxToXY(gs.map.size, tile.idx);
              let dir = null;
              if (tx > px) dir = 'right';
              else if (tx < px) dir = 'left';
              else if (ty > py) dir = 'down';
              else if (ty < py) dir = 'up';
              if (dir) director.move(dir);
            } else {
              // 有载具：调 VehicleSystem.tryMove
              const pattern = reachInfo?.movePattern;
              let result;
              if (pattern === 'directional') {
                // 轮子：算出方向，走 tryMove({ type:'direction', direction })
                const { x: px, y: py } = Distance.outerIdxToXY(gs.map.size, gs.player.x);
                const { x: tx, y: ty } = Distance.outerIdxToXY(gs.map.size, tile.idx);
                let dir = null;
                if (tx > px) dir = 'right';
                else if (tx < px) dir = 'left';
                else if (ty > py) dir = 'down';
                else if (ty < py) dir = 'up';
                result = VehicleSystem.tryMove(gs, { type: 'direction', direction: dir });
              } else {
                // 扫帚 / 巧遇：指定目标格
                result = VehicleSystem.tryMove(gs, { type: 'target', targetIdx: tile.idx });
              }
              if (!result.ok) {
                EventBus.emit(GE.TOAST_SHOW, {
                  text: `🚗 载具移动失败：${result.reason || '未知原因'}`,
                  duration: 1500,
                });
              }
            }
          },
        });
      } else {
        createEl('div', {
          style: { marginTop: '6px', fontSize: '12px', color: '#b0a090', textAlign: 'center' },
          text: hasVehicle
            ? `❌ 载具无法到达（${goReason || '不在移动范围内'}）`
            : '❌ 不可前往（不是相邻格）',
          parent: this.bodyWrap,
        });
      }

      // 载具状态提示（有载具时显示在前往按钮上方）
      if (hasVehicle) {
        const cur = gs.vehicle.current;
        const def = VEHICLES[cur.vehicleId];
        createEl('div', {
          style: { marginTop: '4px', fontSize: '11px', color: '#8a6a3a', textAlign: 'center', fontStyle: 'italic' },
          text: `当前装备：${def?.emoji || ''} ${def?.name || cur.vehicleId} · 剩余 ${cur.usageLeft} 次`,
          parent: this.bodyWrap,
        });
      }
    }

  }

  /** 收获滑动条（§16.4：较大，可占两行高度） */
  _mkHarvestSlider(parent, stored) {
    const wrap = createEl('div', {
      style: { padding: '8px 2px', marginBottom: '4px' },
      parent,
    });
    return createEl('input', {
      attrs: { type: 'range', min: 0, max: stored, value: stored, step: 1 },
      style: { width: '100%', height: '26px', display: 'block', accentColor: '#e8a900', cursor: 'pointer' },
      parent: wrap,
    });
  }

  // ════════════════════════════════════════════════════════════
  // Tab —— 状态（地形（含"无地形"）+ 本地块 buff/debuff + 放置型消耗道具）
  // ════════════════════════════════════════════════════════════
  _renderStateTab(tile, gs) {
    // 1) 地形属于状态的一种（含"无地形"）
    const tId = normTerrain(tile.terrain);
    const terrainRow = createEl('div', { class: ['state-row'], parent: this.bodyWrap });
    terrainRow.appendChild(iconEl('terrains', tId, {
      size: '20px',
      fallback: Assets.getEmoji('terrains', tile.terrain || 'terrain_none'),
    }));
    createEl('span', {
      class: ['state-name'],
      text: TERRAIN_DESCRIPTIONS[tile.terrain || 'terrain_none'] || '无地形：可在此放置设施 / 资源 / 技能',
      parent: terrainRow,
    });

    // 2) 以本地块为主体的 buff/debuff（tile.states[]）
    const states = (tile.states || []).slice();
    for (const s of states) {
      const meta = STATE_META[s.type] || { emoji: '❓', name: s.type };
      const remainText = (s.remainingDays !== undefined && s.remainingDays !== null)
        ? `${s.remainingDays} 天`
        : (s.usesRemaining !== undefined ? `${s.usesRemaining} 次` : '持续');

      const row = createEl('div', { class: ['state-row'], parent: this.bodyWrap });
      createEl('span', { class: ['state-emoji'], text: meta.emoji, parent: row });
      createEl('span', { class: ['state-name'], text: meta.name, parent: row });
      createEl('span', { class: ['state-remain'], text: remainText, parent: row });
    }

    // 3) 放置在本地块上的放置型消耗道具（陷阱 / 艾草熏香等）：名称 + 效果描述
    const placed = tile.contentState?.placedItems || [];
    for (const p of placed) {
      const def = POTIONS[p.itemId];
      const row = createEl('div', { class: ['state-row'], parent: this.bodyWrap });
      row.appendChild(iconEl('items', p.itemId, {
        size: '20px', def, fallback: def?.emoji || '📦',
      }));
      createEl('span', {
        class: ['state-name'],
        text: `${def?.name || p.itemId}：${def?.description || '（无描述）'}`,
        parent: row,
      });
    }

    if (states.length === 0 && placed.length === 0) {
      createEl('div', {
        style: { padding: '8px 4px', color: '#b0a090', fontSize: '12px', fontStyle: 'italic' },
        text: '（本地块当前没有其他状态）',
        parent: this.bodyWrap,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab —— 单位（外圈：该格上的余默状态；总是显示，空态给提示）
  // ════════════════════════════════════════════════════════════
  _renderUnitTab(tile, gs) {
    const isPlayerHere = gs.player?.x === tile.idx;

    if (!isPlayerHere) {
      createEl('div', {
        style: { padding: '20px 10px', textAlign: 'center', color: '#b0a090', fontSize: '13px' },
        text: '（该地块上无单位）',
        parent: this.bodyWrap,
      });
      return;
    }

    const header = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: '700', color: '#3a2e20', marginBottom: '10px' },
      parent: this.bodyWrap,
    });
    header.appendChild(iconEl('ui', 'player', {
      def: CHARACTERS?.yumo, fallback: CHARACTERS?.yumo?.emoji || '🧑‍🎤', size: '24px',
    }));
    createEl('span', { text: '余默', parent: header });

    const p = gs.player;
    const stats = [
      ['❤️ 生命',   `${p.hp} / ${p.maxHp}`],
      ['⚔️ 攻击',   `${p.atk}`],
      ['🔷 行动力', `${p.stamina} / ${p.maxStamina}`],
      ['🪙 金币',   `${p.gold}`],
      ['🕐 回合计',  `${gs.turn}`],
      ['📅 天数',    `${gs.day}`],
    ];
    for (const [label, value] of stats) {
      const row = createEl('div', { class: ['player-info-row'], parent: this.bodyWrap });
      createEl('span', { class: ['stat-label'], text: label, parent: row });
      createEl('span', { class: ['stat-value'], text: value, parent: row });
    }

    // 当前状态（数值属性之外的 buff / debuff），每条一行文字
    const buffs = gs.activeBuffs || [];
    for (const b of buffs) {
      const def = getBuff(b.id);
      const remain = (b.remainingDays !== undefined && b.remainingDays !== null)
        ? `（剩 ${b.remainingDays} 天）`
        : (b.remainingTurns !== undefined ? `（剩 ${b.remainingTurns} 回合）` : '');
      createEl('div', {
        style: { fontSize: '13px', color: '#3a2e20', padding: '4px 0', borderTop: '1px dashed #d4c4a4' },
        text: `${def?.emoji || '❓'} ${def?.name || b.id}${remain}：${def?.description || ''}`,
        parent: this.bodyWrap,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab —— 祈福（按钮 + 消耗提示 + BlessSystem.blessStart → BlessAnimation → blessCommit）
  // ════════════════════════════════════════════════════════════
  _renderBlessTab() {
    const gs = this._getGS();
    const blessing = !!(gs?.uiState?.blessing);
    const canBless = !blessing
      && gs.player.stamina >= BLESS_STAMINA_COST
      && gs.player.gold >= BLESS_GOLD_COST;

    // 动态读取当前队伍的精灵
    const spiritId = gs?.team?.groups?.[gs?.team?.activeGroup ?? 0]?.spirit;
    const spirit = spiritId ? SPIRITS[spiritId] : SPIRITS.momo;
    const spiritEmoji = spirit?.emoji || '👻';
    const spiritName = spirit?.name || 'momo';

    createEl('div', {
      style: { fontSize: '15px', color: '#3a2e20', lineHeight: '1.6', marginBottom: '8px' },
      text: blessing
        ? `✨ ${spiritName} 正在为你挑选福地… 抽奖动画进行中`
        : `${spiritName} 会随机为 1 格添加祝福`,
      parent: this.bodyWrap,
    });

    // 当前精灵效果描述（祈福具体效果）
    if (spirit?.description) {
      createEl('div', {
        style: {
          padding: '6px 8px', marginTop: '4px', marginBottom: '8px',
          background: 'rgba(255, 240, 180, 0.6)', borderLeft: '3px solid #e8a900',
          borderRadius: '4px', fontSize: '12px', color: '#5a4a3a', lineHeight: '1.5',
        },
        text: `${spiritEmoji} ${spiritName} 的效果：${spirit.description}`,
        parent: this.bodyWrap,
      });
    }

    createEl('div', {
      style: { fontSize: '13px', color: '#8a6a3a', marginBottom: '14px' },
      text: `消耗：${BLESS_STAMINA_COST} 🔷 + ${BLESS_GOLD_COST} 🪙 · 快捷键：空格`,
      parent: this.bodyWrap,
    });

    // 功能选项："请【xxx】帮忙"
    createEl('button', {
      class: ['bless-btn'],
      style: { width: '100%' },
      text: blessing ? '✨ 抽奖中…' : `${spiritEmoji} 请【${spiritName}】帮忙`,
      disabled: !canBless,
      parent: this.bodyWrap,
      onclick: () => {
        const gsRef = this._getGS();
        BlessSystem.blessStart(gsRef);
      },
    });

    if (blessing) {
      createEl('div', {
        style: { marginTop: '10px', fontSize: '12px', color: '#5a4a3a', textAlign: 'center', fontStyle: 'italic' },
        text: '（扣消耗已锁定，请耐心等待抽奖结束）',
        parent: this.bodyWrap,
      });
    } else if (!canBless) {
      const reasons = [];
      if (gs.player.stamina < BLESS_STAMINA_COST) reasons.push('行动力不足');
      if (gs.player.gold < BLESS_GOLD_COST) reasons.push('金币不足');
      createEl('div', {
        style: { marginTop: '10px', fontSize: '12px', color: '#c0392b', textAlign: 'center' },
        text: `⚠️ ${reasons.join(' · ')}`,
        parent: this.bodyWrap,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 栅栏内地块 —— 地块内容 tab（第一行图标+名字；地形 + 地形量 + 物品）
  // ════════════════════════════════════════════════════════════
  _renderFenceContentTab(cell, gs) {
    const TERRAIN_NAMES = {
      terrain_none: '无地形', terrain_grass: '草地', terrain_water: '水面', terrain_ice: '冰面',
      none: '无地形', grass: '草地', water: '水面', mud: '无地形',
    };

    // 第一行：左图标（地形）右名字
    const titleRow = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '17px', fontWeight: '700', color: '#3a2e20', marginBottom: '10px' },
      parent: this.bodyWrap,
    });
    const tId = normTerrain(cell.terrain);
    titleRow.appendChild(iconEl('terrains', tId, {
      size: '30px',
      fallback: Assets.getEmoji('terrains', cell.terrain || 'terrain_none'),
    }));
    const terrainName = TERRAIN_NAMES[cell.terrain] || cell.terrain || '空地';
    createEl('span', { text: `${terrainName} · 栅栏内 (${cell.row}, ${cell.col})`, parent: titleRow });

    // terrain amount
    if (cell.terrain && normTerrain(cell.terrain) !== 'terrain_none') {
      createEl('div', {
        style: { fontSize: '13px', color: '#888', marginBottom: '6px' },
        text: `储量：${cell.terrainAmount ?? 0}`,
        parent: this.bodyWrap,
      });
    }

    // items
    if (cell.items && cell.items.length > 0) {
      createEl('div', {
        style: { marginTop: '8px', fontSize: '14px', fontWeight: '700', color: '#3a2e20', marginBottom: '6px' },
        text: '📦 物品堆',
        parent: this.bodyWrap,
      });
      for (const item of cell.items) {
        const def = typeof item === 'string'
          ? (gs.capacity?.friendly?.[item] || gs.capacity?.danger?.[item] || null)
          : null;
        const name = def?.name || item?.name || (typeof item === 'string' ? item : '物品');
        const qty = typeof item === 'object' ? item.qty ?? 1 : 1;
        const row = createEl('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#3a2e20', padding: '2px 0' },
          parent: this.bodyWrap,
        });
        row.appendChild(typeof item === 'string'
          ? iconEl('items', item, { size: '18px', def, fallback: def?.emoji || '📦' })
          : iconEl('items', item?.id || '', { size: '18px', def: item, fallback: '📦' }));
        createEl('span', { text: `${name} ×${qty}`, parent: row });
      }
    }

    if ((!cell.items || cell.items.length === 0) && (!cell.terrain || normTerrain(cell.terrain) === 'terrain_none')) {
      createEl('div', {
        style: { color: '#999', fontSize: '12px', fontStyle: 'italic', marginTop: '8px' },
        text: '（空地，可放置地形或建筑）',
        parent: this.bodyWrap,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 栅栏内地块 —— 状态 tab（地形（含"无地形"）+ 储量）
  // ════════════════════════════════════════════════════════════
  _renderFenceStateTab(cell, gs) {
    const tId = normTerrain(cell.terrain);
    const TERRAIN_NAMES = {
      terrain_none: '无地形', terrain_grass: '草地', terrain_water: '水面', terrain_ice: '冰面',
      none: '无地形', grass: '草地', water: '水面', mud: '无地形',
    };
    const terrainName = TERRAIN_NAMES[cell.terrain] || cell.terrain || '无地形';

    const row = createEl('div', { class: ['state-row'], parent: this.bodyWrap });
    row.appendChild(iconEl('terrains', tId, {
      size: '20px',
      fallback: Assets.getEmoji('terrains', cell.terrain || 'terrain_none'),
    }));
    createEl('span', {
      class: ['state-name'],
      text: tId === 'terrain_none'
        ? '无地形：可在此放置地形或建筑'
        : `${terrainName}：储量 ${cell.terrainAmount ?? 0}`,
      parent: row,
    });

    createEl('div', {
      style: { padding: '8px 4px', color: '#b0a090', fontSize: '12px', fontStyle: 'italic' },
      text: '（本地块当前没有其他状态）',
      parent: this.bodyWrap,
    });
  }

  // ════════════════════════════════════════════════════════════
  // 栅栏内地块 —— 单位 tab（头像 + 血条网格 → 点击进入生物详情页）
  // ════════════════════════════════════════════════════════════
  _renderFenceUnitsTab(cell, gs) {
    const creatureIds = cell.creatures || [];

    // 详情页视图（本面板内切换，不新建面板）
    if (this.creatureDetailId) {
      const c = gs.creatures?.find(x => x.id === this.creatureDetailId && creatureIds.includes(x.id));
      if (c) {
        this._renderCreatureDetail(c, gs);
        return;
      }
      this.creatureDetailId = null; // 已不在该格 → 回列表
    }

    if (creatureIds.length === 0) {
      createEl('div', {
        style: { padding: '20px 10px', textAlign: 'center', color: '#b0a090', fontSize: '13px', fontStyle: 'italic' },
        text: '（此格暂无生物）',
        parent: this.bodyWrap,
      });
      return;
    }

    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#3a2e20', marginBottom: '8px' },
      text: `生物列表（${creatureIds.length}）· 点击查看详情`,
      parent: this.bodyWrap,
    });

    const grid = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
        gap: '8px',
      },
      parent: this.bodyWrap,
    });

    for (const id of creatureIds) {
      const c = gs.creatures?.find(x => x.id === id);
      if (!c) continue;
      const def = getCreatureDef?.(c.kind) || {};
      const card = createEl('div', {
        style: {
          padding: '8px 6px',
          border: '2px solid #d4c4a4', borderRadius: '8px',
          backgroundColor: 'rgba(255,250,230,0.6)',
          textAlign: 'center', cursor: 'pointer',
        },
        attrs: { title: def.name || c.kind },
        parent: grid,
        onclick: () => {
          this.creatureDetailId = c.id;
          this.creatureSubTab = 'stats';
          this._renderBody();
        },
      });
      // 头像（iconEl：PNG 优先，回退数据 emoji）
      card.appendChild(iconEl('creatures', c.kind, {
        def, size: '36px', fallback: def.emoji || '🐾',
      }));
      // 血条（小横条）
      const maxHp = c.maxHp || c.hp || 1;
      const pct = Math.max(0, Math.min(100, Math.round(((c.hp ?? 0) / maxHp) * 100)));
      const barOuter = createEl('div', {
        style: {
          width: '100%', height: '6px', marginTop: '6px',
          background: '#e0d5c0', borderRadius: '3px', overflow: 'hidden',
        },
        parent: card,
      });
      createEl('div', {
        style: {
          width: `${pct}%`, height: '100%',
          background: pct > 50 ? '#7cb342' : (pct > 25 ? '#e8a900' : '#c0392b'),
        },
        parent: barOuter,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 生物详情页（InfoPanel 内部视图切换）
  //   左上角返回箭头 → 回该格全部生物列表
  //   子 tab：数值 / 技能 / 状态
  // ════════════════════════════════════════════════════════════
  _renderCreatureDetail(c, gs) {
    const def = getCreatureDef?.(c.kind) || {};

    // 顶行：返回箭头（左上角）+ 头像 + 名字
    const top = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
      parent: this.bodyWrap,
    });
    createEl('button', {
      class: 'action-btn',
      style: { padding: '2px 12px', fontSize: '14px', flexShrink: '0' },
      text: '←',
      attrs: { title: '返回生物列表' },
      parent: top,
      onclick: () => {
        this.creatureDetailId = null;
        this._renderBody();
      },
    });
    top.appendChild(iconEl('creatures', c.kind, {
      def, size: '26px', fallback: def.emoji || '🐾',
    }));
    createEl('span', {
      style: { fontSize: '16px', fontWeight: '700', color: '#3a2e20' },
      text: def.name || c.kind,
      parent: top,
    });

    // 子 tab 条
    const subTabs = [
      { key: 'stats', label: '数值' },
      { key: 'skills', label: '技能' },
      { key: 'states', label: '状态' },
    ];
    const bar = createEl('div', {
      style: { display: 'flex', gap: '8px', marginBottom: '10px' },
      parent: this.bodyWrap,
    });
    for (const t of subTabs) {
      const active = this.creatureSubTab === t.key;
      createEl('button', {
        class: active ? ['tab-btn', 'active'] : ['tab-btn'],
        style: { flex: '1', padding: '4px 8px', fontSize: '12px' },
        text: t.label,
        parent: bar,
        onclick: () => {
          this.creatureSubTab = t.key;
          this._renderBody();
        },
      });
    }

    if (this.creatureSubTab === 'stats') {
      // 数值：只显示该生物数据里存在的字段（没有的不写）
      const rows = [];
      if (typeof c.atk === 'number') rows.push(['⚔️ 攻击力', `${c.atk}`]);
      if (typeof c.hp === 'number') rows.push(['❤️ 生命', `${c.hp} / ${c.maxHp ?? c.hp}`]);
      if (typeof c.growth === 'number' && c.growthMax > 0) rows.push(['🌱 成长值', `${c.growth} / ${c.growthMax}`]);
      if (typeof c.mood === 'number') rows.push(['😊 心情', `${c.mood}`]);
      rows.push(['📂 种类', `${def.name || c.kind}（${CATEGORY_NAMES[c.category] || c.category || '未知'}）`]);
      for (const [label, value] of rows) {
        const row = createEl('div', { class: ['player-info-row'], parent: this.bodyWrap });
        createEl('span', { class: ['stat-label'], text: label, parent: row });
        createEl('span', { class: ['stat-value'], text: value, parent: row });
      }
    } else if (this.creatureSubTab === 'skills') {
      // 技能：技能名 + 描述（当前生物数据无技能字段 → 空态提示）
      createEl('div', {
        style: { padding: '20px 10px', textAlign: 'center', color: '#b0a090', fontSize: '13px', fontStyle: 'italic' },
        text: '（该生物暂无技能）',
        parent: this.bodyWrap,
      });
    } else {
      // 状态：当前 buff/debuff（无则空态提示）
      const buffs = c.activeBuffs || [];
      if (buffs.length === 0) {
        createEl('div', {
          style: { padding: '20px 10px', textAlign: 'center', color: '#b0a090', fontSize: '13px', fontStyle: 'italic' },
          text: '（当前没有 buff / debuff）',
          parent: this.bodyWrap,
        });
      } else {
        for (const b of buffs) {
          const bDef = getBuff(b.id);
          const remain = (b.remainingDays !== undefined && b.remainingDays !== null)
            ? `（剩 ${b.remainingDays} 天）`
            : (b.remainingTurns !== undefined ? `（剩 ${b.remainingTurns} 回合）` : '');
          createEl('div', {
            style: { fontSize: '13px', color: '#3a2e20', padding: '4px 0', borderBottom: '1px dashed #d4c4a4' },
            text: `${bDef?.emoji || '❓'} ${bDef?.name || b.id}${remain}：${bDef?.description || ''}`,
            parent: this.bodyWrap,
          });
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 事件订阅
  // ════════════════════════════════════════════════════════════
  /** 选中指定 idx 的 tile（公开接口） */
  selectTile(tileIdx) {
    this.mode = 'tile';
    this.currentTileIdx = tileIdx;
    this.creatureDetailId = null;
    this._renderBody();
  }

  /** 切到祈福模式（供 SpiritArea 点击 momo 调用） */
  showBlessTab() {
    this.mode = 'bless';
    this.currentTileIdx = null;
    this.creatureDetailId = null;
    this._renderBody();
  }

  _subscribeEvents() {
    EventBus.on(GE.TILE_CLICKED, ({ tileIdx }) => {
      this.mode = 'tile';
      this.currentTileIdx = tileIdx;
      this.currentFenceIdx = null;
      this.creatureDetailId = null;
      this._renderBody();
    });

    EventBus.on(GE.FENCE_TILE_CLICKED, ({ fenceIdx }) => {
      this.mode = 'fence';
      this.currentFenceIdx = fenceIdx;
      this.currentTileIdx = null;
      this.creatureDetailId = null;
      this._renderBody();
    });

    // 建造模式下 InfoPanel 完全隐藏（§16.14：不滑出、不 emit）
    EventBus.on(GE.UI_MODE_CHANGE, ({ mode }) => {
      if (!this.root) return;
      this.root.style.display = mode === 'build' ? 'none' : '';
      if (mode === 'build') this.slideOut();
    });

    // 面板栈接线：GameDirector 中央逻辑打开其他面板时会发 CLOSE 'info' → 向右滑出
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel !== 'info') return;
      if (this._getGS()?.buildMode === true) return; // §16.14：建造模式下面板已隐藏，不滑出
      this._hideSelf(false);
    });

    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.currentGs = gs;
      if (this.currentTileIdx !== null || this.mode === 'bless') this._renderBody();
    });

    EventBus.on(GE.TILE_UPDATED, (payload = {}) => {
      const { tileIdx } = payload;
      if (tileIdx !== undefined && tileIdx !== null && tileIdx === this.currentTileIdx) {
        this._renderBody();
      }
    });

    EventBus.on(GE.BLESS_START, () => {
      this._renderBody();
    });

    EventBus.on(GE.BLESS_DONE, ({ tileIdx }) => {
      if (tileIdx !== undefined && tileIdx !== null) {
        this.mode = 'tile';
        this.currentTileIdx = tileIdx;
        this._renderBody();
      }
    });

    EventBus.on(GE.STAMINA_CHANGE, () => {
      this._renderBody();
    });
    EventBus.on(GE.GOLD_CHANGE, () => {
      this._renderBody();
    });

    EventBus.on(GE.BOOT, ({ gs }) => {
      this.currentGs = gs;
      this._hideSelf(false);
    });

    EventBus.on(GE.VEHICLE_ATTACH, () => {
      if (this.mode === 'tile' && this.currentTileIdx !== null) this._renderBody();
    });
    EventBus.on(GE.VEHICLE_GAIN, () => {
      if (this.mode === 'tile' && this.currentTileIdx !== null) this._renderBody();
    });

    // 精灵点击 → 祈福模式
    EventBus.on('ui:infoShowBless', () => {
      this.showBlessTab();
    });

    // 点击 InfoPanel 内部 → 不关
    this.root?.addEventListener?.('click', (e) => e.stopPropagation());

    // 点击非 InfoPanel / 非地块 / 非 momo / 非栅栏 → InfoPanel 滑出（§16.4：点空白处向右滑出）
    document.addEventListener('click', (e) => {
      if (this._ignoreDocumentClick) return;
      if (this._getGS()?.buildMode === true) return; // §16.14

      const t = e.target;
      if (!t || !this.root) return;
      if (this.root.contains(t)) return;
      if (t.closest('.map-tile')) return;
      if (t.closest('.fence-tile')) return;
      if (t.closest('.spirit-area')) return;
      if (t.closest('.sprite-container')) return;

      // 其他区域 → 滑出
      this._hideSelf(true);
    });
  }

  _getGS() {
    if (window.__gameDirector && window.__gameDirector.getGS) {
      return window.__gameDirector.getGS();
    }
    return this.currentGs;
  }
}

export default InfoPanel;
