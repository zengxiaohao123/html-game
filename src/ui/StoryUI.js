// src/ui/StoryUI.js
// §16.5 / §18.2 剧情区 + 选项区（剧情与事件共用同一套 UI）
//
// 版式逐项量取自 docs/_art-references/事件ui点击前.jpg / 事件ui一次点击.jpg（1920×868）：
//   · 事件文本块（左下）
//       - 参考图标题墨迹 70.8%–73.0%H、正文首行 74.9%H、行距 3.17%H、末行 86.3%H
//       - 右边界 60.0%W 不变；左边界取徽记直径 `min(8.6vw,17.2vh)`，
//         徽记左缘贴屏幕左边缘，正文从徽记右缘起笔
//       - 正文区**尺寸恒定** `20vh`：文字少留白、不缩；文字多不撑高，按实际渲染高度
//         自动分页，点击推进下一页。块顶 71vh、正文底边约 95%H（只压顶、不动底）
//       - 圆形徽记直径 `min(8.6vw,17.2vh)`，左缘贴屏幕，圆心约 (3.9%W, 77%H)
//       - 正文落在一块深色「旧纸卷」底板上（.story-scroll，纯装饰层）：
//         深松林墨绿渐变 + 墨渍 / 茶金晕染 / 纤维纹 + clip-path 手撕边 + 茶金细内框
//   · 正文切换：淡出 240ms → 换页 / 换分支 → 淡入 180ms（不做逐字打字机）
//   · 选项只在「本节点需要选择 + 已到末页 + 文本播放完」后出现
//   · 选项区（右侧整列）
//       - x 70.3vw–99.4vw（卡片宽 29.1vw 不变，整列右移，右侧留 0.6vw 安全边）；不透明深松林卡片，白字标题 + 浅苔绿描述，不使用透明底或暗斑
//       - 整体在选项区内垂直居中（上沿 22.5vh，下沿贴固定的正文区底边）
//       - 参考节距 20.6vh（卡高 17.6 + 间距 3），四选项时收紧
//       - 确认提示与确认印章在卡片底部预留行内，不压字、不顶开其它选项
//   · 跳过入口在正文块右上角（右缘 60vw），右侧整列完全留给选项
//
// 交互：
//   · 第一次点击选项 = 进入待确认（整张选项卡都是点击目标，含标题条与描述）；
//     第二次点击同一张卡任意位置 = 同一 tick 立即生效，稳定可靠
//   · 所有选项（含「离开」）一律二次确认，没有单击即生效的例外
//   · 结果文本阶段只把 cursor 改成 pointer，不抬层级、不额外变暗
//   · 输入封锁：InputGate 读取 this.visible（§18.3），事件期间仅放行纯查看与存读档
//
// 数据驱动（src/data/stories.js）：UI 不写死任何文案，只渲染 label / sub / detail /
// disabledReason；选项 id、节点层级、数字键位均不上屏。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { createEl, qs, clearChildren } from './dom.js';
import { CONFIRM_TEXT, CONFIRM_FADE_MS } from './ConfirmAction.js';
import { shield, unshield } from './InputGuard.js';
import { applyEventEffects } from '../systems/EventEffects.js';

/** 超过该数量的选项改为上下滚动（4 个及以内仍按参考图整列铺开） */
export const SCROLL_OPTION_THRESHOLD = 4;

/** §18.3：事件 / 剧情期间允许保留的界面（纯查看 + 存读档设置） */
const STORY_KEEP_PANELS = new Set(['inventory', 'role', 'task', 'codex', 'settings']);

/** 事件层 z-index：低于面板 6000 / 设置 6200，高于快捷栏与功能区 5600 */
export const STORY_Z = {
  MASK: 5700,
  LAYER: 5750,
};

/** 正文切换动画：先淡出 240ms，换页 / 换分支后再淡入 180ms；不做逐字打字机 */
const TEXT_FADE_OUT_MS = 240;
const TEXT_FADE_IN_MS = 180;

/** 正文分页的最小单元：不拆开【词条】与数字，换行 / 空白 / 英文词各算一个单元 */
const TEXT_TOKEN_RE = /【[^】]*】|\d+(?:\.\d+)?%?|\r?\n|[^\S\n]+|[A-Za-z]+|[\s\S]/g;

function tokenizeText(raw) {
  const text = String(raw ?? '');
  const out = [];
  TEXT_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TEXT_TOKEN_RE.exec(text)) !== null) out.push(m[0]);
  return out;
}

/** 正文规范化：数组 = 多段（段间空一行），字符串保留自身换行 */
function normalizeText(text) {
  if (Array.isArray(text)) return text.filter((s) => s != null && s !== '').join('\n\n');
  return String(text ?? '');
}

/**
 * 富文本渲染：只做「分期着色」，逐字保留原文（绝不改写 / 省略任何玩家可见文本）。
 * 数字 → 金色；【词条】→ 松林绿。其余按普通描述色。
 */
function fillRichText(el, text) {
  const raw = String(text ?? '');
  el.textContent = '';
  const re = /(\d+(?:\.\d+)?%?|【[^】]*】)/g;
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      createEl('span', { class: ['story-token'], text: raw.slice(last, m.index), parent: el });
    }
    const isTerm = m[0].startsWith('【');
    createEl('span', {
      class: [isTerm ? 'story-token-term' : 'story-token-num'],
      text: m[0],
      parent: el,
    });
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    createEl('span', { class: ['story-token'], text: raw.slice(last), parent: el });
  }
}

export class StoryUI {
  constructor(director = null) {
    this.director = director;
    this.mask = null;           // 暗色薄纱（拦截地图点击）
    this.layer = null;          // 剧情区 + 选项区容器（pointer-events:none）
    this.storyPanel = null;     // 事件文本块（可点击推进）
    this.emblemEl = null;       // 圆形徽记
    this.emblemGlyphEl = null;  // 徽记内的图标
    this.titleEl = null;        // 事件标题
    this.textEl = null;         // 正文
    this.measureEl = null;      // 正文分页测量层（隐藏，不参与可见排版）
    this.optionAreaEl = null;   // 选项区

    this.visible = false;
    this._resultMode = false;   // 结果文本态：点击屏幕任意处 = 关闭事件
    this.script = null;
    this.nodeKey = null;
    this.ctx = {};

    this._options = [];
    this.optionBtns = [];
    this.optionBars = [];
    this._hints = [];
    this._confirmBtns = [];
    this._armedIndex = -1;      // 待确认的选项下标（-1 = 无）
    this._confirming = false;   // 已确认、淡出中（禁止再次选择）
    this._fadeTimer = null;
    this._pending = null;       // 选项结算后的去向 {kind:'node'|'end', key}
    this._settled = new Set();  // 本次事件已结算的选项键（防止同一选项重复结算）

    // 正文分页 / 过渡状态
    this._rawText = '';         // 当前节点规范化后的全文
    this._pages = [];           // 按固定文本区高度切出的页
    this._pageIndex = 0;
    this._transitioning = false;
    this._textTimer = null;
    this._previewKey = null;    // 选项淡出期间已抢先渲染正文的节点
    this._optionsShown = false; // 当前节点选项是否已经上屏

    // 冒烟测试可覆写以加速（文档口径 1.5 秒）
    this.confirmFadeMs = CONFIRM_FADE_MS;
    // 冒烟测试可覆写为 0：跳过正文淡出 / 淡入，走同步渲染
    this.textFadeOutMs = TEXT_FADE_OUT_MS;
    this.textFadeInMs = TEXT_FADE_IN_MS;

    this._onDocClick = (e) => this._handleDocumentClick(e);
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onResizeBound = () => this._onResize();
  }

  // ─────────────────────────────────────── 骨架
  mount(parent = qs('body')) {
    // 薄纱：没有事件背景图，用暗色遮罩保证正文可读，并拦截地图 / 快捷栏点击。
    // 层级（§18.2 / §19）：高于地图、快捷栏、功能区（≤5600）与信息区（100），
    // 但 **低于** 背包 / 角色 / 编队 / 任务等面板（6000）与设置（6200）。
    // 结果文本态只把 cursor 改成 pointer，**不抬层级、不加暗**。
    this.mask = createEl('div', {
      class: ['story-mask'],
      style: {
        position: 'fixed', inset: '0',
        backgroundColor: 'rgba(14, 20, 24, 0.34)',
        zIndex: String(STORY_Z.MASK),
        display: 'none',
      },
      parent,
    });
    this.mask.onclick = () => {
      if (!this.visible) return;
      if (this._resultMode) { this._finish('result-dismiss'); return; }
      this.advance();
    };

    this.layer = createEl('div', {
      class: ['story-layer'],
      style: {
        position: 'fixed', inset: '0',
        zIndex: String(STORY_Z.LAYER),
        pointerEvents: 'none',
        display: 'none',
      },
      parent,
    });

    this._mountStoryPanel();
    this._mountSkipButton();
    this._mountOptionArea();

    document.addEventListener('click', this._onDocClick);
    window.addEventListener('keydown', this._onKeyDownBound);
    window.addEventListener('resize', this._onResizeBound);

    EventBus.on(GE.STORY_SHOW, (p = {}) => this.show(p.script || p, p.ctx || {}));
    // 读档 / 重开：丢弃剧情演出，静默关闭（不触发 onEnd 结算）
    EventBus.on(GE.STATE_RESET, () => this.closeSilently('state-reset'));
    EventBus.on(GE.BOOT, () => this.closeSilently('boot'));

    if (this.director) this.director.storyUI = this;
    return this.layer;
  }

  _mountStoryPanel() {
    // 事件文本块：徽记 + 标题 + 正文，锚点固定（不随行数浮动）
    this.storyPanel = createEl('div', {
      class: ['story-panel'],
      style: { pointerEvents: 'auto' },
      parent: this.layer,
    });
    this.storyPanel.onclick = () => {
      if (!this.visible) return;
      if (this._resultMode) { this._finish('result-dismiss'); return; }
      this.advance();
    };

    // 正文底板：深墨绿「旧纸卷」，撕边 + 纤维纹 + 茶金内框（纯装饰层）。
    // 绝对定位、不参与 _layout() 的 rect 测量，版式数值与对齐关系不受影响。
    createEl('div', { class: ['story-scroll'], parent: this.storyPanel });

    this.emblemEl = createEl('div', { class: ['story-emblem'], parent: this.storyPanel });
    createEl('div', { class: ['story-emblem-ring'], parent: this.emblemEl });
    this.emblemGlyphEl = createEl('div', { class: ['story-emblem-glyph'], parent: this.emblemEl });
    createEl('div', { class: ['story-emblem-glint'], parent: this.emblemEl });

    const body = createEl('div', { class: ['story-body'], parent: this.storyPanel });
    this.titleEl = createEl('div', { class: ['story-title'], parent: body });
    this.textEl = createEl('div', { class: ['story-text'], parent: body });
    // 分页测量层：同宽度 / 同字号 / 同换行，隐藏但参与布局；分页时不改动玩家可见正文
    this.measureEl = createEl('div', {
      class: ['story-text', 'story-text-measure'],
      style: {
        position: 'absolute',
        left: '0',
        right: '0',
        top: '0',
        height: 'auto',
        overflow: 'visible',
        visibility: 'hidden',
        pointerEvents: 'none',
      },
      parent: body,
    });
  }

  _mountSkipButton() {
    // 事件文本块右上角的跳过入口：挂在文本块内部，块整体上移时跟着走；
    // 右缘 = 文本块右缘（60vw），右侧整列属于选项，因此不贴屏幕右缘。
    const closeBtn = this.skipEl = createEl('button', {
      class: ['story-skip'],
      attrs: { type: 'button', title: '跳过 / 关闭（需确认）', 'aria-label': '跳过剧情' },
      parent: this.storyPanel,
    });
    createEl('span', { class: ['story-skip-label'], text: '跳过', parent: closeBtn });
    createEl('span', { class: ['story-skip-x'], text: '✕', parent: closeBtn });
    closeBtn.onclick = (e) => {
      if (e?.stopPropagation) e.stopPropagation();
      this.requestSkip();
    };
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
    this._clearFadeTimer();
    this._clearTextTimer();
    this._confirming = false;
    this._armedIndex = -1;
    this._pending = null;
    this._settled = new Set();
    this._transitioning = false;
    this._previewKey = null;
    this._rawText = '';
    this._pages = [];
    this._pageIndex = 0;
    this._optionsShown = false;
    this.textEl?.classList?.remove?.('is-swapping');
    this._exitResultMode();
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
    // 事件期间快捷栏整体让位：文本块已下移到屏幕底部（参考图信息栏的位置），
    // 而快捷栏正压在这块区域上；事件期间快捷栏本来就不可用（§18.3 输入封锁）。
    document.body?.classList?.add('story-active');

    // §18.3：信息区等会改动数据的界面不允许在事件期间保持打开（会盖在选项区之上），
    // 进入剧情时立即收起；背包 / 角色 / 任务 / 图鉴（纯查看）与设置（存读档）保留。
    for (const p of [...(this.director?.openPanels || [])]) {
      if (!STORY_KEEP_PANELS.has(p)) EventBus.emit(GE.UI_PANEL_CLOSE, { panel: p });
    }
    if (this.emblemGlyphEl) this.emblemGlyphEl.textContent = String(script.icon || '🎲');
    this.titleEl.textContent = String(script.title || '');
    this.titleEl.style.display = script.title ? '' : 'none';
    if (this.emblemEl) this.emblemEl.setAttribute('aria-hidden', 'true');
    if (this.storyPanel) this.storyPanel.setAttribute('aria-label', String(script.title || ''));

    this._renderNode();
    // 字体异步加载完成后行高可能变化，按固定文本区重新分页一次
    if (document.fonts?.ready?.then) {
      document.fonts.ready.then(() => { if (this.visible) this._onResize(); }).catch(() => {});
    }
    EventBus.emit(GE.STORY_START, { id: script.id, title: script.title });
    devLog.info('[StoryUI] show', script.id, 'start=', script.start);
    return true;
  }

  /** 推进：先翻完当前节点的正文页，末页才允许进入下一节点；选项阶段不推进 */
  advance() {
    if (!this.visible || this._confirming || this._transitioning) return false;
    if (this._armedIndex >= 0) { this._disarm(); return false; }
    if (this._pageIndex < this._pages.length - 1) { this._nextPage(); return true; }
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
    this._disarm();
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
   * 实时刷新当前节点（数据改动后无需额外操作；§16.2 UI 通用实时契约）。
   * 待确认 / 淡出期间不重建选项，避免打断玩家手势。
   */
  refresh() {
    if (!this.visible) return false;
    const node = this._node();
    if (!node) return false;
    if (this._confirming || this._armedIndex >= 0) return true;
    this._clearTextTimer();
    this._transitioning = false;
    this.textEl?.classList?.remove?.('is-swapping');
    this._clearOptions();
    this._options = this._collectOptions(node);
    this._optionsShown = false;
    this._rawText = normalizeText(node.text);
    this._pages = this._paginate(this._rawText);
    this._pageIndex = 0;
    this._renderPage(0);
    this._afterTextShown();
    this._layout();
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

  /** 当前处于待确认的选项下标（-1 = 无）；供测试与键盘逻辑复用 */
  get armedIndex() {
    return this._armedIndex;
  }

  /** 指定选项是否处于待确认态 */
  isOptionArmed(i) {
    return this._armedIndex === i;
  }

  // ─────────────────────────────────────── 节点渲染
  _node() {
    return this.script?.nodes?.[this.nodeKey] || null;
  }

  _collectOptions(node) {
    return Array.isArray(node?.options) ? node.options : [];
  }

  _renderNode() {
    const node = this._node();
    if (!node) { this._finish('missing-node'); return; }
    this.ctx.nodeKey = this.nodeKey;

    // 选项淡出期间已经抢先演过这个节点的正文：这里只补选项，不重播动画
    const keepText = this._previewKey === this.nodeKey && this._pages.length > 0;
    this._previewKey = null;

    this._clearOptions();
    this._options = this._collectOptions(node);
    this._optionsShown = false;
    if (keepText) {
      if (!this._transitioning) this._afterTextShown();
    } else {
      this._startText(node.text);
    }
    this._layout();
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

  // ─────────────────────────────────────── 正文分页 / 过渡
  /**
   * 正文进入固定文本区：先按实际渲染高度分页，再从第一页开始播放。
   * 文本区尺寸由 CSS 固定（24vh），字号 / 行高不变，分页结果与窗口尺寸相关。
   */
  _startText(text) {
    this._rawText = normalizeText(text);
    this._pages = this._paginate(this._rawText);
    this._pageIndex = 0;
    this._swapText(() => this._renderPage(0));
  }

  /**
   * 分页：以固定文本区的实际可用高度为界，逐页取「能完整放下的最大前缀」。
   * 测量用并排的隐藏测量层（同字号 / 同宽度 / 同行高），不改动玩家正在看的正文；
   * 无布局环境（测试桩 / 文本为空）时退化为单页，保证不丢字。
   */
  _paginate(raw) {
    const measure = this.measureEl;
    const height = this.textEl?.clientHeight;
    if (!measure || !(height > 0) || typeof measure.scrollHeight !== 'number' || !raw) return [raw];
    const tokens = tokenizeText(raw);
    if (!tokens.length) return [raw];

    const fits = (s) => {
      fillRichText(measure, s);
      return measure.scrollHeight <= height + 1;
    };

    const pages = [];
    let start = 0;
    while (start < tokens.length) {
      let lo = 1;
      let hi = tokens.length - start;
      let best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(tokens.slice(start, start + mid).join(''))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const end = start + best;
      let page = tokens.slice(start, end).join('');
      // 段间空行不落在下一页页首（避免翻页后顶出一行空白）
      if (pages.length) page = page.replace(/^\n+/, '');
      pages.push(page);
      start = end;
    }
    return pages.length ? pages : [raw];
  }

  _renderPage(index) {
    if (!this.textEl) return;
    fillRichText(this.textEl, this._pages[index] ?? '');
  }

  /** 淡出 240ms → 换页 / 换分支 → 淡入 180ms；两段都为 0 时同步渲染（测试口径） */
  _swapText(apply) {
    const outMs = Math.max(0, Number(this.textFadeOutMs) || 0);
    const inMs = Math.max(0, Number(this.textFadeInMs) || 0);
    this._clearTextTimer();
    if (!this.textEl || (!outMs && !inMs)) {
      this._transitioning = false;
      this.textEl?.classList?.remove?.('is-swapping');
      apply();
      this._afterTextShown();
      return;
    }
    this._transitioning = true;
    this.textEl.classList.add('is-swapping');
    this._textTimer = setTimeout(() => {
      apply();
      // 强制回流，让淡入从换页后的这一帧起算
      void this.textEl.offsetHeight;
      this.textEl.classList.remove('is-swapping');
      this._textTimer = setTimeout(() => {
        this._textTimer = null;
        this._afterTextShown();
      }, inMs);
    }, outMs);
  }

  /** 正文播放完（含淡入）后的统一收尾：末页才放选项，再判定结果态 */
  _afterTextShown() {
    this._transitioning = false;
    if (!this.visible || this._confirming) return;
    if (this._pageIndex < this._pages.length - 1) { this._syncResultMode(); return; }
    this._revealOptions();
    this._syncResultMode();
    this._layout();
  }

  /** 本节点有选项且已到末页、正文播放完，才把选项放上屏 */
  _revealOptions() {
    if (this._optionsShown) return;
    this._optionsShown = true;
    if (this._options.length) this._renderOptions();
  }

  _nextPage() {
    this._pageIndex += 1;
    this._exitResultMode();
    this._swapText(() => this._renderPage(this._pageIndex));
  }

  _clearTextTimer() {
    if (this._textTimer) {
      clearTimeout(this._textTimer);
      this._textTimer = null;
    }
  }

  /** 窗口尺寸 / 字体就绪：重新分页，尽量停在当前页，文本区尺寸不变 */
  _onResize() {
    this._layout();
    if (!this.visible || this._confirming || this._transitioning || !this._rawText) return;
    const page = this._pageIndex;
    this._pages = this._paginate(this._rawText);
    this._pageIndex = Math.min(page, Math.max(0, this._pages.length - 1));
    this._renderPage(this._pageIndex);
    this._syncResultMode();
    this._layout();
  }

  /** 淡出期间的过渡态：只换正文，选项区保持旧卡（不可点）直到淡出结束 */
  _renderPendingNode(key) {
    const node = this.script?.nodes?.[key];
    if (!node) return false;
    this.nodeKey = key;
    this.ctx.nodeKey = key;
    this._options = this._collectOptions(node);
    this._optionsShown = false;
    this._previewKey = key;
    this._startText(node.text);
    EventBus.emit(GE.STORY_NODE, { id: this.script?.id, nodeKey: key });
    this._layout();
    return true;
  }

  /**
   * 结果态判定：节点既没有选项、也没有 next（或标了 end）时，
   * 且正文已经翻到末页，点击屏幕任意处关闭事件（参考图结果文本的收尾方式）。
   */
  _syncResultMode() {
    const node = this._node();
    const onLastPage = this._pageIndex >= this._pages.length - 1;
    const isResult = onLastPage
      && !!node
      && this._options.length === 0
      && (node.end === true || !node.next);
    if (isResult && !this._confirming) this._enterResultMode();
    else this._exitResultMode();
  }

  _enterResultMode() {
    if (this._resultMode) return;
    this._resultMode = true;
    // 只改指针反馈：**不抬层级、不改薄纱深浅**，结果阶段屏幕亮度与叙事阶段一致
    if (this.mask) this.mask.style.cursor = 'pointer';
  }

  _exitResultMode() {
    this._resultMode = false;
    if (this.mask) this.mask.style.cursor = '';
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
    this._disarm();
    this._options = [];
    this._optionsShown = false;
    this.optionBtns = [];
    this.optionBars = [];
    this._hints = [];
    this._confirmBtns = [];
    if (this.optionAreaEl) {
      clearChildren(this.optionAreaEl);
      this.optionAreaEl.classList.remove('is-fading');
      this.optionAreaEl.style.removeProperty?.('--option-fade-ms');
      this.optionAreaEl.style.display = 'none';
      this.optionAreaEl.style.pointerEvents = '';
      unshield(this.optionAreaEl);
    }
  }

  _renderOptions() {
    const area = this.optionAreaEl;
    if (!area) return;
    clearChildren(area);
    this.optionBtns = [];
    this.optionBars = [];
    this._hints = [];
    this._confirmBtns = [];
    this._armedIndex = -1;
    if (!this._options.length) { area.style.display = 'none'; unshield(area); return; }

    area.style.display = 'flex';
    area.style.pointerEvents = '';
    unshield(area);
    // 3 个选项照参考图节距（卡高 17.6 + 间距 3 ≈ 20.6vh）；4 个选项收紧；
    // 超过 4 个改为固定节距 + 选项区内部上下滚动，不再压缩卡片互相叠压。
    const scroll = this._options.length > SCROLL_OPTION_THRESHOLD;
    area.classList.toggle('is-scroll', scroll);
    area.classList.toggle('is-four', !scroll && this._options.length >= 4);

    this._options.forEach((opt, i) => {
      const card = createEl('div', {
        class: ['story-option'],
        attrs: { 'data-opt-idx': String(i), role: 'button', tabindex: '0' },
        parent: area,
      });

      // 白条：参考图里只有主标题在条内
      const bar = createEl('div', { class: ['story-option-bar'], parent: card });
      this.optionBars.push(bar);
      createEl('div', {
        class: ['story-option-label'],
        text: String(opt.label || '选项'),
        parent: bar,
      });
      createEl('div', { class: ['story-option-mark'], parent: bar });

      // 描述区：sub / detail 全部常驻，每句独立成行
      this._renderDescription(card, opt);

      // 确认行：常驻占位（不撑高选项、不推动下一条），待确认时才显形
      const confirmRow = createEl('div', { class: ['story-option-confirm-row'], parent: card });
      const hint = createEl('div', {
        class: ['story-option-hint'],
        text: CONFIRM_TEXT,
        parent: confirmRow,
      });
      hint.style.display = 'none';

      const confirmBtn = createEl('span', {
        class: ['story-option-confirm'],
        attrs: { 'aria-hidden': 'true' },
        parent: confirmRow,
      });
      createEl('span', { class: ['story-option-confirm-check'], text: '✓', parent: confirmBtn });
      confirmBtn.style.display = 'none';

      if (opt.disabled) {
        card.classList.add('disabled');
        card.setAttribute('aria-disabled', 'true');
      } else {
        card.onclick = () => this._chooseOption(i);
      }

      this.optionBtns.push(card);
      this._hints.push(hint);
      this._confirmBtns.push(confirmBtn);
    });

    // 选项列下沿贴固定正文区的底边
    this._layout();
  }

  /**
   * 排布选项列（选项重建后 / 窗口尺寸变化时调用）。
   *
   * 正文区尺寸恒定（CSS `24vh`），所以：
   *  1. 选项区下沿直接贴正文区底边，不再随行数变化；
   *  2. 选项自然高度总和超过可用高度时逐级压缩间距，保证内容不越过底边；
   *  3. 超过 4 项时保持固定节距，交给 `.option-area.is-scroll` 内部滚动。
   */
  _layout() {
    const area = this.optionAreaEl;
    if (!area || area.style.display === 'none') return;
    const vh = window.innerHeight || 0;
    const rect = this.textEl?.getBoundingClientRect?.();
    if (!rect || !rect.height || !vh) return;
    area.style.bottom = `${Math.max(0, vh - rect.bottom).toFixed(1)}px`;

    if (area.classList.contains('is-scroll')) {
      area.style.gap = '2.2vh';
      return;
    }
    const base = area.classList.contains('is-four') ? 2.2 : 3;
    for (const ratio of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      area.style.gap = `${(base * ratio).toFixed(2)}vh`;
      if (area.scrollHeight <= area.clientHeight + 1) break;
    }
  }

  _renderDescription(card, opt) {
    const lines = [];
    if (opt.sub) lines.push(...String(opt.sub).split('\n'));
    if (opt.detail) lines.push(...String(opt.detail).split('\n'));
    if (opt.disabled && opt.disabledReason) lines.push(`不可选：${opt.disabledReason}`);
    if (!lines.length) return;

    const wrap = createEl('div', { class: ['story-option-desc'], parent: card });
    lines.filter((s) => s !== '').forEach((line) => {
      const row = createEl('div', {
        class: ['story-option-detail'].concat(
          line.startsWith('不可选：') ? ['story-option-reason'] : [],
        ),
        parent: wrap,
      });
      fillRichText(row, line);
    });
  }

  /**
   * 点击选项（鼠标 / 数字键共用入口）。
   * 第一次点击 = 进入待确认；再次点击同一张卡（标题条或描述任意位置）= 立即生效。
   */
  _chooseOption(i) {
    if (!this.visible || this._confirming) return false;
    const opt = this._options[i];
    const card = this.optionBtns[i];
    if (!opt || !card || opt.disabled) return false;
    if (this._armedIndex === i) return this._applyOption(i);
    this._arm(i);
    return true;
  }

  /** 进入待确认态（只换样式 + 显示预留的确认行，不改任何数据） */
  _arm(i) {
    if (this._armedIndex === i) return true;
    this._disarm();
    const card = this.optionBtns[i];
    if (!card) return false;
    this._armedIndex = i;
    card.classList.add('is-armed');
    card.setAttribute('aria-pressed', 'true');
    const hint = this._hints[i];
    if (hint) hint.style.display = 'block';
    const seal = this._confirmBtns[i];
    if (seal) seal.style.display = 'inline-flex';
    return true;
  }

  /** 取消待确认态（点别处 / ESC / 切换选项 / 关闭面板的唯一复位入口） */
  _disarm() {
    const i = this._armedIndex;
    this._armedIndex = -1;
    if (i < 0) return false;
    const card = this.optionBtns[i];
    if (card) {
      card.classList.remove('is-armed');
      card.removeAttribute('aria-pressed');
    }
    const hint = this._hints[i];
    if (hint) hint.style.display = 'none';
    const seal = this._confirmBtns[i];
    if (seal) seal.style.display = 'none';
    return true;
  }

  /** 点别处取消待确认：只认「整张选项卡」为内部区域（含标题条与描述） */
  _handleDocumentClick(e) {
    if (!this.visible || this._armedIndex < 0) return;
    const card = this.optionBtns[this._armedIndex];
    const target = e?.target;
    if (card && target && typeof card.contains === 'function' && card.contains(target)) return;
    this._disarm();
  }

  /** 确认：业务同一 tick 立即执行，随后卡片 1.5 秒淡出，淡出结束再落位 */
  _applyOption(i) {
    if (!this.visible || this._confirming) return false;
    const opt = this._options[i];
    const card = this.optionBtns[i];
    if (!opt || !card || opt.disabled) return false;
    if (this._armedIndex !== i) { this._arm(i); return false; }

    this._confirming = true;
    this._armedIndex = -1;
    card.classList.remove('is-armed');
    card.classList.add('is-confirmed');
    // 淡出期间整块选项区吞掉点击（重复点击无效），且不穿透给下层剧情遮罩 / 按钮
    shield(this.optionAreaEl);

    // 概率分叉：选项可带 branches，确认时抽签决定本次效果与去向
    const branch = this._pickBranch(opt);
    const pending = this._resolveNext(opt, i, branch);

    // 业务先于动画：结算效果 + 回调立即完成，正文按 240ms 过渡切到下一节点
    this._settleOption(opt, branch?.effects);
    try {
      if (typeof opt.onSelect === 'function') opt.onSelect({ ...this.ctx, option: opt });
    } catch (err) {
      devLog.error('[StoryUI.onSelect]', err);
    }
    this.ctx.option = opt;
    this._pending = pending;
    if (pending.kind === 'node') this._renderPendingNode(pending.key);

    // 整组选项一起淡化；仅被选中的卡保留金色边框（见 story.css .is-confirmed）
    const fadeMs = Math.max(0, Number(this.confirmFadeMs) || 0);
    this.optionAreaEl.classList.add('is-fading');
    this.optionAreaEl.style.setProperty('--option-fade-ms', `${fadeMs}ms`);
    this._clearFadeTimer();
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._confirming = false;
      const p = this._pending;
      this._pending = null;
      if (!p || p.kind === 'end') { this._finish('option-end'); return; }
      this._goto(p.key);
    }, fadeMs);
    return true;
  }

  _clearFadeTimer() {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  /**
   * 概率分叉抽签：branches = [{ weight, effects?, next?, end? }]。
   * 未配置 branches / 权重全为 0 时返回 null，退回选项自身的 effects / next。
   */
  _pickBranch(opt) {
    const list = Array.isArray(opt?.branches)
      ? opt.branches.filter((b) => b && Number(b.weight) > 0)
      : [];
    if (!list.length) return null;
    const total = list.reduce((sum, b) => sum + Number(b.weight), 0);
    if (!(total > 0)) return null;
    let roll = Math.random() * total;
    for (const b of list) {
      roll -= Number(b.weight);
      if (roll < 0) return b;
    }
    return list[list.length - 1];
  }

  /**
   * 选项驱动的结算入口。
   * 只在选项确认的同一 tick 调用；同一事件里同一节点同一选项只结算一次。
   * 词表与执行逻辑在 src/systems/EventEffects.js，UI 不写死任何数值规则。
   * @param {object} opt 选项
   * @param {Array<object>} [effectsOverride] 概率分叉抽中的那组 effects（缺省用 opt.effects）
   * @returns {string[]} 效果摘要（空数组 = 该选项没有结算效果）
   */
  _settleOption(opt, effectsOverride) {
    const effects = Array.isArray(effectsOverride)
      ? effectsOverride
      : (Array.isArray(opt?.effects) ? opt.effects : []);
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

  _resolveNext(opt, i, branch = null) {
    const node = this._node();
    if (branch?.end) return { kind: 'end' };
    if (opt.end) return { kind: 'end' };
    const key = branch?.next || opt.next || node?.next || null;
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
    this._clearFadeTimer();
    this._clearTextTimer();
    this._disarm();
    this.visible = false;
    this._confirming = false;
    this._pending = null;
    this._transitioning = false;
    this._previewKey = null;
    this._rawText = '';
    this._pages = [];
    this._pageIndex = 0;
    this.textEl?.classList?.remove?.('is-swapping');
    this._exitResultMode();
    if (this.mask) this.mask.style.display = 'none';
    if (this.layer) this.layer.style.display = 'none';
    document.body?.classList?.remove('story-active');
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
      // 待确认态下 ESC 先取消待确认，不直接弹跳过
      if (this._armedIndex >= 0) { this._disarm(); return; }
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
