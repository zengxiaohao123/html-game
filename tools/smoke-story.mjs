// tools/smoke-story.mjs —— §16.5 剧情区 + 选项区冒烟
// 用法：node tools/smoke-story.mjs
//
// 覆盖口径（用户要求）：
//   · 无选项旁白 / 有选项 / 选项回调生效 / 推进到底关闭
//   · 二次确认（首次点击待确认、再次点击同一 tick 生效）
//   · 禁用态不可选、键位 1~4、安全选项单击生效
//   · 跳过只停在选项处，选项段必须手动选择
//   · 剧情期间输入封锁、结束后恢复
//   · 数据驱动（事件脚本由占位事件条目生成，UI 不写死文案）+ 实时刷新

// ════════════════════════════════════════════════════════════
// 0. 最小 DOM 桩（在任何 src 模块运行之前装好；用 await import 保证顺序）
// ════════════════════════════════════════════════════════════
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.style.setProperty = () => {};
    this.attributes = Object.create(null);
    this._listeners = Object.create(null);
    this._text = '';
    this._classes = new Set();
    this.id = '';
    this.disabled = false;
    this.onclick = null;
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._classes;
    return {
      add: (...cs) => cs.forEach((c) => s.add(c)),
      remove: (...cs) => cs.forEach((c) => s.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c);
        return on;
      },
      contains: (c) => s.has(c),
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { if (String(v) === '') this.children = []; this._text = ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  removeEventListener(t, fn) {
    const a = this._listeners[t];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  dispatchEvent(ev) {
    for (const fn of [...(this._listeners[ev.type] || [])]) fn.call(this, ev);
    if (ev.type === 'click' && typeof this.onclick === 'function') this.onclick.call(this, ev);
    return true;
  }
  click() {
    this.dispatchEvent({
      type: 'click', target: this,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    });
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
}

const body = new FakeEl('body');
const docListeners = Object.create(null);
globalThis.document = {
  body,
  head: new FakeEl('head'),
  createElement: (t) => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  addEventListener: (t, fn) => { (docListeners[t] ??= []).push(fn); },
  removeEventListener: (t, fn) => {
    const a = docListeners[t];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  },
  querySelector: (sel) => (sel === 'body' ? body : null),
  getElementById: () => null,
};

const winListeners = Object.create(null);
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ??= []).push(fn); },
  removeEventListener: (t, fn) => {
    const a = winListeners[t];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  },
  dispatchEvent: (ev) => {
    for (const fn of [...(winListeners[ev.type] || [])]) fn.call(globalThis.window, ev);
    return true;
  },
  innerWidth: 1280,
  innerHeight: 720,
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

/** 派发一次 window 键盘事件 */
function key(k) {
  globalThis.window.dispatchEvent({
    type: 'keydown', key: k,
    preventDefault() {}, stopPropagation() {},
  });
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
// 1. 载入模块
// ════════════════════════════════════════════════════════════
const { StoryUI, MAX_OPTIONS } = await import('../src/ui/StoryUI.js');
const { buildEventStory, demoStory } = await import('../src/data/stories.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const InputGate = await import('../src/systems/InputGate.js');
const ConfirmAction = await import('../src/ui/ConfirmAction.js');

let pass = 0;
let fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

/** 深度收集带指定 class 的元素（FakeEl 没有 querySelector） */
function findAll(el, cls, out = []) {
  if (!el) return out;
  if (el.classList?.contains?.(cls)) out.push(el);
  for (const c of el.children || []) findAll(c, cls, out);
  return out;
}

const gs = { buildMode: false, uiState: { blessing: false }, player: {}, map: { outerTiles: [] } };
const director = {
  getGS: () => gs,
  openPanels: [],
  mainMenu: { visible: false },
  dialogBox: null,
  settingsPanel: null,
};
const ui = new StoryUI(director);
ui.mount(body);
director.storyUI = ui;                 // mount 里已自动挂载；此处显式赋值便于阅读
ui.confirmFadeMs = 0;                  // 加速淡出（文档口径仍为 1.5 秒）

const storyEnds = [];
EventBus.on(GE.STORY_END, (p) => storyEnds.push(p));
const dialogs = [];
EventBus.on(GE.DIALOG_SHOW, (p) => dialogs.push(p));
const toasts = [];
EventBus.on(GE.TOAST_SHOW, (p) => toasts.push(p));

// ════════════════════════════════════════════════════════════
head('A. 无选项旁白：逐段推进 → 推进到底关闭');
// ════════════════════════════════════════════════════════════
const narration = {
  id: 't_narr',
  start: 'a',
  nodes: {
    a: { text: ['第一段。', '第二段。'], next: 'b' },
    b: { text: '第三段。', end: true },
  },
};
check(ui.show(narration) === true, 'A-01 旁白脚本打开');
check(ui.visible === true, 'A-02 剧情区可见');
check(ui.mask.style.display === 'block', 'A-03 暗色薄纱已显示（拦截地图点击）');
check(ui.textEl.textContent.includes('第一段。') && ui.textEl.textContent.includes('第二段。'),
  'A-04 多段正文按段渲染（段间空行）', ui.textEl.textContent);
check(ui.optionBtns.length === 0 && ui.optionAreaEl.style.display === 'none',
  'A-05 无选项时选项区隐藏');
check(findAll(ui.storyPanel, 'story-prompt-text').length === 0
  && !ui.storyPanel.textContent.includes('继续')
  && !ui.storyPanel.textContent.includes('请选择'),
  'A-06 不显示「继续 / 请选择」提示文本');

ui.advance();
check(ui.nodeKey === 'b' && ui.textEl.textContent === '第三段。', 'A-07 推进到下一段');
check(ui.advance() === true && ui.visible === false, 'A-08 最后一段推进 → 关闭');
check(storyEnds.length === 1 && storyEnds[0].id === 't_narr' && storyEnds[0].reason === 'advance-end',
  'A-09 结束事件携带脚本 id 与原因', storyEnds[0]);
check(ui.mask.style.display === 'none', 'A-10 结束后薄纱收起');

// 事件标题上屏（参考图正文上方的浅青绿标题行）
ui.show({ id: 't_title', title: '沉寂之屋', start: 'a', nodes: { a: { text: '正文。', end: true } } });
check(ui.titleEl.textContent === '沉寂之屋' && ui.titleEl.style.display !== 'none',
  'A-11 事件标题显示在正文上方');
ui.closeSilently('test');

// ════════════════════════════════════════════════════════════
head('B. 输入封锁：剧情期间禁止移动 / 祈福 / 睡觉，结束后恢复');
// ════════════════════════════════════════════════════════════
ui.show(narration);
check(InputGate.isMovementBlocked(director) === true, 'B-01 剧情期间禁止移动');
check(InputGate.isBlessBlocked(director) === true, 'B-02 剧情期间禁止祈福');
check(InputGate.isSleepBlocked(director) === true, 'B-03 剧情期间禁止睡觉');
check(InputGate.isHotbarBlocked(director) === true, 'B-04 剧情期间数字键归选项区（快捷栏停用）');
check(InputGate.isStoryBlocked(director) === true, 'B-05 剧情进行中标记');
ui.advance();
ui.advance();
check(ui.visible === false, 'B-06 推进到底后关闭');
check(InputGate.isMovementBlocked(director) === false, 'B-07 结束后移动恢复');
check(InputGate.isBlessBlocked(director) === false, 'B-08 结束后祈福恢复');
check(InputGate.isSleepBlocked(director) === false, 'B-09 结束后睡觉恢复');
check(InputGate.debugInputState(director).dialog === false, 'B-10 无弹窗时 dialog 标记为假');

// ════════════════════════════════════════════════════════════
head('C. 有选项：渲染 / 键位 / 禁用态 / 二次确认 / 回调生效');
// ════════════════════════════════════════════════════════════
let hits = 0;
const optionStory = {
  id: 't_opt',
  start: 'a',
  nodes: {
    a: { text: '旁白一段。', next: 'pick' },
    pick: {
      text: '你要怎么做？',
      options: [
        { id: 'o1', label: '选项一', sub: '消耗：一点点代价', detail: '展开详情占位。', next: 'done', onSelect: () => { hits += 1; } },
        { id: 'o2', label: '选项二', sub: '禁用示例', disabled: true, disabledReason: '条件未满足', next: 'done' },
        { id: 'o3', label: '离开', sub: '多事不如少一事', end: true },
      ],
    },
    done: { text: '你已经做出了选择。', end: true },
  },
};
check(ui.show(optionStory) === true, 'C-01 选项脚本打开');
ui.advance();
check(ui.nodeKey === 'pick', 'C-02 推进到选项节点');
check(ui.optionAreaEl.style.display === 'flex', 'C-03 选项区显示');
check(ui.optionBtns.length === 3, 'C-04 三个选项渲染', ui.optionBtns.length);
check(ui.optionBtns[0].textContent.includes('选项一')
  && ui.optionBtns[0].textContent.includes('消耗：一点点代价')
  && ui.optionBtns[0].textContent.includes('展开详情占位。'),
  'C-05 选项卡含主标题 / 副标题 / 详情（详情常驻）');
check(findAll(ui.optionBtns[0], 'story-option-key').length === 0,
  'C-05b 不渲染数字徽章（参考图无编号）');
check(ui.optionBtns[1].classList.contains('disabled'), 'C-06 禁用选项灰化');
check(ui.optionBtns[1].getAttribute('aria-disabled') === 'true', 'C-07 禁用选项无障碍标记');
check(!ui.storyPanel.textContent.includes('请选择'), 'C-08 有选项时也不出现提示文本');
check(ui.advance() === false, 'C-09 有选项时不允许越过选择推进');
check(ui.nodeKey === 'pick', 'C-10 推进被拒绝后节点不变');

// 首次点击 = 待确认
ui.optionBtns[0].click();
check(ConfirmAction.isArmed(ui.optionBars[0]) === true, 'C-11 首次点击进入待确认态');
check(ui.optionBtns[0].textContent.includes('你确定这么做？'), 'C-12 待确认文案出现在卡片内');
check(ui._hints[0].style.display === 'block', 'C-13 卡片内确认提示可见');
check(ui._confirmBtns[0].style.display === 'inline-flex', 'C-14 选中后出现圆形确认钮');
const detailBeforeClick = findAll(ui.optionBtns[0], 'story-option-detail')[0];
check(!!detailBeforeClick && detailBeforeClick.style.display !== 'none',
  'C-14b 详情在点击前就是常驻显示（点击只多一行确认文案）');
check(hits === 0, 'C-15 待确认阶段尚未执行业务');

// 再次点击 = 同一 tick 立即生效
ui.optionBtns[0].click();
check(hits === 1, 'C-16 再次点击 → 选项回调生效');
check(ui.textEl.textContent === '你已经做出了选择。', 'C-17 业务先于动画：正文立即切换');
await tick(20);
check(ui.nodeKey === 'done' && ui.optionAreaEl.style.display === 'none',
  'C-18 淡出结束后落位到结果节点、选项区收起');
check(ui.advance() === true && ui.visible === false, 'C-19 结果节点推进到底 → 关闭');

// 禁用选项：点击与数字键都无效
ui.show(optionStory);
ui.advance();
ui.optionBtns[1].click();
check(ConfirmAction.isArmed(ui.optionBars[1]) === false, 'C-20 禁用选项点击不进待确认');
key('2');
check(ConfirmAction.isArmed(ui.optionBars[1]) === false, 'C-21 禁用选项数字键无效');

// 数字键选择 + 「离开」同样需要二次确认（无 safe 单击例外）
key('3');
check(ui.visible === true && ConfirmAction.isArmed(ui.optionBars[2]) === true,
  'C-22 数字键 3 选中「离开」→ 只进入待确认，不立即生效');
check(ui.optionBtns[2].textContent.includes('你确定这么做？'), 'C-22b 「离开」也显示确认文案');
key('3');
await tick(20);
check(ui.visible === false, 'C-22c 再次确认「离开」后才结束');
check(storyEnds[storyEnds.length - 1].id === 't_opt',
  'C-23 「离开」结束后输入恢复事件已广播');
check(InputGate.isMovementBlocked(director) === false, 'C-24 选项剧情结束后移动恢复');

// ════════════════════════════════════════════════════════════
head('D. 选项上限 1~4');
// ════════════════════════════════════════════════════════════
ui.show({
  id: 't_max',
  start: 'p',
  nodes: {
    p: {
      text: 'too many',
      options: Array.from({ length: 6 }, (_, i) => ({ label: `x${i}`, next: 'p' })),
    },
  },
});
check(ui.optionBtns.length === MAX_OPTIONS && MAX_OPTIONS === 4, 'D-01 最多渲染 4 个选项', ui.optionBtns.length);
ui.closeSilently('test');

// ════════════════════════════════════════════════════════════
head('E. 跳过：只停在选项处，选项段必须手动选择');
// ════════════════════════════════════════════════════════════
const skipStory = {
  id: 't_skip',
  start: 'a',
  nodes: {
    a: { text: 'n1', next: 'b' },
    b: { text: 'n2', next: 'c' },
    c: { text: '这里需要选择。', options: [{ label: '唯一选项', next: 'd' }] },
    d: { text: '结尾', end: true },
  },
};
ui.show(skipStory);
check(ui.skip() === true, 'E-01 跳过后停在下一个选项节点');
check(ui.nodeKey === 'c' && ui.optionBtns.length === 1, 'E-02 只跳到选项处，不越过选择');
const toastBefore = toasts.length;
check(ui.skip() === false, 'E-03 选项节点上跳过被拒绝');
check(toasts.length === toastBefore + 1 && toasts[toasts.length - 1].text.includes('选择'),
  'E-04 选项节点跳过提示先做选择');

// ESC = 跳过入口：先弹确认，确认后才跳
const dlgBefore = dialogs.length;
key('escape');
check(dialogs.length === dlgBefore + 1, 'E-05 ESC 打开跳过确认弹窗');
const dlg = dialogs[dialogs.length - 1];
check(dlg.options.length === 2 && dlg.options[0].label === '取消' && dlg.options[0].safe === true,
  'E-06 跳过确认含「取消」(安全) + 「跳过」');
check(ui.visible === true, 'E-07 未确认前不跳过');
ui.closeSilently('test');

// 无选项旁白上确认跳过：直接结束
ui.show(narration);
key('escape');
dialogs[dialogs.length - 1].options[1].onSelect();
check(ui.visible === false, 'E-08 确认跳过后旁白脚本结束');

// ════════════════════════════════════════════════════════════
head('F. 数据驱动 + 实时刷新');
// ════════════════════════════════════════════════════════════
const entry = { id: 'evt_ph_01', name: '一小堆金币' };
const evtScript = buildEventStory(entry);
check(evtScript.title === entry.name && evtScript.id === 'story_evt_ph_01',
  'F-01 事件脚本 id / 标题来自事件条目');
check(JSON.stringify(evtScript.nodes.intro.text).includes(entry.name),
  'F-02 正文包含条目名（UI 不写死文案）');
check(evtScript.nodes.intro.options.length === 3 && !evtScript.nodes.choice,
  'F-03 通用事件描述节点直接带 3 个选项（无多余过渡节点）');
const demo = demoStory();
check(demo.nodes.b.options.length === 3
  && demo.nodes.b.options.some((o) => o.disabled === true),
  'F-04 演示脚本覆盖禁用态');

ui.show(narration);
const before = ui.textEl.textContent;
ui.script.nodes.a.text = ['实时改写后的正文。'];
ui.refresh();
check(ui.textEl.textContent.includes('实时改写后的正文。') && before !== ui.textEl.textContent,
  'F-05 直改数据 + refresh → 正文立即更新（零额外操作）');
ui.closeSilently('test');

ui.show(optionStory);
ui.advance();
ui._options[0].label = '改名后的选项';
ui.refresh();
check(ui.optionBtns[0].textContent.includes('改名后的选项'),
  'F-06 直改选项数据 + refresh → 选项区立即更新');
ui.closeSilently('test');

// 读档 / 重开静默关闭，不触发 onEnd
let ended = 0;
ui.show({ id: 't_reset', start: 'a', nodes: { a: { text: 'x' } }, onEnd: () => { ended += 1; } });
EventBus.emit(GE.STATE_RESET, { gs });
check(ui.visible === false && ended === 0, 'F-07 STATE_RESET 静默关闭且不结算 onEnd');

// ════════════════════════════════════════════════════════════
head('G. 关闭入口与层级');
// ════════════════════════════════════════════════════════════
ui.show(narration);
check(ui.layer.style.zIndex === '5750' && ui.mask.style.zIndex === '5700',
  'G-01 事件层 5700/5750（低于面板 6000，高于快捷栏 5600）');
check(ui.layer.style.pointerEvents === 'none' && ui.storyPanel.style.pointerEvents === 'auto',
  'G-02 层容器不吞点击，仅面板可交互');
check(ui.titleEl.textContent === '' && ui.titleEl.style.display === 'none',
  'G-03 脚本无 title 时标题行隐藏');
// 叙事态：点薄纱 = 推进会话（无「继续」提示也可靠点击推进）
ui.mask.click();
check(ui.nodeKey === 'b', 'G-04 叙事态点击屏幕推进一段');
// 结果态：薄纱层级与深浅保持不变（结果阶段不得再压暗整屏）
check(ui.mask.style.zIndex === '5700', 'G-05 结果态薄纱仍为 5700（不抬层级、不额外变暗）');
check(ui.mask.style.backgroundColor === 'rgba(14, 20, 24, 0.34)', 'G-05b 结果态薄纱颜色 / 浓度未变');
ui.mask.click();
check(ui.visible === false
  && storyEnds[storyEnds.length - 1].reason === 'result-dismiss',
  'G-06 结果文本态点击任意处关闭事件');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
