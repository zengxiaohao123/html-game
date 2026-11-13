// src/ui/StoryUI.js
// §16.5 剧情区 + 选项区（剧情与事件共用同一套 UI）
//
// 结构（对照 docs/_art-references/事件ui点击前.jpg / 事件ui点击一次.jpg）：
//   · 剧情区：屏幕下方居中，左侧圆形事件徽记 + 右侧正文（多段、逐段推进）
//     - 不显示标题行（本轮需求）；脚本里的 title 只用于日志 / aria，不渲染
//     - 右下「▼ 继续」呼吸指示（有选项时改为「请选择」，且不允许推进）
//     - 右上 ✖ = 跳过入口，点击后走 DialogBox 二次确认（§16.5）
//   · 选项区：右侧中部竖排选项卡片（键位徽章 + 主标题 + 副标题）
//     - 鼠标点击 / 数字键 1~4 等价（§16.4 选项模式）
//     - 首次点击 = 待确认：浅绿底 + 卡内「你确定这么做？」+ 圆形确认钮
//     - 再次点击（或点圆形确认钮）= 同一 tick 立即生效，随后该卡 1.5 秒淡出
//     - 禁用态灰化、不可点、不进待确认
//   · 输入封锁：由 InputGate 读取 this.visible → INPUT_BLOCK.STORY
//
// 数据驱动（见 src/data/stories.js）：UI 不写死任何文案；
// 脚本节点提供 text / next / end / options，选项提供 label / sub / detail /
// disabled / safe / effects / next / end / onSelect。
// 事件结算由选项驱动：只有选项确认时才执行其 effects（同一选项一次事件只执行一次），
// 进入事件 / 推进正文 / 跳过都不产生任何结算。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { createEl, qs, clearChildren } from './dom.js';
import * as ConfirmAction from './ConfirmAction.js';
import { CONFIRM_TEXT, CONFIRM_FADE_MS } from './ConfirmAction.js';
import { applyEventEffects } from '../systems/EventEffects.js';

/** 选项上限（本轮需求 1~4 个） */
export const MAX_OPTIONS = 4;

/** 正文规范化：数组 = 多段（段间空一行），字符串保留自身换行 */
function normalizeText(text) {
  if (Array.isArray(text)) return text.filter((s) => s != null && s !== '').join('\n\n');
  return String(text ?? '');
}

export class StoryUI {
  constructor(director = null) {
    this.director = director;
    this.mask = null;          // 暗色薄纱（拦截地图点击，替代缺失的事件背景图）
    this.layer = null;         // 剧情区 + 选项区容器（pointer-events:none）
    this.storyPanel = null;    // 剧情区
    this.textEl = null;        // 正文
    this.emblemEl = null;      // 圆形徽记
    this.promptEl = null;      // 「继续 / 请选择」指示
    this.promptTextEl = null;
    this.promptArrowEl = null;
    this.optionAreaEl = null;  // 选项区

    this.visible = false;
    this.script = null;
    this.nodeKey = null;
    this.ctx = {};

    this._options = [];
    this.optionBtns = [];
    this._hints = [];
    this._details = [];
    this._confirmBtns = [];
    this._confirming = false;   // 确认后的淡出期（禁止再次选择）
    this._pending = null;       // 选项结算后的去向 {kind:'node'|'end', key}
    this._settled = new Set();  // 本次事件已结算的选项键（防止同一选项重复结算）
    this._outsideArmedIdx = -1;
    this._offDisarm = null;

    // 冒烟测试可覆写以加速（文档口径 1.5 秒）
    this.confirmFadeMs = CONFIRM_FADE_MS;
  }

  // ─────────────────────────────────────── 骨架
  mount(parent = qs('body')) {
    // 薄纱：没有事件背景图，用暗色遮罩保证正文可读，并拦截地图 / 快捷栏点击
    this.mask = createEl('div', {
      class: ['story-mask'],
      style: {
        position: 'fixed', inset: '0',
        backgroundColor: 'rgba(14, 20, 24, 0.34)',
        zIndex: '8950',
        display: 'none',
      },
      parent,
    });

    this.layer = createEl('div', {
      class: ['story-layer'],
      style: {
        position: 'fixed', inset: '0',
        zIndex: '9000',
        pointerEvents: 'none',
        display: 'none',
      },
      parent,
    });

    this._mountStoryPanel();
    this._mountOptionArea();

    // 选项待确认态的唯一复位入口（点别处 / ESC / disarmAll）
    this._offDisarm = ConfirmAction.onDisarm((btn) => {
      if (!this.optionBtns.includes(btn)) return;
      this._resetArmedCard(btn);
    });

    EventBus.on(GE.STORY_SHOW, (p = {}) => this.show(p.script || p, p.ctx || {}));
    // 读档 / 重开：丢弃剧情演出，静默关闭（不触发 onEnd 结算）
    EventBus.on(GE.STATE_RESET, () => this.closeSilently('state-reset'));
    EventBus.on(GE.BOOT, () => this.closeSilently('boot'));

    if (this.director) {
      this.director.storyUI = this;
      window.addEventListener('keydown', (e) => this._onKeyDown(e));
    }
    return this.layer;
  }

  _mountStoryPanel() {
    this.storyPanel = createEl('div', {
      class: ['story-panel'],
      style: {
        position: 'absolute',
        left: '50%', bottom: '104px',
        transform: 'translateX(-50%)',
        width: 'min(880px, 66vw)',
        minHeight: '132px',
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', gap: '18px',
        padding: '18px 22px 16px 18px',
        cursor: 'pointer',
      },
      parent: this.layer,
    });

    // 左侧圆形徽记
    this.emblemEl = createEl('div', {
      class: ['story-emblem'],
      style: { flexShrink: '0' },
      parent: this.storyPanel,
    });

    const body = createEl('div', {
      class: ['story-body'],
      style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: this.storyPanel,
    });

    this.textEl = createEl('div', {
      class: ['story-text'],
      parent: body,
    });

    const foot = createEl('div', {
      class: ['story-foot'],
      parent: body,
    });
    this.promptArrowEl = createEl('span', {
      class: ['story-prompt-arrow'],
      text: '▼',
      parent: foot,
    });
    this.promptTextEl = createEl('span', {
      class: ['story-prompt-text'],
      text: '继续',
      parent: foot,
    });
    this.promptEl = foot;

    // 右上 ✖：与现有面板统一（奶白底 + 深棕描边），点击 = 跳过入口
    const closeBtn = createEl('button', {
      class: ['story-close'],
      text: '✖',
      attrs: { title: '跳过 / 关闭（需确认）', 'aria-label': '跳过剧情' },
      parent: this.storyPanel,
    });
    closeBtn.onclick = (e) => {
      if (e?.stopPropagation) e.stopPropagation();
      this.requestSkip();
    };

    // 点剧情区 = 推进一段（选项阶段由 advance() 自行忽略）
    this.storyPanel.onclick = () => this.advance();
  }

  _mountOptionArea() {
    this.optionAreaEl = createEl('div', {
      class: ['option-area'],
      parent: this.layer,
    });
    this.optionAreaEl.style.display = 'none';
  }

  // ─────────────────────────────────────── 对外 API
  /**
   * 播放一段剧情 / 事件脚本
   * @param {object} script StoryScript（见 src/data/stories.js）
   * @param {object} [ctx] 额外上下文（并入回调 ctx）
   * @returns {boolean}
   */
  show(script, ctx = {}) {
    if (!script || !script.nodes || !script.start || !script.nodes[script.start]) {
      devLog.warn('[StoryUI] 脚本无效：缺少 nodes / start', script);
      return false;
    }
    ConfirmAction.disarmAll();
    this._confirming = false;
    this._pending = null;
    this._settled = new Set();
    this._clearOptions();

    this.script = script;
    this.nodeKey = script.start;
    this.ctx = {
      gs: this.director?.getGS?.() ?? null,
      script,
      nodeKey: script.start,
      option: null,
      ui: this,
      ...ctx,
    };

    this.visible = true;
    this.mask.style.display = 'block';
    this.layer.style.display = 'block';
    this.emblemEl.textContent = String(script.icon || '🎲');
    this.storyPanel.setAttribute('title', String(script.title || ''));

    this._renderNode();
    EventBus.emit(GE.STORY_START, { id: script.id, title: script.title });
    devLog.info('[StoryUI] show', script.id, 'start=', script.start);
    return true;
  }

  /** 推进一段正文；选项阶段不推进（返回 false） */
  advance() {
    if (!this.visible || this._confirming) return false;
    if (this._options.length > 0) { this._pulseOptions(); return false; }
    const node = this._node();
    if (!node) { this._finish('missing-node'); return false; }
    if (node.end || !node.next) { this._finish('advance-end'); return true; }
    return this._goto(node.next);
  }

  /** 跳过：只允许停在下一个「有选项」的节点或直接结束（§16.5） */
  skip() {
    if (!this.visible || this._confirming) return false;
    if (this._options.length > 0) {
      EventBus.emit(GE.TOAST_SHOW, { text: '这里需要先做出选择', duration: 1500 });
      return false;
    }
    let key = this._node()?.next || null;
    let guard = 0;
    while (key && guard++ < 64) {
      const node = this.script?.nodes?.[key];
      if (!node) { this._finish('skip'); return true; }
      if (Array.isArray(node.options) && node.options.length) return this._goto(key);
      if (node.end || !node.next) { this._finish('skip'); return true; }
      key = node.next;
    }
    this._finish('skip');
    return true;
  }

  /** 跳过入口：先弹 DialogBox 二次确认（取消为安全选项） */
  requestSkip() {
    if (!this.visible || this._confirming) return false;
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '跳过',
      content: '跳过当前剧情 / 事件？遇到选项时只会跳到选项处，仍需手动选择。',
      options: [
        { label: '取消', safe: true, onSelect: () => {} },
        { label: '跳过', onSelect: () => { this.skip(); } },
      ],
    });
    return true;
  }

  /**
   * 实时刷新当前节点（数据改动后无需额外操作；§16.2 UI 通用实时契约）
   * 待确认 / 淡出期间不重建选项，避免打断玩家手势。
   */
  refresh() {
    if (!this.visible) return false;
    const node = this._node();
    if (!node) return false;
    this.textEl.textContent = normalizeText(node.text);
    if (this._confirming) return true;
    this._clearOptions();
    this._options = this._collectOptions(node);
    this._renderOptions();
    this._updatePrompt();
    return true;
  }

  /** 静默关闭（不触发 onEnd，用于读档 / 重开） */
  closeSilently(reason = 'silent') {
    if (!this.visible) return;
    const id = this.script?.id;
    this._hide();
    this.script = null;
    this.ctx = {};
    this.nodeKey = null;
    EventBus.emit(GE.STORY_END, { id, reason });
  }

  // ─────────────────────────────────────── 节点渲染
  _node() {
    return this.script?.nodes?.[this.nodeKey] || null;
  }

  _collectOptions(node) {
    const raw = Array.isArray(node?.options) ? node.options : [];
    return raw.slice(0, MAX_OPTIONS);
  }

  _renderNode() {
    const node = this._node();
    if (!node) { this._finish('missing-node'); return; }
    this.ctx.nodeKey = this.nodeKey;
    this.textEl.textContent = normalizeText(node.text);
    this._clearOptions();
    this._options = this._collectOptions(node);
    this._renderOptions();
    this._updatePrompt();
    if (typeof node.onEnter === 'function') {
      try { node.onEnter(this.ctx); } catch (err) { devLog.error('[StoryUI.onEnter]', err); }
    }
    EventBus.emit(GE.STORY_NODE, { id: this.script?.id, nodeKey: this.nodeKey });
  }

  _goto(key) {
    if (!key || !this.script?.nodes?.[key]) { this._finish('missing-node'); return false; }
    this.nodeKey = key;
    this._renderNode();
    return true;
  }

  /** 淡出期间的过渡态：只换正文，选项区保持旧卡（不可点）直到淡出结束 */
  _renderPendingNode(key) {
    const node = this.script?.nodes?.[key];
    if (!node) return false;
    this.nodeKey = key;
    this.ctx.nodeKey = key;
    this.textEl.textContent = normalizeText(node.text);
    this.promptEl.style.display = 'none';
    EventBus.emit(GE.STORY_NODE, { id: this.script?.id, nodeKey: key });
    return true;
  }

  _updatePrompt() {
    this.promptEl.style.display = 'flex';
    if (this._options.length > 0) {
      this.promptEl.classList.add('selecting');
      this.promptArrowEl.style.display = 'none';
      this.promptTextEl.textContent = '请选择';
      return;
    }
    this.promptEl.classList.remove('selecting');
    this.promptArrowEl.style.display = 'inline-block';
    this.promptTextEl.textContent = '继续';
  }

  _pulseOptions() {
    // 有选项时点正文：轻微抖动提示「请先选择」，不做任何状态变更
    const area = this.optionAreaEl;
    if (!area?.classList?.add) return;
    area.classList.add('option-area-nudge');
    setTimeout(() => area.classList.remove('option-area-nudge'), 320);
  }

  // ─────────────────────────────────────── 选项区
  _clearOptions() {
    this._options = [];
    this.optionBtns = [];
    this._hints = [];
    this._details = [];
    this._confirmBtns = [];
    if (this.optionAreaEl) {
      clearChildren(this.optionAreaEl);
      this.optionAreaEl.style.display = 'none';
      this.optionAreaEl.style.pointerEvents = '';
    }
  }

  _renderOptions() {
    const area = this.optionAreaEl;
    if (!area) return;
    clearChildren(area);
    this.optionBtns = [];
    this._hints = [];
    this._details = [];
    this._confirmBtns = [];
    if (!this._options.length) { area.style.display = 'none'; return; }

    area.style.display = 'flex';
    area.style.pointerEvents = '';

    this._options.forEach((opt, i) => {
      const card = createEl('div', {
        class: ['story-option'],
        attrs: { 'data-opt-idx': String(i), role: 'button' },
        parent: area,
      });

      const top = createEl('div', { class: ['story-option-top'], parent: card });
      createEl('span', {
        class: ['story-option-key'],
        text: String(i + 1),
        attrs: { 'aria-hidden': 'true' },
        parent: top,
      });
      createEl('span', {
        class: ['story-option-label'],
        text: String(opt.label || '选项'),
        parent: top,
      });

      if (opt.sub) {
        createEl('div', { class: ['story-option-sub'], text: String(opt.sub), parent: card });
      }
      if (opt.disabled && opt.disabledReason) {
        createEl('div', {
          class: ['story-option-sub', 'story-option-reason'],
          text: `不可选：${opt.disabledReason}`,
          parent: card,
        });
      }

      // 选中后展开的详情（参考图第二张）
      const detail = createEl('div', {
        class: ['story-option-detail'],
        text: String(opt.detail || ''),
        parent: card,
      });
      detail.style.display = 'none';

      // 圆形确认钮（参考图第二张右侧）
      const confirmBtn = createEl('button', {
        class: ['story-option-confirm'],
        text: '✓',
        attrs: { title: '确定这么做？', 'aria-label': '确定这么做？' },
        parent: card,
      });
      confirmBtn.style.display = 'none';
      confirmBtn.onclick = (e) => {
        if (e?.stopPropagation) e.stopPropagation();
        this._applyOption(i);
      };

      // 待确认文案只在卡片内（§16.4，禁止悬浮到角落）
      const hint = createEl('div', {
        class: ['story-option-hint'],
        text: CONFIRM_TEXT,
        parent: card,
      });
      hint.style.display = 'none';

      if (opt.disabled) {
        card.classList.add('disabled');
        card.setAttribute('aria-disabled', 'true');
      } else {
        card.onclick = () => this._chooseOption(i);
      }

      this.optionBtns.push(card);
      this._hints.push(hint);
      this._details.push(detail);
      this._confirmBtns.push(confirmBtn);
    });
  }

  _chooseOption(i) {
    if (!this.visible || this._confirming) return;
    const opt = this._options[i];
    const btn = this.optionBtns[i];
    if (!opt || !btn || opt.disabled) return;
    if (opt.safe) { this._applyOption(i); return; }
    // 状态唯一依据 = 共享 ConfirmAction 是否处于待确认态
    if (ConfirmAction.isArmed(btn)) { this._applyOption(i); return; }
    if (!ConfirmAction.arm(btn, { hintEl: this._hints[i], text: CONFIRM_TEXT })) return;
    this._showArmedAffordance(i);
  }

  _showArmedAffordance(i) {
    const detail = this._details[i];
    const confirmBtn = this._confirmBtns[i];
    const hint = this._hints[i];
    if (detail && detail.style.display === 'none' && detail.textContent) detail.style.display = 'block';
    if (confirmBtn) confirmBtn.style.display = 'inline-flex';
    if (hint) hint.style.display = 'block';
  }

  _resetArmedCard(btn) {
    const i = this.optionBtns.indexOf(btn);
    if (i < 0) return;
    const detail = this._details[i];
    const confirmBtn = this._confirmBtns[i];
    const hint = this._hints[i];
    if (detail) detail.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (hint) hint.style.display = 'none';
  }

  /** 确认：业务同一 tick 立即执行，随后卡片 1.5 秒淡出，淡出结束再落位 */
  _applyOption(i) {
    if (!this.visible || this._confirming) return false;
    const opt = this._options[i];
    const btn = this.optionBtns[i];
    if (!opt || !btn || opt.disabled) return false;

    this._confirming = true;
    if (!ConfirmAction.isArmed(btn)) {
      ConfirmAction.arm(btn, { hintEl: this._hints[i], text: CONFIRM_TEXT });
    }
    this._showArmedAffordance(i);
    // 淡出期间整块选项区不再响应点击（重复点击无效）
    this.optionAreaEl.style.pointerEvents = 'none';

    const pending = this._resolveNext(opt, i);
    const started = ConfirmAction.trigger(btn, () => {
      // 业务先于动画：结算效果 + 回调 + 正文立即切换
      // 事件结算只在这里发生；跳过 / 推进正文都不会触发
      this._settleOption(opt);
      try {
        if (typeof opt.onSelect === 'function') opt.onSelect({ ...this.ctx, option: opt });
      } catch (err) {
        devLog.error('[StoryUI.onSelect]', err);
      }
      this.ctx.option = opt;
      this._pending = pending;
      if (pending.kind === 'node') this._renderPendingNode(pending.key);
    }, {
      fadeTarget: btn,
      fadeMs: this.confirmFadeMs,
      onFaded: () => {
        this._confirming = false;
        const p = this._pending;
        this._pending = null;
        if (!p || p.kind === 'end') { this._finish('option-end'); return; }
        this._goto(p.key);
      },
    });
    if (!started) {
      this._confirming = false;
      this.optionAreaEl.style.pointerEvents = '';
      return false;
    }
    return true;
  }

  /**
   * 选项驱动的结算入口。
   * 只在选项确认的同一 tick 调用；同一事件里同一节点同一选项只结算一次。
   * 词表与执行逻辑在 src/systems/EventEffects.js，UI 不写死任何数值规则。
   * @returns {string[]} 效果摘要（空数组 = 该选项没有结算效果）
   */
  _settleOption(opt) {
    const effects = Array.isArray(opt?.effects) ? opt.effects : [];
    if (effects.length === 0) return [];
    const gs = this.ctx.gs || this.director?.getGS?.() || null;
    if (!gs) {
      devLog.warn('[StoryUI] 无 gs，跳过事件结算', opt);
      return [];
    }
    // 选项 id 在单个事件内唯一；缺省时退回「节点 + 文案」保证可去重
    const key = opt.id
      ? `option:${opt.id}`
      : `option:${this.nodeKey}:${opt.label}`;
    if (this._settled.has(key)) {
      devLog.warn('[StoryUI] 选项已结算，忽略重复执行', key);
      return [];
    }
    this._settled.add(key);
    const summary = applyEventEffects(gs, effects, {
      ...this.ctx,
      gs,
      option: opt,
      script: this.script,
      nodeKey: this.nodeKey,
    });
    this.ctx.settlement = { nodeKey: this.nodeKey, optionId: opt.id || null, summary };
    if (summary.length > 0) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🎲 ${summary.join(' / ')}`, duration: 2400 });
    }
    return summary;
  }

  _resolveNext(opt, i) {
    const node = this._node();
    if (opt.end) return { kind: 'end' };
    const key = opt.next || node?.next || null;
    if (!key) return { kind: 'end' };
    if (!this.script?.nodes?.[key]) {
      devLog.warn('[StoryUI] 选项跳转目标不存在', i, key);
      return { kind: 'end' };
    }
    return { kind: 'node', key };
  }

  // ─────────────────────────────────────── 结束 / 关闭
  _finish(reason) {
    if (!this.visible) return;
    const script = this.script;
    const ctx = this.ctx;
    this._hide();
    this.script = null;
    this.ctx = {};
    this.nodeKey = null;
    EventBus.emit(GE.STORY_END, { id: script?.id, reason });
    if (typeof script?.onEnd === 'function') {
      try { script.onEnd(ctx); } catch (err) { devLog.error('[StoryUI.onEnd]', err); }
    }
    devLog.info('[StoryUI] end', script?.id, 'reason=', reason);
  }

  _hide() {
    ConfirmAction.disarmAll();
    this.visible = false;
    this._confirming = false;
    this._pending = null;
    if (this.mask) this.mask.style.display = 'none';
    if (this.layer) this.layer.style.display = 'none';
    this._clearOptions();
  }

  // ─────────────────────────────────────── 键盘
  _onKeyDown(e) {
    if (!this.visible) return;
    // 跳过确认弹窗打开时让渡键盘给 DialogBox
    if (this.director?.dialogBox?.visible) return;
    const key = String(e.key || '').toLowerCase();

    if (key === 'escape') {
      e._storyConsumedEsc = true;
      this.requestSkip();
      return;
    }
    if (key === ' ' || key === 'space' || key === 'enter') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this.advance();
      return;
    }
    const n = Number.parseInt(key, 10);
    if (n >= 1 && n <= this.optionBtns.length) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      this._chooseOption(n - 1);
    }
  }
}

export default StoryUI;
