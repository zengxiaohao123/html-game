// src/ui/InfoPanel.js
// 右侧信息区：380px 宽、4 tab（地块内容 / 状态 / 单位 / 祈福）
// Phase 1 骨架：
//   - 点击地块 tile（GE.TILE_CLICKED）时显示该地块的词条
//   - Phase 1 只完整实现"地块内容"tab（home 和 wheat 有词条）
//   - 其他 3 个 tab 先用"即将推出"占位，Phase 2+ 再补
//   - 面板固定定位在 right:20px top:100px，点击无 tile 时隐藏或空状态

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

/** Phase 1 设施词条文本（phase 1 只有 home 和 wheat 会显示） */
const FACILITY_DESCRIPTIONS = {
  facility_home: [
    '【经过时】获得 1 金币（每天限 1 次）',
    '【进入时】获得 1 金币（每天限 1 次）',
    '【睡觉时】行动力回满',
  ],
  facility_wheat: [
    '【每日开始】产出 2 小麦到背包',
  ],
};

const TERRAIN_DESCRIPTIONS = {
  none: '空地块：可建造设施',
  grass: '🟩 草地：鸡走过消耗草元素量',
  water: '🌊 水面：稻田相邻加稻草',
  mud: '🟤 泥地：史莱姆粘液喷吐',
};

export class InfoPanel {
  constructor() {
    this.root = null;        // 整个面板
    this.tabsWrap = null;    // tab 按钮容器
    this.tabs = [];          // tab DOM 数组
    this.bodyWrap = null;    // body 容器（tab 内容在这里切换）
    this.activeTab = 0;      // 0=地块内容 1=状态 2=单位 3=祈福
    this.currentTileIdx = null;
    this.currentGs = null;
  }

  mount(parent = qs('#app')) {
    // 面板外层
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
      },
      parent,
    });

    // 4 tab 按钮
    const tabs = ['地块内容', '状态', '单位', '祈福'];
    this.tabsWrap = createEl('div', {
      style: {
        display: 'flex',
        gap: '5px',
        flexShrink: '0',
      },
      parent: this.root,
    });
    this.tabs = [];
    tabs.forEach((label, i) => {
      const tab = createEl('button', {
        class: ['info-tab', i === 0 ? 'active' : ''],
        style: {
          flex: '1',
          padding: '6px 10px',
          border: '2px solid #b8a888',
          borderRadius: '8px 8px 0 0',
          backgroundColor: i === 0 ? '#f0e0c0' : 'transparent',
          color: i === 0 ? '#5a4a3a' : '#888',
          fontWeight: i === 0 ? '700' : '400',
          fontSize: '14px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: 'none',
        },
        text: label,
        onclick: () => this._switchTab(i),
        parent: this.tabsWrap,
      });
      this.tabs.push(tab);
    });

    // body 容器（tab 切换在这里渲染内容）
    this.bodyWrap = createEl('div', {
      style: {
        flex: '1',
        overflowY: 'auto',
        minHeight: '60px',
      },
      parent: this.root,
    });

    // 订阅事件
    this._subscribeEvents();

    return this.root;
  }

  /** 切换 tab */
  _switchTab(idx) {
    this.activeTab = idx;
    this.tabs.forEach((t, i) => {
      if (i === idx) {
        t.classList.add('active');
        t.style.backgroundColor = '#f0e0c0';
        t.style.color = '#5a4a3a';
        t.style.fontWeight = '700';
      } else {
        t.classList.remove('active');
        t.style.backgroundColor = 'transparent';
        t.style.color = '#888';
        t.style.fontWeight = '400';
      }
    });
    // 重新渲染 body
    this._renderBody();
  }

  /** 渲染当前 tab 内容 */
  _renderBody() {
    if (!this.bodyWrap) return;
    while (this.bodyWrap.firstChild) this.bodyWrap.removeChild(this.bodyWrap.firstChild);

    const gs = this.currentGs;
    const tileIdx = this.currentTileIdx;

    if (!gs || tileIdx === null) {
      createEl('div', {
        style: { padding: '20px', textAlign: 'center', color: '#999', fontSize: '14px' },
        text: '点击地图上的地块查看详情',
        parent: this.bodyWrap,
      });
      return;
    }

    const tile = gs.map.outerTiles[tileIdx];

    switch (this.activeTab) {
      case 0: this._renderContentTab(tile); break;
      case 1: this._renderPlaceholderTab('状态（Phase 2）'); break;
      case 2: this._renderPlaceholderTab('单位（Phase 3）'); break;
      case 3: this._renderPlaceholderTab('祈福（Phase 2）'); break;
    }
  }

  /** 渲染"地块内容"tab —— Phase 1 完整实现 */
  _renderContentTab(tile) {
    // 标题行：emoji + 设施名
    const titleRow = createEl('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '20px',
        fontWeight: '700',
        color: '#5a4a3a',
        marginBottom: '12px',
      },
      parent: this.bodyWrap,
    });

    let icon, name, descriptions;
    if (tile.contentId) {
      icon = Assets.getEmoji('facilities', tile.contentId);
      // 名字：直接从 contentId 推
      const nameMap = { facility_home: '家', facility_tent: '帐篷', facility_wheat: '麦田' };
      name = nameMap[tile.contentId] || tile.contentId;
      descriptions = FACILITY_DESCRIPTIONS[tile.contentId] || ['（Phase 2 补全词条）'];
    } else {
      // 空 tile：显示地形
      icon = Assets.getEmoji('terrains', tile.terrain || 'none');
      const terrainMap = { none: '空地', grass: '草地', water: '水面', mud: '泥地' };
      name = terrainMap[tile.terrain || 'none'] || '空地';
      descriptions = [TERRAIN_DESCRIPTIONS[tile.terrain || 'none'] || '可在此建造设施'];
    }

    createEl('span', {
      text: icon,
      style: {
        fontSize: '32px',
        lineHeight: '1',
        display: 'inline-block',
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      },
      parent: titleRow,
    });
    createEl('span', { text: name, parent: titleRow });

    // 词条行
    for (const desc of descriptions) {
      createEl('div', {
        class: ['info-line'],
        style: {
          fontSize: '15px',
          color: '#6a5a4a',
          padding: '6px 0',
          borderBottom: '1px solid #eee',
        },
        text: desc,
        parent: this.bodyWrap,
      });
    }

    // 位置提示（Phase 1 方便调试）
    createEl('div', {
      style: { marginTop: '10px', fontSize: '12px', color: '#aaa' },
      text: `tile idx = ${tileIdx} · 地形 = ${tile.terrain}`,
      parent: this.bodyWrap,
    });
  }

  /** 占位 tab */
  _renderPlaceholderTab(label) {
    createEl('div', {
      style: { padding: '40px 20px', textAlign: 'center', color: '#aaa', fontSize: '14px' },
      text: `✨ ${label} ✨`,
      parent: this.bodyWrap,
    });
  }

  /** 订阅事件 */
  _subscribeEvents() {
    // 地块点击 → 切换选中
    EventBus.on(GE.TILE_CLICKED, ({ tileIdx }) => {
      this.currentTileIdx = tileIdx;
      this._renderBody();
    });

    // STATE_RESET → 用新 gs 重新渲染（如果有选中 tile）
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.currentGs = gs;
      if (this.currentTileIdx !== null) {
        this._renderBody();
      }
    });

    // TILE_UPDATED → 选中的 tile 内容变了，刷新
    EventBus.on(GE.TILE_UPDATED, ({ tileIdx }) => {
      if (tileIdx !== undefined && tileIdx !== null && tileIdx === this.currentTileIdx) {
        this._renderBody();
      }
    });

    // 需要 gs 时从 GameDirector 取（Phase 1 简化方案，和 HotBar 一样）
    EventBus.on(GE.BOOT, ({ gs }) => {
      this.currentGs = gs;
    });
  }
}

export default InfoPanel;
