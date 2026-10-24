// src/ui/SettingsPanel.js
// 设置面板：ESC 打开，包含 存档 slot1 / 读档 slot1 / 关闭 三个按钮
// 读档成功后 emit GE.STATE_RESET 让所有 UI 模块自动刷新

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Storage } from '../state/storage.js';
import { AUTOSAVE_SLOT } from '../utils/constants.js';
import { createEl, qs } from './dom.js';

export class SettingsPanel {
  /**
   * @param {GameDirector} director 游戏主导演（持有 GS）
   */
  constructor(director) {
    this.director = director;
    this.mask = null;       // 遮罩层
    this.panel = null;      // 面板本体
    this.visible = false;   // 当前是否显示
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

    // 面板本体
    this.panel = createEl('div', {
      class: ['settings-panel'],
      style: {
        width: '320px',
        padding: '24px',
        backgroundColor: '#fffbe6',
        border: '4px solid #3a3a3a',
        borderRadius: '20px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        fontFamily: '"LXGW WenKai TC", sans-serif',
        textAlign: 'center',
      },
      parent: this.mask,
    });

    // 标题
    createEl('h2', {
      style: {
        margin: '0 0 20px 0',
        fontSize: '22px',
        color: '#333',
      },
      text: '⚙️ 设置',
      parent: this.panel,
    });

    // 按钮组容器
    const btnGroup = createEl('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      parent: this.panel,
    });

    // 存档按钮
    this._createBtn('💾 存档到 slot 1', () => this._handleSave(), btnGroup);

    // 读档按钮
    this._createBtn('📂 读取 slot 1 存档', () => this._handleLoad(), btnGroup);

    // 关闭按钮
    this._createBtn('✖️ 关闭（ESC）', () => this.hide(), btnGroup, '#ff6b6b');

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

  /** 处理存档 */
  _handleSave() {
    if (!this.director) return;
    const gs = this.director.getGS();
    const ok = Storage.save(AUTOSAVE_SLOT, gs);
    if (ok) {
      EventBus.emit(GE.TOAST_SHOW, { text: '✅ 存档成功', duration: 1800 });
      EventBus.emit(GE.SAVE_DONE, { slot: AUTOSAVE_SLOT });
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 存档失败', duration: 2000 });
    }
  }

  /** 处理读档 */
  _handleLoad() {
    const loaded = Storage.load(AUTOSAVE_SLOT);
    if (loaded) {
      // 先清空 HookDispatcher 里的回调？不，facilities 注册只做一次，存档里的 hook 已经在 registerFacilities() 时注册好了
      const ok = this.director.loadGame(loaded);
      if (ok) {
        EventBus.emit(GE.TOAST_SHOW, { text: '✅ 读档成功', duration: 1800 });
        EventBus.emit(GE.LOAD_DONE, { slot: AUTOSAVE_SLOT });
        this.hide();
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '❌ 读档失败', duration: 2000 });
      }
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 没有存档', duration: 2000 });
    }
  }
}

export default SettingsPanel;
