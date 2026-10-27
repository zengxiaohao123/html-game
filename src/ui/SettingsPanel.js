// src/ui/SettingsPanel.js
// 设置面板：ESC 打开
// 扩展 slot 1~8 存档 UI（Slot 1 自动存档，slot 2~8 手动）
// 用 Storage.listSlots() 初始化槽位状态
// 读档后调 director.loadGame(loaded)

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Storage } from '../state/storage.js';
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
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 5000,
        display: 'none', // 初始隐藏
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fade-in 0.2s ease-out',
      },
      onclick: () => this.hide(), // 点击遮罩关闭
      parent,
    });

    // 面板本体（宽度加大以容纳 8 槽网格）
    this.panel = createEl('div', {
      class: ['settings-panel'],
      style: {
        width: 'min(560px, 92vw)',
        padding: '20px 24px',
        backgroundColor: '#fffbe6',
        border: '4px solid #3a3a3a',
        borderRadius: '20px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        fontFamily: '"LXGW WenKai TC", sans-serif',
        textAlign: 'center',
        maxHeight: '86vh',
        overflowY: 'auto',
      },
      parent: this.mask,
    });

    // 标题
    createEl('h2', {
      style: {
        margin: '0 0 16px 0',
        fontSize: '22px',
        color: '#333',
      },
      text: '⚙️ 设置',
      parent: this.panel,
    });

    // 分区 1：存档槽位 —— 标题
    createEl('div', {
      style: {
        fontSize: '15px', fontWeight: '800', color: '#5a4a3a',
        marginBottom: '10px', textAlign: 'left', borderBottom: '2px dashed #b8a888', paddingBottom: '6px',
      },
      text: '💾 存档槽位（共 8 槽）',
      parent: this.panel,
    });

    // 存档槽位网格
    this.slotsGrid = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px',
        marginBottom: '14px',
      },
      parent: this.panel,
    });
    this._refreshSlots();

    // 关闭按钮
    this._createBtn('✖️ 关闭（ESC）', () => this.hide(), this.panel, '#ff6b6b');

    // 返回主菜单按钮（修复 5c）：自动存档到 slot 1 → 关闭面板 → 显示主菜单
    this._createBtn('返回主菜单', () => {
      // 自动存档到 slot 1（AUTOSAVE_SLOT）
      const gs = this.director?.getGS?.();
      if (gs) {
        const ok = Storage.save(AUTOSAVE_SLOT, gs);
        if (ok) {
          EventBus.emit(GE.TOAST_SHOW, { text: '💾 已自动存档到 Slot 1', duration: 1500 });
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 自动存档失败', duration: 2000 });
        }
      }
      // 关闭设置面板
      this.hide();
      // 显示主菜单遮罩
      if (typeof this.director?.mainMenu?.show === 'function') {
        this.director.mainMenu.show();
      }
      devLog.info('[Settings] returned to main menu');
    }, this.panel, '#b8860b');

    // 订阅 UI_PANEL_OPEN（ESC 触发）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings') {
        this.toggle();
      }
    });

    // 订阅 STATE_RESET：其他原因触发的话也隐藏面板
    EventBus.on(GE.STATE_RESET, () => {
      if (this.visible) this.hide();
    });

    // 订阅 SAVE_DONE / LOAD_DONE：存档/读档后刷新槽位显示
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
          padding: '10px 8px',
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
  _createBtn(text, onClick, parent, color = '#3a3a3a') {
    return createEl('button', {
      class: ['settings-btn'],
      style: {
        padding: '12px 16px',
        fontSize: '16px',
        fontFamily: 'inherit',
        border: '3px solid ' + color,
        borderRadius: '12px',
        backgroundColor: '#fff',
        color: color,
        cursor: 'pointer',
        fontWeight: '700',
        transition: 'background-color 0.1s',
        width: '100%',
      },
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

  /** 存档到指定槽 */
  _handleSaveSlot(slot) {
    if (!this.director) return;
    const gs = this.director.getGS();
    const ok = Storage.save(slot, gs);
    if (ok) {
      EventBus.emit(GE.TOAST_SHOW, { text: `✅ Slot ${slot} 存档成功`, duration: 1800 });
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
        EventBus.emit(GE.TOAST_SHOW, { text: `✅ Slot ${slot} 读档成功`, duration: 1800 });
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
