// src/ui/SettingsPanel.js
// 设置面板：ESC 打开
// 扩展 slot 1~8 存档 UI（Slot 1 自动存档，slot 2~8 手动）
// 用 Storage.listSlots() 初始化槽位状态
// 读档后调 director.loadGame(loaded)

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Storage } from '../state/storage.js';
import { DayBaseline } from '../state/DayBaseline.js';
import { AUTOSAVE_SLOT, SLOTS_MAX } from '../utils/constants.js';
import { createEl, qs } from './dom.js';
import { devLog } from '../core/Logger.js';

export class SettingsPanel {
  /**
   * @param {GameDirector} director 游戏主导演（持有 GS）
   */
  constructor(director) {
    this.director = director;
    this.mask = null;       // 遮罩层
    this.panel = null;      // 面板本体
    this.visible = false;   // 当前是否显示
    this._slotsRefreshTimer = null;
  }

  mount(parent = qs('body')) {
    // 遮罩层（半透明黑色）
    this.mask = createEl('div', {
      class: ['settings-mask'],
      style: {
        position: 'fixed',
        inset: '0',
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: 6200,   // 第 8 批：§16.21 商店内可开设置（需高于商店 5500 与普通面板 6000）
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onclick: () => this.hide(),
      parent,
    });

    // 面板本体
    this.panel = createEl('div', {
      class: ['settings-panel'],
      style: {
        width: 'min(680px, 94vw)',
        maxHeight: '88vh',
        padding: '28px 30px 20px 30px',
        // 第 10 批：外壳对齐基准 panel-card 语言（3px #3a3a3a / 16px 圆角 / 奶油底）
        background: 'linear-gradient(180deg,#fffbf0,#fff3c4)',
        border: '3px solid #3a3a3a',
        borderRadius: '16px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        fontFamily: '"LXGW WenKai TC", system-ui, sans-serif',
        overflowY: 'auto',
        boxSizing: 'border-box',
      },
      parent: this.mask,
    });

    // 页面标题行已删除（不再提示「⚙️ 设 置」）；关闭入口仍保留：
    // 底部「✖️ 关 闭」按钮 + 遮罩点击 + ESC（GameDirector.handleESC）
    // 标题行腾出的高度由存档槽位卡片吸收，面板外框高度保持不变。

    // ══ 存档槽位分区标题 ══
    const sectionHeader = createEl('div', {
      style: {
        fontSize: '16px',
        fontWeight: '800',
        color: '#4a3a1a',
        padding: '8px 14px',
        backgroundColor: '#f5e8c8',
        borderLeft: '5px solid #c89a3c',
        borderRight: '5px solid #c89a3c',
        borderRadius: '8px',
        marginBottom: '14px',
      },
      text: '💾 存 档 管 理（8 槽）  •  点击槽位查看详情',
      parent: this.panel,
    });

    // ══ 存档槽位网格（4x2） ══
    this.slotsGrid = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px',
        marginBottom: '20px',
      },
      parent: this.panel,
    });
    this._refreshSlots();

    // ══ 按钮行（底部，两个大按钮横排） ══
    const btnRow = createEl('div', {
      style: {
        display: 'flex',
        gap: '16px',
        paddingTop: '12px',
        borderTop: '3px dashed #c89a3c',
      },
      parent: this.panel,
    });

    this._createBtn('✖️ 关 闭', () => this.hide(), btnRow, '#c84040', true);
    this._createBtn('🏠 返回主菜单', () => {
      // 返回主菜单写 1 号位，同样是「本日开始」基线（不是日内实时状态）
      const baseline = this._getBaseline();
      if (baseline) {
        const ok = Storage.save(AUTOSAVE_SLOT, baseline);
        EventBus.emit(GE.TOAST_SHOW, {
          text: ok ? '💾 以本日开始时存档' : '⚠️ 自动存档失败',
          duration: 1600,
        });
      }
      this.hide();
      if (typeof this.director?.mainMenu?.show === 'function') {
        this.director.mainMenu.show();
      }
    }, btnRow, '#a87808', true);

    // 提示文字
    createEl('div', {
      style: {
        textAlign: 'center',
        fontSize: '12px',
        color: '#9a8a6a',
        marginTop: '12px',
        letterSpacing: '1px',
      },
      text: '💡 快捷键 ESC 打开 / 关闭设置  •  读档后自动关闭面板',
      parent: this.panel,
    });

    // ══ 事件订阅 ══
    // 幂等显示：收到自己的 OPEN 只负责显示/刷新，绝不 toggle 关闭
    // （开新面板关旧面板由 GameDirector 中央发 UI_PANEL_CLOSE 处理）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings') {
        this.show();
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
    });

    EventBus.on(GE.STATE_RESET, () => {
      if (this.visible) this.hide();
    });

    EventBus.on(GE.SAVE_DONE, () => { if (this.visible) this._refreshSlots(); });
    EventBus.on(GE.LOAD_DONE, () => { if (this.visible) this._refreshSlots(); });
  }

  /** 刷新 8 个槽位显示 */
  _refreshSlots() {
    if (!this.slotsGrid) return;
    this.slotsGrid.innerHTML = '';
    const slots = Storage.listSlots();
    slots.forEach((s) => {
      const isAuto = s.slot === AUTOSAVE_SLOT;
      const used = s.used;

      const card = createEl('div', {
        style: {
          position: 'relative',
          // 原标题行高度（约 44px）分摊到两行槽位卡（每行 +22px），外框高度不变、内容区更宽松
          padding: '21px 8px',
          background: used ? (isAuto ? '#fff6c0' : 'rgba(255,255,255,0.9)') : '#f0f0f0',
          border: '2px solid ' + (used ? '#b8a888' : '#ccc'),
          borderRadius: '10px',
          cursor: 'pointer',
          textAlign: 'center',
          fontSize: '12px',
          transition: 'transform 0.1s',
        },
        parent: this.slotsGrid,
      });

      // 槽位号
      createEl('div', {
        style: { fontSize: '16px', fontWeight: '900', color: '#3a2e20', marginBottom: '4px' },
        text: `Slot ${s.slot}`,
        parent: card,
      });

      // 标签（自动存档 / 手动存档）
      if (isAuto) {
        createEl('div', {
          style: { fontSize: '10px', color: '#888', background: '#ddd', padding: '1px 6px', borderRadius: '6px', display: 'inline-block', marginBottom: '4px' },
          text: '自动存档',
          parent: card,
        });
      } else {
        createEl('div', {
          style: { fontSize: '10px', color: '#666', marginBottom: '4px' },
          text: '手动存档',
          parent: card,
        });
      }

      // 已用状态 + 时间
      if (used) {
        const timeStr = s.savedAt ? new Date(s.savedAt).toLocaleString().replace(/\//g, '-').substring(5, 16) : '';
        createEl('div', {
          style: { fontSize: '10px', color: '#2a8a3a', fontWeight: '700' },
          text: '● 已用',
          parent: card,
        });
        if (timeStr) {
          createEl('div', {
            style: { fontSize: '9px', color: '#7a6a56', marginTop: '2px' },
            text: timeStr,
            parent: card,
          });
        }
      } else {
        createEl('div', {
          style: { fontSize: '10px', color: '#aaa' },
          text: '○ 空闲',
          parent: card,
        });
      }

      // 点击槽位 → 弹出子菜单
      card.addEventListener('click', () => this._openSlotMenu(s));
    });
  }

  /** 点击槽位 → DialogBox 弹出操作菜单（存/读/清） */
  _openSlotMenu(s) {
    const isAuto = s.slot === AUTOSAVE_SLOT;
    const used = s.used;
    const slotNum = s.slot;

    const options = [];
    // slot 1 自动存档：只有读档 + 手动存（覆盖自动存档），不能清
    // slot 2~8 手动：存 + 读 + 清
    if (isAuto) {
      options.push({ label: '📂 读取此存档', onSelect: () => this._handleLoadSlot(slotNum) });
      options.push({ label: '💾 手动存入此槽', onSelect: () => this._handleSaveSlot(slotNum) });
      options.push({ label: '取消', onSelect: () => {} });
    } else {
      if (used) {
        options.push({ label: '📂 读取此存档', onSelect: () => this._handleLoadSlot(slotNum) });
        options.push({ label: '💾 覆盖存档', onSelect: () => this._handleSaveSlot(slotNum) });
        options.push({ label: '🗑️ 清空此槽', onSelect: () => this._handleClearSlot(slotNum) });
      } else {
        options.push({ label: '💾 存到此处', onSelect: () => this._handleSaveSlot(slotNum) });
      }
      options.push({ label: '取消', onSelect: () => {} });
    }

    const slotLabel = isAuto ? `Slot ${slotNum}（自动存档）` : `Slot ${slotNum}`;
    const statusText = used
      ? `已存在存档 · ${new Date(s.savedAt).toLocaleString()}`
      : '（空闲，未使用）';

    EventBus.emit(GE.DIALOG_SHOW, {
      title: `🗂️ ${slotLabel}`,
      content: statusText,
      options,
    });
  }

  /** 创建按钮 */
  _createBtn(text, onClick, parent, color = '#3a3a3a', filled = false) {
    const btnStyle = {
      padding: '14px 20px',
      fontSize: '18px',
      fontFamily: '"LXGW WenKai TC", system-ui, sans-serif',
      fontWeight: '900',
      borderRadius: '12px',
      cursor: 'pointer',
      transition: 'all 0.15s ease-out',
      textAlign: 'center',
      letterSpacing: '3px',
      boxSizing: 'border-box',
      display: 'inline-block',
      textDecoration: 'none',
      // 关键：覆盖任何可能的 CSS 全局 color 规则
      WebkitTextStroke: '0px',
    };
    if (filled) {
      btnStyle.backgroundColor = color;
      btnStyle.color = '#ffffff !important';
      btnStyle.border = `3px solid ${color}`;
      btnStyle.flex = '1';
      btnStyle.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
    } else {
      btnStyle.backgroundColor = '#ffffff';
      btnStyle.color = color;
      btnStyle.border = `3px solid ${color}`;
      btnStyle.width = '100%';
    }
    return createEl('button', {
      // 不传 class —— 避免任何全局 CSS 规则覆盖 inline style
      style: btnStyle,
      text,
      onclick: onClick,
      parent,
    });
  }

  /** 切换显示/隐藏 */
  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** 显示面板 */
  show() {
    if (!this.mask) return;
    this.mask.style.display = 'flex';
    this.visible = true;
    this._refreshSlots();
    // 追踪 activePanel
    const gs = this.director?.getGS?.();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'settings'; }
  }

  /** 隐藏面板 */
  hide() {
    if (!this.mask) return;
    this.mask.style.display = 'none';
    this.visible = false;
    const gs = this.director?.getGS?.();
    if (gs && gs.uiState && gs.uiState.activePanel === 'settings') {
      gs.uiState.activePanel = null;
    }
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'settings' });
  }

  /** 取日初基线：存档只写这份冻结副本（手动存档任何时候都能存，但内容始终是本日开始） */
  _getBaseline() {
    const fromDirector = this.director?.getBaseline?.();
    if (fromDirector) return fromDirector;
    const gs = this.director?.getGS?.();
    return gs ? DayBaseline.capture(gs) : null;
  }

  /** 存档到指定槽 */
  _handleSaveSlot(slot) {
    if (!this.director) return;
    const baseline = this._getBaseline();
    const ok = baseline ? Storage.save(slot, baseline) : false;
    if (ok) {
      // 只留一句口径提示，不解释当日进度细节，也不标注日初信息
      EventBus.emit(GE.TOAST_SHOW, { text: '💾 以本日开始时存档', duration: 1800 });
      EventBus.emit(GE.SAVE_DONE, { slot });
      this._refreshSlots();
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 存档失败', duration: 2000 });
    }
  }

  /** 读档指定槽 */
  _handleLoadSlot(slot) {
    const loaded = Storage.load(slot);
    if (loaded) {
      const ok = this.director.loadGame(loaded);
      if (ok) {
        EventBus.emit(GE.TOAST_SHOW, { text: '📂 读档将回到本日开始时', duration: 1800 });
        EventBus.emit(GE.LOAD_DONE, { slot });
        this.hide();
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '❌ 读档失败', duration: 2000 });
      }
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: `❌ Slot ${slot} 没有存档`, duration: 2000 });
    }
  }

  /** 清空指定槽 */
  _handleClearSlot(slot) {
    const ok = Storage.clearSlot(slot);
    if (ok) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🗑️ Slot ${slot} 已清空`, duration: 1500 });
      this._refreshSlots();
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 清空失败', duration: 2000 });
    }
  }
}

export default SettingsPanel;
