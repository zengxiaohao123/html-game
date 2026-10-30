// src/ui/InfoPanel.js
// Phase 2B 扩展：右侧 4 tab 完整实现
//   Tab 0 地块内容：emoji + 名称 + 地形 + 词条描述 +（资源类）"进入"按钮
//   Tab 1 状态    ：tile.states[] 全部 blessed / buff 行（emoji + 名称 + 剩余天数）
//   Tab 2 单位    ：玩家 hp/stamina/atk/gold（若该格是玩家所在格则高亮显示）
//   Tab 3 祈福    ：按钮"请 momo 帮忙 🧘"（BlessSystem.bless） + 消耗提示
//
// Phase 1 骨架保留，重写 _renderBody 里的 case 1/2/3 分支 + 扩展 case 0。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { Distance } from '../core/Distance.js';
import { BlessSystem, BLESS_STAMINA_COST, BLESS_GOLD_COST } from '../systems/BlessSystem.js';
import { SkillSystem } from '../systems/SkillSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { getDef } from '../data/facilities.js';
import { SKILLS } from '../data/characters.js';
import { SPIRITS } from '../data/characters.js';
import { VEHICLES } from '../data/vehicles.js';
import { VehicleSystem } from '../systems/VehicleSystem.js';
import { getCreatureDef } from '../data/creatures.js';
import { createEl, qs } from './dom.js';

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

  // —— 资源类地块内容 ——
  resource_event: ['【进入时】触发随机事件（Phase 5）'],
  resource_reward: ['【进入时】随机奖励（Phase 5）'],
  resource_hunt:   ['【进入时】进入狩猎（Phase 3）'],
  resource_shop:   ['【进入时】打开商店（Phase 4）'],
  resource_bus:    ['【进入时】行动力 +1、获得 1 轮子'],
};

const TERRAIN_DESCRIPTIONS = {
  terrain_none:      '无地形：可在此放置设施 / 资源 / 技能',
  terrain_grass:     '🟩 草地：10 草元素量，生物可啃食，部分设施产出加成',
  terrain_water:     '🌊 水面：10 水元素量，不阻碍移动，相邻稻田 +2 稻草',
  terrain_ice:       '🧊 冰面：10 冰元素量，徒步进入会被迫向前滑行（载具不受影响）',
  // 旧 id 别名（兼容旧存档）
  none:  '无地形：可在此放置设施 / 资源 / 技能',
  grass: '🟩 草地：10 草元素量',
  water: '🌊 水面：10 水元素量',
  mud:   '无地形',
};

/** 地形 id 归一化（旧存档里可能是 'none' / 'grass'） */
const normTerrain = (v) => (!v ? 'terrain_none' : (TERRAIN_DESCRIPTIONS[v] ? (v.startsWith('terrain_') ? v : 'terrain_' + v) : 'terrain_none'));

/** 状态类型 → emoji + 显示名 */
const STATE_META = {
  blessed:      { emoji: '✨', name: '祝福' },
  tent_bless:   { emoji: '⛺', name: '帐篷祝福（下次睡觉+3）' },
  rice_bless:   { emoji: '🌱', name: '稻田祝福（每日 +1 稻草）' },
  slime_bless:  { emoji: '🟢', name: '史莱姆屋祝福（每日 ×2）' },
  // Phase 3 再扩展 buffs
};

export class InfoPanel {
  constructor() {
    this.root = null;
    this.tabsWrap = null;
    this.bodyWrap = null;
    this.currentTileIdx = null;     // 当前选中的外圈地块 idx（null = 未选中，InfoPanel 滑出）
    this.currentFenceIdx = null;    // 当前选中的栅栏内地块 idx
    this.currentGs = null;
    this.mode = 'tile';             // 'tile' | 'fence' | 'bless'
    this._slideTimeout = null;
  }

  mount(parent = qs('#app')) {
    // 外层：初始 transform: translateX(420px) 滑出屏幕右侧
    this.root = createEl('div', {
      class: ['info-panel'],
      style: {
        position: 'absolute',
        right: '20px',
        top: '100px',
        width: '380px',
        maxHeight: 'calc(100vh - 140px)',
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
        // 滑入滑出动画：transform 过渡 0.3s
        transform: 'translateX(420px)',
        transition: 'transform 0.35s cubic-bezier(0.33, 1, 0.68, 1)',
      },
      parent,
    });

    // tab bar 容器（每次 renderBody 动态重建）
    this.tabsWrap = createEl('div', {
      style: { display: 'flex', gap: '5px', flexShrink: '0', flexWrap: 'wrap' },
      parent: this.root,
    });

    // body 容器
    this.bodyWrap = createEl('div', {
      style: { flex: '1', overflowY: 'auto', minHeight: '60px' },
      parent: this.root,
    });

    this._subscribeEvents();
    return this.root;
  }

  /** 滑入屏幕（有选中内容才会调用） */
  slideIn() {
    if (!this.root) return;
    this.root.style.transform = 'translateX(0)';
  }
  /** 滑出屏幕（隐藏） */
  slideOut() {
    if (!this.root) return;
    this.root.style.transform = 'translateX(420px)';
  }

  /** 根据当前状态重建 tab 按钮条（动态 tab） */
  _rebuildTabs() {
    if (!this.tabsWrap) return;
    // 清空
    while (this.tabsWrap.firstChild) this.tabsWrap.removeChild(this.tabsWrap.firstChild);

    const gs = this._getGS();
    const tile = this.currentTileIdx != null ? gs?.map?.outerTiles?.[this.currentTileIdx] : null;
    const fenceCell = this.currentFenceIdx != null ? gs?.map?.fence?.[this.currentFenceIdx] : null;

    // 根据当前模式决定显示哪些 tab
    const tabs = [];
    if (this.mode === 'bless') {
      // 祈福模式：只显示祈福 tab
      tabs.push({ label: '🧘 祈福', render: 'bless' });
    } else if (this.mode === 'fence') {
      // 栅栏内模式
      tabs.push({ label: '📖 内容', render: 'fenceContent' });
      if (fenceCell?.creatures && fenceCell.creatures.length > 0) {
        tabs.push({ label: '👥 生物', render: 'fenceCreatures' });
      }
    } else {
      // 外圈地块点击模式
      tabs.push({ label: '📖 内容', render: 'content' });

      const hasTileStates = tile && Array.isArray(tile.states) && tile.states.length > 0;
      if (hasTileStates) {
        tabs.push({ label: '✨ 状态', render: 'state' });
      }

      if (tile && gs) {
        const isPlayerHere = gs.player?.x === tile.idx;
        let hasCreatures = false;
        if (gs.map?.fence && typeof tile.fenceRow === 'number' && typeof tile.fenceCol === 'number') {
          const cell = gs.map.fence.cells?.[tile.fenceRow]?.[tile.fenceCol];
          hasCreatures = !!(cell?.creatures && cell.creatures.length > 0);
        }
        if (isPlayerHere || hasCreatures) {
          tabs.push({ label: '👥 单位', render: 'unit' });
        }
      }
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
      const isActive = i === this.activeTabIdx;
      const btn = createEl('button', {
        class: ['info-tab', isActive ? 'active' : ''],
        style: {
          flex: '1', padding: '6px 10px', minWidth: '60px',
          border: '2px solid #b8a888',
          borderRadius: '8px 8px 0 0',
          backgroundColor: isActive ? '#f0e0c0' : 'transparent',
          color: isActive ? '#5a4a3a' : '#888',
          fontWeight: isActive ? '700' : '400',
          fontSize: '13px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: 'none',
        },
        text: t.label,
        parent: this.tabsWrap,
      });
      btn.onclick = () => {
        this.activeTabIdx = i;
        this._renderBody();
      };
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
      this.slideOut();
      return;
    }
    if (this.mode === 'fence' && this.currentFenceIdx === null) {
      this.slideOut();
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
      const fenceCell = gs.map.fence[this.currentFenceIdx];
      if (!fenceCell) {
        this.slideOut();
        return;
      }
      const tabs = this._currentTabs || [];
      const active = tabs[this.activeTabIdx];
      if (!active) { this.activeTabIdx = 0; this._rebuildTabs(); return this._renderBody(); }
      switch (active.render) {
        case 'fenceContent':   this._renderFenceContentTab(fenceCell, gs); break;
        case 'fenceCreatures': this._renderFenceCreaturesTab(fenceCell, gs); break;
      }
      return;
    }

    // 外圈地块模式
    const tile = gs.map.outerTiles[this.currentTileIdx];
    if (!tile) {
      this.slideOut();
      return;
    }

    const tabs = this._currentTabs || [];
    const active = tabs[this.activeTabIdx];
    if (!active) { this.activeTabIdx = 0; this._rebuildTabs(); return this._renderBody(); }

    switch (active.render) {
      case 'content': this._renderContentTab(tile, gs); break;
      case 'state':   this._renderStateTab(tile); break;
      case 'unit':    this._renderUnitTab(tile, gs); break;
      case 'bless':   this._renderBlessTab(); break;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab 0 —— 地块内容（emoji + 名称 + 词条 + 地形 + 进入按钮 + 前往按钮）
  // ════════════════════════════════════════════════════════════
  _renderContentTab(tile, gs) {
    const titleRow = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        fontSize: '20px', fontWeight: '700', color: '#5a4a3a', marginBottom: '12px',
      },
      parent: this.bodyWrap,
    });

    let icon, name, descriptions;
    const contentId = tile.contentId;
    if (contentId) {
      if (contentId.startsWith('skill_')) {
        // 技能卡地块：从 SKILLS 查中文名
        const sk = SKILLS[contentId];
        icon = sk?.emoji || '⚡';
        name = sk?.name || contentId;
        descriptions = sk?.description ? [sk.description] : ['（词条未配置）'];
      } else {
        icon = Assets.getEmoji(contentId.startsWith('resource_') ? 'resources' : 'facilities', contentId);
        const def = getDef(contentId);
        name = (def && def.name) || contentId;
        descriptions = FACILITY_DESCRIPTIONS[contentId] || ['（词条未配置）'];
      }
    } else {
      icon = Assets.getEmoji('terrains', tile.terrain || 'terrain_none');
      name = (TERRAIN_DESCRIPTIONS[tile.terrain || 'terrain_none'] || '空地').split('：')[0];
      descriptions = [TERRAIN_DESCRIPTIONS[tile.terrain || 'terrain_none'] || '可在此建造设施'];
    }

    createEl('span', {
      text: icon,
      style: {
        fontSize: '32px', lineHeight: '1', display: 'inline-block',
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      },
      parent: titleRow,
    });
    createEl('span', { text: name, parent: titleRow });

    // 地形提示
    if (tile.terrain && normTerrain(tile.terrain) !== 'terrain_none') {
      createEl('div', {
        style: { fontSize: '13px', color: '#8a6a3a', marginBottom: '8px' },
        text: `地形：${Assets.getEmoji('terrains', tile.terrain)} ${tile.terrain}`,
        parent: this.bodyWrap,
      });
    }

    // 词条描述（每条一条）
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
      const tile = gs.map.outerTiles[tileIdx];
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
            const range = createEl('input', {
              attrs: { type: 'range', min: 0, max: stored, value: stored, step: 1 },
              style: { width: '100%' },
              parent: this.bodyWrap,
            });
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
            const range = createEl('input', {
              attrs: { type: 'range', min: 0, max: stored, value: stored, step: 1 },
              style: { width: '100%' },
              parent: this.bodyWrap,
            });
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
          // 🐔 鸡舍：onTile 时显示鸡蛋滑动条；随时显示开门/关门
          const stored = tile.contentState?.eggStored ?? 0;
          const doorOpen = tile.contentState?.doorOpen ?? true;
          if (onTile) {
            createEl('div', {
              style: { fontSize: '12px', color: '#666', marginBottom: '6px' },
              text: `🥚 已储存 ${stored} / 10`,
              parent: this.bodyWrap,
            });
            const range = createEl('input', {
              attrs: { type: 'range', min: 0, max: stored, value: stored, step: 1 },
              style: { width: '100%' },
              parent: this.bodyWrap,
            });
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
          } else {
            createEl('div', {
              style: { fontSize: '12px', color: '#aaa', textAlign: 'center', margin: '6px 0' },
              text: `（走到该格可收获 🥚 ${stored}/10）`,
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

    // 资源类地块 / 技能卡地块 —— "进入/使用" 按钮（Phase 4）
    if (contentId && (contentId.startsWith('resource_') || contentId.startsWith('skill_'))) {
      createEl('div', {
        style: { marginTop: '12px', textAlign: 'center' },
        parent: this.bodyWrap,
      });

      if (contentId === 'resource_shop') {
        createEl('button', {
          class: 'action-btn',
          style: { fontSize: '14px' },
          text: '🏪 进入商店',
          parent: this.bodyWrap,
          onclick: () => EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx: tile.idx }),
        });
      } else if (contentId === 'resource_magic_shop') {
        createEl('button', {
          class: 'action-btn',
          style: { fontSize: '14px' },
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
            style: { fontSize: '14px', background: '#ffe099' },
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
      // 其他 resource_ 前缀（resource_bus / resource_bed / ...）— 设计文档均无功能选项，词条自动触发
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
          style: { fontSize: '14px', background: '#fff0c0' },
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
              const directorObj = window.__gameDirector;
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

    // 位置提示（调试用）
    createEl('div', {
      style: { marginTop: '10px', fontSize: '12px', color: '#aaa' },
      text: `tile idx = ${tile.idx} · 地形 = ${tile.terrain}`,
      parent: this.bodyWrap,
    });
  }

  // ════════════════════════════════════════════════════════════
  // Tab 1 —— 状态（tile.states[] 里的 blessed / 其他）
  // ════════════════════════════════════════════════════════════
  _renderStateTab(tile) {
    const states = (tile.states || []).slice();
    if (states.length === 0) {
      createEl('div', {
        style: { padding: '40px 20px', textAlign: 'center', color: '#b0a090', fontSize: '14px' },
        text: '（该地块当前没有任何状态）',
        parent: this.bodyWrap,
      });
      return;
    }
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
  }

  // ════════════════════════════════════════════════════════════
  // Tab —— 单位（只显示该地块上的单位，不是场上所有）
  //   外圈：player.x === tile.idx 才显示主角
  //   栅栏内：一格可能多生物（CreatureSystem 存 fenceRow/Col）
  // ════════════════════════════════════════════════════════════
  _renderUnitTab(tile, gs) {
    const isPlayerHere = gs.player?.x === tile.idx;

    if (isPlayerHere) {
      createEl('div', {
        style: { fontSize: '16px', fontWeight: '700', color: '#3a2e20', marginBottom: '10px' },
        text: '🧑‍🎤 余默',
        parent: this.bodyWrap,
      });
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
    }

    // 栅栏内生物：读 fence.cells[row][col].creatures[]
    const hasFenceCell = gs.map?.fence
      && typeof tile.fenceRow === 'number'
      && typeof tile.fenceCol === 'number';
    if (hasFenceCell) {
      const cell = gs.map.fence.cells?.[tile.fenceRow]?.[tile.fenceCol];
      const creatureIds = cell?.creatures || [];
      if (creatureIds.length > 0) {
        if (isPlayerHere) {
          // 主角和栅栏生物都在同一格（理论上不会发生，外圈格不在栅栏内）
          createEl('div', {
            style: { marginTop: '16px', borderTop: '2px dashed #b8a888', paddingTop: '10px' },
            parent: this.bodyWrap,
          });
        }
        createEl('div', {
          style: { fontSize: '14px', color: '#3a2e20', fontWeight: '700', marginBottom: '8px' },
          text: `🐣 栅栏内生物（${creatureIds.length}）`,
          parent: this.bodyWrap,
        });
        // 从 gs.creatures 找完整对象
        for (const id of creatureIds) {
          const c = gs.creatures?.find(x => x.id === id);
          if (!c) continue;
          const def = getCreatureDef?.(c.kind) || {};
          const emoji = def.emoji || '🐾';
          createEl('div', {
            style: { fontSize: '13px', color: '#3a2e20', padding: '3px 0' },
            text: `${emoji} ${def.name || c.kind} · ❤️${c.hp}/${c.maxHp} · ⚔️${c.atk}`,
            parent: this.bodyWrap,
          });
        }
      }
    }

    if (!isPlayerHere && !hasFenceCell) {
      createEl('div', {
        style: { color: '#999', fontSize: '13px' },
        text: '（该地块上无单位）',
        parent: this.bodyWrap,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab 3 —— 祈福（按钮 + 消耗提示 + BlessSystem.blessStart → BlessAnimation → blessCommit）
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

    // 当前精灵效果描述
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

    createEl('button', {
      class: ['bless-btn'],
      style: { width: '100%' },
      text: blessing ? '✨ 抽奖中…' : `${spiritEmoji} 请${spiritName}帮忙`,
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
  // 栅栏内地块 —— 内容 tab（terrain + 地形量 + 物品）
  // ════════════════════════════════════════════════════════════
  _renderFenceContentTab(cell, gs) {
    const TERRAIN_NAMES = {
      terrain_none: '无地形', terrain_grass: '草地', terrain_water: '水面', terrain_ice: '冰面',
      none: '无地形', grass: '草地', water: '水面', mud: '无地形',
    };
    const TERRAIN_EMOJI = {
      terrain_none: '⬜', terrain_grass: '🟩', terrain_water: '🌊', terrain_ice: '🧊',
      none: '⬜', grass: '🟩', water: '🌊', mud: '⬜',
    };

    // 标题
    createEl('div', {
      style: { fontSize: '15px', fontWeight: '700', color: '#3a2e20', marginBottom: '8px' },
      text: `🏡 栅栏内 (${cell.row}, ${cell.col})`,
      parent: this.bodyWrap,
    });

    // terrain
    const terrainName = TERRAIN_NAMES[cell.terrain] || cell.terrain || '空地';
    const terrainEmoji = TERRAIN_EMOJI[cell.terrain] || '⬜';
    createEl('div', {
      style: { fontSize: '14px', color: '#3a2e20', marginBottom: '6px' },
      text: `${terrainEmoji} 地形：${terrainName}`,
      parent: this.bodyWrap,
    });

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
        const emoji = def?.emoji || '📦';
        const qty = typeof item === 'object' ? item.qty ?? 1 : 1;
        createEl('div', {
          style: { fontSize: '13px', color: '#3a2e20', padding: '2px 0' },
          text: `${emoji} ${name} ×${qty}`,
          parent: this.bodyWrap,
        });
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
  // 栅栏内地块 —— 生物 tab
  // ════════════════════════════════════════════════════════════
  _renderFenceCreaturesTab(cell, gs) {
    const creatureIds = cell.creatures || [];
    if (creatureIds.length === 0) {
      createEl('div', {
        style: { color: '#999', fontSize: '13px', fontStyle: 'italic' },
        text: '（此格暂无生物）',
        parent: this.bodyWrap,
      });
      return;
    }

    createEl('div', {
      style: { fontSize: '15px', fontWeight: '700', color: '#3a2e20', marginBottom: '10px' },
      text: `🐣 生物列表（${creatureIds.length}）`,
      parent: this.bodyWrap,
    });

    for (const id of creatureIds) {
      const c = gs.creatures?.find(x => x.id === id);
      if (!c) continue;
      const def = getCreatureDef?.(c.kind) || {};
      const emoji = def.emoji || '🐾';
      const name = def.name || c.kind;

      const wrap = createEl('div', {
        style: {
          padding: '8px', marginBottom: '6px',
          border: '2px solid #d4c4a4', borderRadius: '8px',
          backgroundColor: 'rgba(255,250,230,0.6)',
        },
        parent: this.bodyWrap,
      });

      createEl('div', {
        style: { fontSize: '14px', fontWeight: '700', color: '#3a2e20' },
        text: `${emoji} ${name}`,
        parent: wrap,
      });

      // 生命 / 攻击
      if (typeof c.hp === 'number') {
        createEl('div', {
          style: { fontSize: '12px', color: '#666', marginTop: '2px' },
          text: `❤️ ${c.hp}/${c.maxHp ?? c.hp}${typeof c.atk === 'number' ? ` · ⚔️ ${c.atk}` : ''}`,
          parent: wrap,
        });
      }

      // 特殊 tag
      if (c.age !== undefined) {
        createEl('div', {
          style: { fontSize: '11px', color: '#999', marginTop: '2px' },
          text: `年龄：${c.age} · 状态：${c.alive !== false ? '存活' : '死亡'}`,
          parent: wrap,
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 事件订阅（保留 Phase 1 骨架 + 补充 BLESS_DONE / GOLD_CHANGE / STAMINA_CHANGE 刷新）
  // ════════════════════════════════════════════════════════════
  /** 选中指定 idx 的 tile（公开接口） */
  selectTile(tileIdx) {
    this.mode = 'tile';
    this.currentTileIdx = tileIdx;
    this._renderBody();
  }

  /** 切到祈福模式（供 SpiritArea 点击 momo 调用） */
  showBlessTab() {
    this.mode = 'bless';
    this.currentTileIdx = null;
    this._renderBody();
  }

  _subscribeEvents() {
    EventBus.on(GE.TILE_CLICKED, ({ tileIdx }) => {
      this.mode = 'tile';
      this.currentTileIdx = tileIdx;
      this.currentFenceIdx = null;
      this._renderBody();
    });

    EventBus.on(GE.FENCE_TILE_CLICKED, ({ fenceIdx }) => {
      this.mode = 'fence';
      this.currentFenceIdx = fenceIdx;
      this.currentTileIdx = null;
      this._renderBody();
    });

    // 建造模式下 InfoPanel 完全隐藏
    EventBus.on(GE.UI_MODE_CHANGE, ({ mode }) => {
      if (!this.root) return;
      this.root.style.display = mode === 'build' ? 'none' : '';
      if (mode === 'build') this.slideOut();
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
      this.slideOut();
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

    // 点击非 InfoPanel / 非地块 / 非 momo / 非栅栏 → InfoPanel 滑出
    document.addEventListener('click', (e) => {
      if (this._ignoreDocumentClick) return;
      if (this.currentGs?.uiState?.buildMode) return;

      const t = e.target;
      if (!t || !this.root) return;
      if (this.root.contains(t)) return;
      if (t.closest('.map-tile')) return;
      if (t.closest('.fence-tile')) return;
      if (t.closest('.spirit-area')) return;
      if (t.closest('.sprite-container')) return;

      // 其他区域 → 滑出
      this.currentTileIdx = null;
      this.currentFenceIdx = null;
      this.mode = 'tile';
      this.slideOut();
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
