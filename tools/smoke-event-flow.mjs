// tools/smoke-event-flow.mjs —— 事件「选项驱动结算 + 多级状态机」冒烟
// 用法：node tools/smoke-event-flow.mjs
//
// 覆盖口径（本次任务要求）：
//   · 进入事件 / 推进正文 / 跳过 都不结算；只有选项确认才结算
//   · 不同选项产生不同结果
//   · 多级分支能正确走到第二层，且第二层不同选项结果不同
//   · 选项文本不泄露代码层编号 / 层级提示
//   · 跳过只停在下一个选项节点，不越过分支拿结果
//   · 无选项且无 next 的节点 = 终止节点，关闭事件并解锁输入
//   · 结算效果生效且只生效一次
//   · 结算词表：金币 / 物品 / 行动力 / 治疗 / 地形 / buff / 生物
//   · 中途打断（读档 / 重开）：静默关闭、不追加结算

// ════════════════════════════════════════════════════════════
// 0. 最小 DOM 桩（与 smoke-story.mjs 同口径，先装再 import）
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

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
// 1. 载入模块
// ════════════════════════════════════════════════════════════
const { StoryUI } = await import('../src/ui/StoryUI.js');
const { buildEventStory } = await import('../src/data/stories.js');
const { applyEventEffects } = await import('../src/systems/EventEffects.js');
const { createInitialState } = await import('../src/state/gameState.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const InputGate = await import('../src/systems/InputGate.js');
const { getEventDef } = await import('../src/data/events.js');
const {
  isEventBlocked, markEventEntered, markEventRevealed,
} = await import('../src/data/eventPool.js');
const { buildStallOffer } = await import('../src/data/events/evt_stall_02.js');
const { isUniqueItem } = await import('../src/systems/ItemUniqueness.js');

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

// ════════════════════════════════════════════════════════════
// 2. 环境：真实 gs + StoryUI
// ════════════════════════════════════════════════════════════
const gs = createInitialState();
gs.player.gold = 20;
gs.activeBuffs = gs.activeBuffs || [];
const director = {
  getGS: () => gs,
  openPanels: [],
  mainMenu: { visible: false },
  dialogBox: null,
  settingsPanel: null,
};
const ui = new StoryUI(director);
ui.mount(body);
director.storyUI = ui;
ui.confirmFadeMs = 0;

const storyEnds = [];
const toasts = [];
EventBus.on(GE.STORY_END, (p) => storyEnds.push(p));
EventBus.on(GE.TOAST_SHOW, (p) => toasts.push(p));

/** 物品数量 */
function qty(itemId) {
  return gs.inventory.items
    .filter((i) => i.itemId === itemId)
    .reduce((n, i) => n + (i.qty || 0), 0);
}
/** 栅栏内生物总数 */
function creatureCount() {
  return (gs.map.fence || []).reduce((n, f) => n + (f.creatures?.length || 0), 0);
}
/** 普通选项：两次点击 = 确认 */
function choose(btn) { btn.click(); btn.click(); }
/** 打开事件并推进到第一个选项节点 */
function openAtChoice(def) {
  const ok = ui.show(buildEventStory(def), { tileIdx: 0, eventId: def.id });
  while (ui.visible && ui.optionBtns.length === 0 && ui.advance()) { /* 推进到选项 */ }
  return ok;
}
/** 断言当前节点选项文本不泄露代码编号 / 层级提示 */
function assertNoLeak(def, nodeKey, tokenSet) {
  const texts = ui.optionBtns.map((b) => b.textContent);
  const joined = texts.join('\n');
  const node = def.nodes[nodeKey];
  const labels = node.options.map((o) => o.label);
  check(labels.every((l) => joined.includes(l)), `${nodeKey}：选项主文本全部来自数据 label`, joined);
  const leaks = tokenSet.filter((t) => joined.includes(t));
  check(leaks.length === 0, `${nodeKey}：选项文本不含代码编号 / 层级提示`, leaks);
}

// ════════════════════════════════════════════════════════════
// 机制夹具：不依赖正式事件内容，只验证节点表 → UI → 结算链路。
// ════════════════════════════════════════════════════════════
const simpleDef = {
  id: 'fixture_simple',
  name: '单层夹具',
  icon: '🧪',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: ['夹具正文第一段。', '夹具正文第二段。'],
      options: [
        {
          id: 'search',
          label: '取出小麦',
          sub: '小麦×2',
          effects: [{ type: 'item', itemId: 'item_wheat', qty: 2 }],
          next: 'searched',
        },
        {
          id: 'purse',
          label: '拿走金币',
          sub: '金币+6',
          effects: [{ type: 'gold', amount: 6 }],
          next: 'purse_taken',
        },
        { id: 'leave', label: '离开', sub: '无收益', end: true },
      ],
    },
    searched: { text: '夹具结果：小麦已入包。', end: true },
    purse_taken: { text: '夹具结果：金币已入袋。', end: true },
  },
};

const nestedDef = {
  id: 'fixture_nested',
  name: '两层夹具',
  icon: '🧪',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: ['夹具岔路第一段。', '夹具岔路第二段。'],
      options: [
        { id: 'trail', label: '沿着痕迹走', sub: '进入第二层', next: 'trail_scene' },
        {
          id: 'water',
          label: '循着水声走',
          sub: '行动力+1',
          effects: [{ type: 'stamina', amount: 1 }],
          next: 'water_end',
        },
      ],
    },
    trail_scene: {
      text: '夹具第二层正文，描述完直接给选项。',
      options: [
        {
          id: 'rest',
          label: '在空地上歇脚',
          sub: '恢复10%生命',
          effects: [{ type: 'heal', percent: 0.1 }],
          next: 'rest_end',
        },
        {
          id: 'delve',
          label: '继续深入',
          sub: '生成1只小鸡',
          effects: [{ type: 'creature', kind: 'chick' }],
          next: 'delve_end',
        },
        {
          id: 'sow',
          label: '把种子撒在空地上',
          sub: '改变地形并挂1天状态',
          effects: [
            { type: 'terrain', terrainId: 'terrain_grass' },
            { type: 'buff', buffId: 'grumpy', days: 1 },
          ],
          next: 'sow_end',
        },
      ],
    },
    water_end: { text: '夹具结果：水边。', end: true },
    rest_end: { text: '夹具结果：歇脚。', end: true },
    delve_end: { text: '夹具结果：深入。', end: true },
    sow_end: { text: '夹具结果：撒种。', end: true },
  },
};

// ════════════════════════════════════════════════════════════
head('A. 节点表结构：单层 / 两层夹具');
// ════════════════════════════════════════════════════════════
check(!!simpleDef && !!nestedDef, 'A-01 单层 / 两层夹具已定义');
check(simpleDef.start === 'intro' && nestedDef.start === 'intro', 'A-02 起始节点可用');
check(Object.keys(simpleDef.nodes).length >= 3, 'A-03 单层事件包含多个节点（描述 + 结果）');
// 2026-11-13 返工：描述节点直接带选项，不再有「你打算怎么处理？」过渡节点
const simpleChoice = simpleDef.start;
check(Array.isArray(simpleDef.nodes[simpleChoice]?.options) && simpleDef.nodes[simpleChoice].options.length === 3,
  'A-04 单层事件描述节点直接带 3 个选项（无过渡节点）');
check(!simpleDef.nodes[simpleDef.start]?.next, 'A-04b 首节点不再靠 next 跳到问题节点');
const nestedFirst = nestedDef.start;
const nestedSecondKey = nestedDef.nodes[nestedFirst]?.options?.[0]?.next;
const nestedSecond = nestedDef.nodes[nestedSecondKey];
check(!!nestedSecond && Array.isArray(nestedSecond.options) && nestedSecond.options.length === 3,
  'A-05 两层事件第一层选项能指向第二个选项节点（3 个二层选项）', nestedSecondKey);
check(nestedSecond.options[0].effects && nestedSecond.options[1].effects
  && JSON.stringify(nestedSecond.options[0].effects) !== JSON.stringify(nestedSecond.options[1].effects),
  'A-06 第二层不同选项挂载不同结算效果');

// ════════════════════════════════════════════════════════════
head('B. 结算时机：进入 / 推进 / 跳过都不结算');
// ════════════════════════════════════════════════════════════
{
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  ui.show(buildEventStory(simpleDef), { tileIdx: 0, eventId: simpleDef.id });
  check(ui.visible === true, 'B-01 事件打开');
  check(gs.player.gold === gold0 && qty('item_wheat') === wheat0,
    'B-02 进入事件不结算（金币 / 物品不变）');
  check(ui.nodeKey === simpleChoice && ui.optionBtns.length === 3,
    'B-03 打开即到选项节点（描述和选项同一屏，不用多点一次）');
  check(ui.advance() === false, 'B-03b 有选项时点击正文不越过选择');
  check(gs.player.gold === gold0 && qty('item_wheat') === wheat0,
    'B-04 展示选项仍不结算');
}

// ════════════════════════════════════════════════════════════
head('C. 单层事件：不同选项产生不同结果');
// ════════════════════════════════════════════════════════════
{
  // C1「拿走钱袋」→ 金币 +6
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  openAtChoice(simpleDef);
  assertNoLeak(simpleDef, simpleChoice, ['fixture_simple', 'search', 'purse', 'leave', 'A.1', '第一段', '第二段', '选项1', '选项2']);
  choose(ui.optionBtns[1]);
  check(gs.player.gold === gold0 + 6, 'C-01 选「拿走钱袋」→ 金币 +6', gs.player.gold - gold0);
  check(qty('item_wheat') === wheat0, 'C-02 同一选项不产生其它结果');
  await tick(10);
  check(ui.nodeKey === 'purse_taken', 'C-03 跳转到该选项的结果节点');
}

{
  // C2「翻找行囊」→ 小麦 +2，金币不变
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  openAtChoice(simpleDef);
  choose(ui.optionBtns[0]);
  check(qty('item_wheat') === wheat0 + 2, 'C-04 选「翻找行囊」→ 小麦 +2', qty('item_wheat') - wheat0);
  check(gs.player.gold === gold0, 'C-05 同一选项不产生其它结果（金币不变）');
}

{
  // C3「离开」→ 无结算，且和其他选项一样必须二次确认
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  openAtChoice(simpleDef);
  ui.optionBtns[2].click();
  check(ui.visible === true && ui.isOptionArmed(2) === true,
    'C-06 「离开」首次点击只进入待确认，不立即生效');
  ui.optionBtns[2].click();
  await tick(10);
  check(ui.visible === false, 'C-06b 「离开」再次点击确认后事件结束');
  check(gs.player.gold === gold0 && qty('item_wheat') === wheat0,
    'C-07 无结算选项不改变任何数值');
}

// ════════════════════════════════════════════════════════════
head('D. 多级分支：第一层 → 第二层 → 不同叶子结果');
// ════════════════════════════════════════════════════════════
{
  openAtChoice(nestedDef);
  check(ui.nodeKey === nestedFirst && ui.optionBtns.length === 2, 'D-01 第一层 2 个选项');
  choose(ui.optionBtns[0]); // 沿着痕迹走
  await tick(10);
  // 第二层的描述节点直接带选项：确认第一层后立刻可做第二层选择
  check(ui.nodeKey === 'trail_scene' && ui.optionBtns.length === 3,
    'D-02 第一层确认后直接落到第二层选项（无过渡问句）', ui.nodeKey);
  assertNoLeak(nestedDef, 'trail_scene', ['trail', 'rest', 'delve', 'sow', 'A.1', 'A.2', '第一段', '第二段']);
}

{
  // 第二层 A.1：歇脚 → 回复
  gs.player.hp = Math.floor(gs.player.maxHp * 0.5);
  const hp0 = gs.player.hp;
  const creatures0 = creatureCount();
  openAtChoice(nestedDef);
  choose(ui.optionBtns[0]); await tick(10);
  choose(ui.optionBtns[0]);
  check(gs.player.hp > hp0, 'D-05 第二层「歇脚」→ 生命回复', gs.player.hp - hp0);
  check(creatureCount() === creatures0, 'D-06 回复分支不生成生物');
}

{
  // 第二层 A.2：继续深入 → 生成生物
  const creatures0 = creatureCount();
  const hp0 = gs.player.hp;
  openAtChoice(nestedDef);
  choose(ui.optionBtns[0]); await tick(10);
  choose(ui.optionBtns[1]);
  check(creatureCount() === creatures0 + 1, 'D-07 第二层「继续深入」→ 生成 1 只生物', creatureCount() - creatures0);
  check(gs.player.hp === hp0, 'D-08 生物分支不改变生命');
}

{
  // 第二层 A.3：撒种子 → 地形 + buff
  const tile = gs.map.outerTiles[0];
  tile.terrain = 'terrain_none';
  tile.terrainAmount = 0;
  gs.activeBuffs = gs.activeBuffs.filter((b) => b.id !== 'grumpy');
  openAtChoice(nestedDef);
  choose(ui.optionBtns[0]); await tick(10);
  choose(ui.optionBtns[2]);
  check(tile.terrain === 'terrain_grass' && tile.terrainAmount > 0,
    'D-09 第二层「撒种子」→ 事件地块地形变化', `${tile.terrain}/${tile.terrainAmount}`);
  check(gs.activeBuffs.some((b) => b.id === 'grumpy'), 'D-10 同一选项的 buff 生效');
  check(gs.activeBuffs.find((b) => b.id === 'grumpy').remainingDays === 1,
    'D-11 buff 按天数记录（remainingDays=1）');
}

// ════════════════════════════════════════════════════════════
head('E. 跳过：只停在选项节点，不越过分支拿结果');
// ════════════════════════════════════════════════════════════
{
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  // 带叙事前情的脚本：跳过只能推进到下一个选项节点
  const skipStory = {
    id: 't_skip',
    start: 'prelude',
    nodes: {
      prelude: { text: '前情提要。', next: 'pick' },
      pick: {
        text: '描述完直接给选项。',
        options: [
          { id: 'x', label: '选项甲', next: 'leaf' },
          { id: 'y', label: '选项乙', next: 'leaf' },
        ],
      },
      leaf: { text: '结果。', end: true },
    },
  };
  ui.show(skipStory);
  check(ui.skip() === true && ui.nodeKey === 'pick', 'E-01 跳过停在第一个选项节点');
  check(gs.player.gold === gold0 && qty('item_wheat') === wheat0, 'E-02 跳过不结算');
  check(ui.skip() === false && ui.nodeKey === 'pick', 'E-03 选项节点拒绝跳过');
  check(ui.optionBtns.length === 2, 'E-04 跳过失败后选项仍完整');
  ui.closeSilently('test-cleanup');

  // 示例事件同样是选项开头：跳过直接被拒绝，不会越过选择拿结果
  openAtChoice(nestedDef);
  const before = creatureCount();
  check(ui.skip() === false && ui.nodeKey === nestedFirst, 'E-05 选项节点开头时跳过被拒绝');
  check(ui.optionBtns.length === 2, 'E-06 跳过失败后第一层选项仍完整');
  check(creatureCount() === before, 'E-07 跳过不会拿到分支结果');
  ui.closeSilently('test-cleanup');
}

// ════════════════════════════════════════════════════════════
head('F. 终止节点：无选项且无 next → 关闭并解锁输入');
// ════════════════════════════════════════════════════════════
{
  const terminalStory = {
    id: 't_terminal',
    start: 'pick',
    nodes: {
      pick: {
        text: '选一个结束方式。',
        options: [
          { id: 'to_leaf', label: '走到空白节点', next: 'leaf' },
        ],
      },
      leaf: { text: '这里没有选项，也没有后续。' },
    },
  };
  ui.show(terminalStory);
  check(InputGate.isMovementBlocked(director) === true, 'F-01 事件期间输入被封锁');
  choose(ui.optionBtns[0]);
  await tick(10);
  check(ui.nodeKey === 'leaf' && ui.visible === true && ui.optionBtns.length === 0,
    'F-02 无选项节点只展示正文');
  check(ui.advance() === true && ui.visible === false, 'F-03 终止节点推进 → 事件关闭');
  const last = storyEnds[storyEnds.length - 1];
  check(last.id === 't_terminal' && last.reason === 'advance-end', 'F-04 结束事件带正确原因', last);
  check(InputGate.isMovementBlocked(director) === false, 'F-05 关闭后输入解锁');
}

// ════════════════════════════════════════════════════════════
head('G. 结算效果只生效一次');
// ════════════════════════════════════════════════════════════
{
  gs.player.gold = 0;
  openAtChoice(simpleDef);
  const btn = ui.optionBtns[1];
  btn.click();                    // 待确认
  btn.click();                    // 生效
  btn.click();                    // 淡出期，应无效
  check(gs.player.gold === 6, 'G-01 连续点击只结算一次', gs.player.gold);
  await tick(10);
  check(ui.nodeKey === 'purse_taken', 'G-02 已跳转到结果节点');
  // 直接重复调用结算入口：同一事件内同一选项 id 被去重
  const opt = simpleDef.nodes[simpleChoice].options[1];
  const summary = ui._settleOption(opt);
  check(summary.length === 0 && gs.player.gold === 6, 'G-03 重复结算入口被去重', gs.player.gold);
  ui.closeSilently('test-cleanup');
}

// ════════════════════════════════════════════════════════════
head('H. 效果词表：金币 / 物品失去 / 行动力 / 治疗 / 地形 / buff / 生物');
// ════════════════════════════════════════════════════════════
{
  const gold0 = gs.player.gold;
  const wheat0 = qty('item_wheat');
  gs.map.outerTiles[1].terrain = 'terrain_none';
  gs.activeBuffs = gs.activeBuffs.filter((b) => b.id !== 'grumpy');
  const creatures0 = creatureCount();
  const stamina0 = gs.player.stamina;
  gs.player.hp = Math.floor(gs.player.maxHp * 0.5);
  const hp0 = gs.player.hp;

  const summary = applyEventEffects(gs, [
    { type: 'gold', amount: 3 },
    { type: 'gold', amount: -999 },
    { type: 'item', itemId: 'item_wheat', qty: 2 },
    { type: 'item', itemId: 'item_wheat', qty: -1 },
    { type: 'stamina', amount: 1 },
    { type: 'heal', percent: 0.1 },
    { type: 'terrain', terrainId: 'terrain_grass' },
    { type: 'buff', buffId: 'grumpy', days: 1 },
    { type: 'creature', kind: 'chick' },
  ], { tileIdx: 1 });

  check(summary.length === 9, 'H-01 9 条效果全部返回摘要', summary);
  check(gs.player.gold === 0, 'H-02 金币：+3 后被 -999 扣到 0 为止（不负债）', gs.player.gold);
  check(qty('item_wheat') === wheat0 + 1, 'H-03 物品：获得 2 / 失去 1', qty('item_wheat') - wheat0);
  check(gs.player.stamina === stamina0 + 1, 'H-04 行动力 +1');
  check(gs.player.hp > hp0, 'H-05 治疗按最大生命 10% 回复');
  check(gs.map.outerTiles[1].terrain === 'terrain_grass', 'H-06 地形变化');
  check(gs.activeBuffs.some((b) => b.id === 'grumpy'), 'H-07 buff 生效');
  check(creatureCount() === creatures0 + 1, 'H-08 生物生成');
}

// ════════════════════════════════════════════════════════════
head('I. 中途打断（读档 / 重开）：静默关闭、不追加结算');
// ════════════════════════════════════════════════════════════
{
  const gold0 = gs.player.gold;
  openAtChoice(simpleDef);
  check(ui.visible === true, 'I-01 事件进行中');
  ui.closeSilently('state-reset');
  check(ui.visible === false, 'I-02 静默关闭');
  check(gs.player.gold === gold0, 'I-03 未确认的选项不产生任何结算');
  check(storyEnds[storyEnds.length - 1].reason === 'state-reset', 'I-04 关闭原因可判定');

  // 已确认的结算立即生效，静默关闭不回滚、也不重复执行
  gs.player.gold = 0;
  openAtChoice(simpleDef);
  choose(ui.optionBtns[1]);
  check(gs.player.gold === 6, 'I-05 确认瞬间已结算');
  ui.closeSilently('state-reset');
  check(gs.player.gold === 6, 'I-06 打断不追加 / 不回滚已生效的结算');
}

// ════════════════════════════════════════════════════════════
head('J. 正式事件：文案、可重复性、摊位变量、载具效果');
// ════════════════════════════════════════════════════════════
{
  const peddler = getEventDef('evt_peddler_01');
  const stall = getEventDef('evt_stall_02');
  check(!!peddler && peddler.repeatability === 'daily', 'J-01 游商事件存在且为每日限1次');
  check(!!stall && stall.repeatability === 'daily', 'J-02 木箱事件存在且为每日限1次');
  check(peddler.nodes.intro.text
    === '林间通向小镇的岔路口停着一辆小木推车。推车上铺着褪色粗麻布，摆着几罐浸了草药的蜜浆。守车的老妇正低头整理捆扎好的干香草，她没有主动招呼，只是任由淡淡的药香在风里散开。',
    'J-03 游商正文逐字来自事件库');
  const leave = peddler.nodes.intro.options.find((o) => o.id === 'leave');
  check(!!leave && peddler.nodes[leave.next]?.text === '你没有上前搭话，继续沿着道路向前行进。',
    'J-04 离开选项接到结果文本节点');
  const stallIntro = stall.nodes.intro;
  check(stallIntro.text
    === '路边的树荫下摆着一只旧木箱，箱面上码着几样零散物件，用粗绳分门别类捆好。摊主不在跟前，只留下一块写着价钱的木牌，风把牌角吹得轻轻掀起。',
    'J-05 木箱正文逐字来自事件库');

  // 可重复性状态机
  const daily = { id: 'fixture_daily', repeatability: 'daily' };
  const once = { id: 'fixture_once', repeatability: 'once' };
  const repeatable = { id: 'fixture_repeatable', repeatability: 'repeatable' };
  const g = createInitialState({ gold: 0 });
  markEventRevealed(g, daily);
  check(isEventBlocked(g, daily) === true, 'J-06 每日限1次：本日被揭露后不可再抽');
  g.day += 1;
  check(isEventBlocked(g, daily) === false, 'J-07 每日限1次：跨天解禁');
  markEventRevealed(g, once);
  check(isEventBlocked(g, once) === true && !g.eventPool.consumedOnce.includes(once.id),
    'J-08 一次性：仅揭露 → 本日占用但不消耗');
  g.day += 1;
  check(isEventBlocked(g, once) === false, 'J-09 一次性：未进入则次日重新可用');
  markEventEntered(g, once);
  g.day += 1;
  check(isEventBlocked(g, once) === true, 'J-10 一次性：进入后永久占用');
  markEventRevealed(g, repeatable);
  markEventEntered(g, repeatable);
  check(isEventBlocked(g, repeatable) === false, 'J-11 可重复：不被记录占用');

  // 摊位变量：范围、唯一性、数量与价格约束
  const offerGS = createInitialState({ gold: 1000 });
  let offerOk = true;
  let sample = null;
  for (let i = 0; i < 30; i++) {
    const offer = buildStallOffer(offerGS);
    if (!offer) { offerOk = false; break; }
    sample = offer;
    if (offer.goods.length !== 1) offerOk = false;
    for (const good of offer.goods) {
      if (good.qty < 1 || good.qty > 4) offerOk = false;
      if (isUniqueItem(good.id) && good.qty !== 1) offerOk = false;
      if (good.qty * good.price > 60) offerOk = false;
    }
    const base = offer.goods.reduce((s, x) => s + x.price * x.qty, 0);
    if (offer.cost < Math.max(1, Math.round(base * 0.4))) offerOk = false;
    if (offer.cost > Math.max(1, Math.round(base * 1.5))) offerOk = false;
  }
  check(offerOk, 'J-12 摊位商品：每次一种、数量 1~4 / 唯一性 / 60 金币上限、实付价 40%~150%', sample?.detail);

  const lowGold = stall.prepare(createInitialState({ gold: 0 }));
  const highGold = stall.prepare(createInitialState({ gold: 100000 }));
  const lowBuy = lowGold.nodes.intro.options[0];
  const highBuy = highGold.nodes.intro.options[0];
  check(lowBuy.disabled === true && highBuy.disabled === false,
    'J-13 金币不足时购买项灰化，充足时可点', { low: lowBuy.sub, high: highBuy.sub });
  check(/^花费\d+金币，买下.+×\d+$/.test(highBuy.sub) && !highBuy.detail,
    'J-14 x / xx 变量位填入实付金币、商品与数量', { sub: highBuy.sub });

  // 载具效果：进载具页，不进背包
  const vg = createInitialState({ gold: 0 });
  const vehicles0 = vg.vehicle.available.length;
  const inv0 = vg.inventory.items.reduce((s, x) => s + (x.qty || 0), 0);
  applyEventEffects(vg, [{ type: 'vehicle', itemId: 'item_horse' }], { tileIdx: 0 });
  const inv1 = vg.inventory.items.reduce((s, x) => s + (x.qty || 0), 0);
  check(vg.vehicle.available.length === vehicles0 + 1 && inv1 === inv0,
    'J-15 载具效果：载具页 +1，背包不增加', vg.vehicle.available.map((v) => v.id));
}

// ════════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════════
console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail === 0 ? 0 : 1);
