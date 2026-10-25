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
import { BlessSystem, BLESS_STAMINA_COST, BLESS_GOLD_COST } from '../systems/BlessSystem.js';
import { getDef } from '../data/facilities.js';
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
  none: '空地块：可建造设施',
  grass: '🟩 草地：相邻麦田 +1 小麦 / 相邻稻田 +1 稻草',
  water: '🌊 水面：相邻稻田 +2 稻草',
  mud:  '🟟 泥地：史莱姆粘液相关',
};

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
    this.tabs = [];
    this.bodyWrap = null;
    this.activeTab = 0;
    this.currentTileIdx = null;
    this.currentGs = null;
  }

  mount(parent = qs('#app')) {
    // 外层
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
      style: { display: 'flex', gap: '5px', flexShrink: '0' },
      parent: this.root,
    });
    this.tabs = [];
    tabs.forEach((label, i) => {
      const tab = createEl('button', {
        class: ['info-tab', i === 0 ? 'active' : ''],
        style: {
          flex: '1', padding: '6px 10px',
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

    // body 容器
    this.bodyWrap = createEl('div', {
      style: { flex: '1', overflowY: 'auto', minHeight: '60px' },
      parent: this.root,
    });

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
    this._renderBody();
  }

  _renderBody() {
    if (!this.bodyWrap) return;
    while (this.bodyWrap.firstChild) this.bodyWrap.removeChild(this.bodyWrap.firstChild);

    const gs = this._getGS();
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
    if (!tile) return;

    switch (this.activeTab) {
      case 0: this._renderContentTab(tile); break;
      case 1: this._renderStateTab(tile); break;
      case 2: this._renderUnitTab(tile); break;
      case 3: this._renderBlessTab(); break;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Tab 0 —— 地块内容（emoji + 名称 + 词条 + 地形 + 进入按钮）
  // ════════════════════════════════════════════════════════════
  _renderContentTab(tile) {
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
      icon = Assets.getEmoji(contentId.startsWith('resource_') ? 'resources' : 'facilities', contentId);
      const def = getDef(contentId);
      name = (def && def.name) || contentId;
      descriptions = FACILITY_DESCRIPTIONS[contentId] || ['（词条未配置）'];
    } else {
      icon = Assets.getEmoji('terrains', tile.terrain || 'none');
      name = (TERRAIN_DESCRIPTIONS[tile.terrain || 'none'] || '空地').split('：')[0];
      descriptions = [TERRAIN_DESCRIPTIONS[tile.terrain || 'none'] || '可在此建造设施'];
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
    if (tile.terrain && tile.terrain !== 'none') {
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

    // 资源类地块额外"进入"按钮（Toast 占位）
    if (contentId && contentId.startsWith('resource_')) {
      createEl('div', {
        style: { marginTop: '12px', textAlign: 'center' },
        parent: this.bodyWrap,
      });
      createEl('button', {
        class: 'action-btn',
        style: { fontSize: '14px' },
        text: '🚪 进入',
        parent: this.bodyWrap,
        onclick: () => {
          EventBus.emit(GE.TOAST_SHOW, {
            text: '🎲 遭遇随机事件…',
            duration: 2000,
          });
        },
      });
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
  // Tab 2 —— 单位（玩家 hp/atk/stamina/gold + 栅栏内生物占位）
  // ════════════════════════════════════════════════════════════
  _renderUnitTab(tile) {
    const gs = this._getGS();
    const playerTileIdx = gs.player.x;
    const isHere = tile.idx === playerTileIdx;

    createEl('div', {
      style: {
        fontSize: '16px', fontWeight: '700', color: '#3a2e20',
        marginBottom: '10px',
      },
      text: isHere ? '🧑‍🎤 余默（在本格）' : `🧑‍🎤 余默（在 idx=${playerTileIdx}）`,
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

    // 栅栏内生物占位（Phase 3 CreatureSystem 创建后再接入）
    createEl('div', {
      style: { marginTop: '16px', borderTop: '2px dashed #b8a888', paddingTop: '10px' },
      parent: this.bodyWrap,
    });
    createEl('div', {
      style: { fontSize: '14px', color: '#3a2e20', fontWeight: '700', marginBottom: '6px' },
      text: '🐣 栅栏内生物',
      parent: this.bodyWrap,
    });
    createEl('div', {
      style: { color: '#b0a090', fontSize: '13px' },
      text: '（暂无生物 —— Phase 3 CreatureSystem）',
      parent: this.bodyWrap,
    });
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

    createEl('div', {
      style: { fontSize: '15px', color: '#3a2e20', lineHeight: '1.6', marginBottom: '12px' },
      text: blessing
        ? '✨ momo 正在为你挑选福地… 抽奖动画进行中'
        : 'momo 会随机为 1 格挂上【祝福】效果。祝福状态只持续 1 天，但受祝福时会立即触发该设施的【受祝福时】词条。',
      parent: this.bodyWrap,
    });

    createEl('div', {
      style: { fontSize: '13px', color: '#8a6a3a', marginBottom: '14px' },
      text: `消耗：${BLESS_STAMINA_COST} 🔷 + ${BLESS_GOLD_COST} 🪙 · 快捷键：空格`,
      parent: this.bodyWrap,
    });

    createEl('button', {
      class: ['bless-btn'],
      style: { width: '100%' },
      text: blessing ? '✨ 抽奖中…' : '🧘 请 momo 帮忙',
      disabled: !canBless,
      parent: this.bodyWrap,
      onclick: () => {
        const gsRef = this._getGS();
        BlessSystem.blessStart(gsRef);
        // blessStart 扣消耗并 emit BLESS_START → BlessAnimation 播动画 → blessCommit 挂状态 fire hook
        // 这里 blessStart 内部不会自动 emit BLESS_DONE（动画播完才 commit 才 emit），
        // 所以 Tab3 状态刷新靠 InfoPanel 自己监听 BLESS_START / BLESS_DONE 事件
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
  // 事件订阅（保留 Phase 1 骨架 + 补充 BLESS_DONE / GOLD_CHANGE / STAMINA_CHANGE 刷新）
  // ════════════════════════════════════════════════════════════
  /** 选中指定 idx 的 tile（公开接口，供 SpiritArea 等调用） */
  selectTile(tileIdx) {
    this.currentTileIdx = tileIdx;
    this._switchTab(this.activeTab);
  }

  /** 切到"祈福"tab（公开接口，供 SpiritArea 点击 momo 调用） */
  showBlessTab() {
    // 同时把玩家所在 tile 选中（让 InfoPanel 有一个 tile 上下文）
    const gs = this._getGS();
    if (gs) this.currentTileIdx = gs.player.x;
    this._switchTab(3);
  }

  _subscribeEvents() {
    EventBus.on(GE.TILE_CLICKED, ({ tileIdx }) => {
      this.currentTileIdx = tileIdx;
      this.root.classList.remove('slide-out');
      this.root.classList.add('slide-in');
      this._renderBody();
    });

    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.currentGs = gs;
      if (this.currentTileIdx !== null) this._renderBody();
    });

    EventBus.on(GE.TILE_UPDATED, ({ tileIdx }) => {
      if (tileIdx !== undefined && tileIdx !== null && tileIdx === this.currentTileIdx) {
        this._renderBody();
      }
    });

    // 祈福开始（扣消耗 + 动画中） → Tab3 立即刷新成"抽奖中…"禁用态
    EventBus.on(GE.BLESS_START, () => {
      if (this.activeTab === 3) this._renderBody();
    });

    // 祈福完成 → 选中祝福目标并切到"状态"tab
    EventBus.on(GE.BLESS_DONE, ({ tileIdx }) => {
      if (tileIdx !== undefined && tileIdx !== null) {
        this.currentTileIdx = tileIdx;
        this._switchTab(1); // 切到"状态"tab，让玩家看到 blessed 状态
      }
    });

    // 玩家数值变化 → "单位"tab 或"祈福"tab 重刷
    EventBus.on(GE.STAMINA_CHANGE, () => {
      if ((this.activeTab === 2 || this.activeTab === 3) && this.currentTileIdx !== null) {
        this._renderBody();
      }
    });
    EventBus.on(GE.GOLD_CHANGE, () => {
      if ((this.activeTab === 2 || this.activeTab === 3) && this.currentTileIdx !== null) {
        this._renderBody();
      }
    });

    // Boot 时拿 GS
    EventBus.on(GE.BOOT, ({ gs }) => {
      this.currentGs = gs;
    });

    // SpiritArea 点击 momo 切到祈福 tab
    EventBus.on('ui:infoShowBless', () => {
      this.showBlessTab();
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
