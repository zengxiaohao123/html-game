// tools/smoke-mode.mjs —— 探索 / 建造模式切换规则冒烟（设计文档 v0.5 §16.14）
//
// 规则：
//   1. 打开 / 关闭任何页面或面板都不改变当前模式；
//   2. 能切换模式的只有「建造图标按钮」与「Tab 快捷键」；
//   3. 重要剧情 / 事件强制切换模式是预留能力（目前无剧本接入）。
//
// 覆盖：
//   M1 建造模式下：每种面板打开 / 关闭后仍是建造模式；
//   M2 探索模式下：每种面板打开 / 关闭后仍是探索模式；
//   M3 面板打开期间 Tab / 建造按钮仍可切换，且关闭面板后模式不错乱；
//   M4 输入封锁与模式解耦：建造模式下面板开闭后移动仍被阻塞；探索模式关面板后恢复；
//   M5 ESC 不再改变模式；
//   M6 全仓代码扫描：模式写入点只有集中的 BuildSystem.applyMode（+ 读档/迁移初始化），
//      玩家侧调用点只有 FuncBar 与 InputManager，剧情预留入口无任何接入。
//
// 用法：node tools/smoke-mode.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GameDirector → SleepSystem 链路可能触碰 localStorage
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { GameDirector } = await import('../src/systems/GameDirector.js');
const { BuildSystem, enterBuildMode, exitBuildMode } = await import('../src/systems/BuildSystem.js');
const { createInitialState } = await import('../src/state/gameState.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { FuncBar } = await import('../src/ui/FuncBar.js');
const { InputManager } = await import('../src/systems/InputManager.js');
const { isMovementBlocked, debugInputState } = await import('../src/systems/InputGate.js');

let pass = 0;
let fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log(`\n— ${m} —`);

// ────────────────────────────────────────────────────────────
// 测试装置：真实 GameDirector + 真实中央接线（不启动时钟 / 不挂 DOM）
// ────────────────────────────────────────────────────────────
const director = new GameDirector();
director.gs = createInitialState();
director._registerOnce();
const gs = director.gs;

const funcBar = new FuncBar(director);
const inputManager = new InputManager(director);

/** 打开面板（与各面板 show() 发出的事件完全同形） */
function openPanel(key) {
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: key });
}
/** 关闭面板（GameDirector 栈内 magicShop 统一记作 shop） */
function closePanel(key) {
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: key === 'magicShop' ? 'shop' : key });
}

const PANELS = ['inventory', 'shop', 'magicShop', 'role', 'team', 'forge', 'vehicle', 'codex', 'task', 'settings', 'info'];

// ────────────────────────────────────────────────────────────
head('M1 建造模式下：打开 / 关闭任何面板都保持建造模式');
for (const key of PANELS) {
  enterBuildMode(gs);
  openPanel(key);
  const afterOpen = gs.buildMode === true;
  closePanel(key);
  const afterClose = gs.buildMode === true;
  check(afterOpen && afterClose,
    `建造模式 · ${key}：打开后保持建造，关闭后仍为建造`,
    { afterOpen, afterClose, stack: [...director.openPanels] });
  exitBuildMode(gs);
}

// ────────────────────────────────────────────────────────────
head('M2 探索模式下：打开 / 关闭任何面板都保持探索模式');
for (const key of PANELS) {
  exitBuildMode(gs);
  openPanel(key);
  const afterOpen = gs.buildMode === false;
  closePanel(key);
  const afterClose = gs.buildMode === false;
  check(afterOpen && afterClose,
    `探索模式 · ${key}：打开后保持探索，关闭后仍为探索`,
    { afterOpen, afterClose, stack: [...director.openPanels] });
}

// ────────────────────────────────────────────────────────────
head('M3 面板打开期间 Tab / 建造按钮仍能切换模式，关闭面板后状态不错乱');
{
  exitBuildMode(gs);
  openPanel('inventory');
  inputManager._dispatchAction('buildMode');           // 等价于按 Tab
  const tabToBuild = gs.buildMode === true && director.openPanels.includes('inventory');
  closePanel('inventory');
  check(tabToBuild && gs.buildMode === true && director.openPanels.length === 0,
    '面板开着时 Tab → 进入建造；关闭面板后仍为建造，栈已清空',
    { tabToBuild, stack: [...director.openPanels] });

  openPanel('role');
  funcBar._onAction('toggleBuild');                    // 等价于点建造图标
  const btnToExplore = gs.buildMode === false && director.openPanels.includes('role');
  closePanel('role');
  check(btnToExplore && gs.buildMode === false,
    '面板开着时点建造图标 → 回到探索；关闭面板后仍为探索',
    { btnToExplore, stack: [...director.openPanels] });

  // 两个途径都能来回切
  inputManager._dispatchAction('buildMode');
  const t1 = gs.buildMode === true;
  inputManager._dispatchAction('buildMode');
  const t2 = gs.buildMode === false;
  funcBar._onAction('toggleBuild');
  const t3 = gs.buildMode === true;
  funcBar._onAction('toggleBuild');
  const t4 = gs.buildMode === false;
  check(t1 && t2 && t3 && t4, 'Tab 与建造按钮都能双向切换（Tab 进/出、按钮进/出）', { t1, t2, t3, t4 });
}

// ────────────────────────────────────────────────────────────
head('M4 输入封锁与模式解耦：面板模态负责锁输入，模式不是「开关面板」的副产物');
{
  enterBuildMode(gs);
  openPanel('inventory');
  const buildWithPanel = isMovementBlocked(director);
  closePanel('inventory');
  const buildNoPanel = isMovementBlocked(director);
  check(buildWithPanel && buildNoPanel,
    '建造模式：面板打开时阻塞移动，关闭面板后依然阻塞（建造模式本身锁移动）',
    debugInputState(director));

  exitBuildMode(gs);
  openPanel('inventory');
  const exploreWithPanel = isMovementBlocked(director);
  closePanel('inventory');
  const exploreNoPanel = isMovementBlocked(director);
  check(exploreWithPanel && !exploreNoPanel,
    '探索模式：面板打开时阻塞移动，关闭面板后恢复移动',
    debugInputState(director));
}

// ────────────────────────────────────────────────────────────
head('M5 ESC 不再改变模式（只处理面板层级）');
{
  exitBuildMode(gs);
  enterBuildMode(gs);
  director.handleESC();
  const settingsOpened = director.openPanels.includes('settings');
  const stillBuild = gs.buildMode === true;
  check(stillBuild, '建造模式下 ESC 不退出建造模式', { stillBuild, stack: [...director.openPanels] });
  check(settingsOpened, 'ESC 栈空时照常打开设置面板（模式仍为建造）', [...director.openPanels]);
  director.handleESC();
  check(director.openPanels.length === 0 && gs.buildMode === true,
    'ESC 关闭设置后仍为建造模式', [...director.openPanels]);
  exitBuildMode(gs);
}

// ────────────────────────────────────────────────────────────
head('M6 全仓代码扫描：模式写入点 / 调用点收敛');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const srcFiles = walk(path.join(ROOT, 'src'));
const relOf = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const linesOf = (f) => readFileSync(f, 'utf8').split(/\r?\n/);

// M6-1：直接给「游戏状态」的 buildMode 赋值的文件只有三种
//   · BuildSystem.js —— 唯一写入点 applyMode
//   · DayBaseline.js / migrate.js —— 读档与旧档迁移的初始化复位（不是游戏内切换）
// 说明：HotBar / MapView 里的 `this.buildMode` 是 UI 自身的视觉镜像字段（只读订阅
// UI_MODE_CHANGE），不是游戏状态写入点，故排除 `this.` 前缀。
const assignHits = [];
for (const f of srcFiles) {
  linesOf(f).forEach((line, i) => {
    if (/(?<!\bthis)\.buildMode\s*=[^=]/.test(line) && !line.trim().startsWith('//')) {
      assignHits.push(`${relOf(f)}:${i + 1}`);
    }
  });
}
const assignFiles = new Set(assignHits.map((h) => h.split(':')[0]));
check(assignFiles.size === 3
  && assignFiles.has('src/systems/BuildSystem.js')
  && assignFiles.has('src/state/DayBaseline.js')
  && assignFiles.has('src/state/migrate.js'),
  '模式写入点只有 BuildSystem（集中入口）+ 读档/迁移初始化', assignHits);
check(assignHits.filter((h) => h.startsWith('src/systems/BuildSystem.js')).length === 1,
  'BuildSystem 内只有 applyMode 一处写入 buildMode', assignHits);

// M6-2：玩家侧模式切换调用点只允许 FuncBar（建造按钮）与 InputManager（Tab）
const callerFiles = new Set();
for (const f of srcFiles) {
  const rel = relOf(f);
  if (rel === 'src/systems/BuildSystem.js') continue; // 定义与汇总导出
  if (/(enterBuildMode|exitBuildMode)\s*\(/.test(readFileSync(f, 'utf8'))) callerFiles.add(rel);
}
check(callerFiles.size === 2
  && callerFiles.has('src/ui/FuncBar.js')
  && callerFiles.has('src/systems/InputManager.js'),
  'enter/exit 的调用点只有建造按钮与 Tab', [...callerFiles]);

// M6-3：GameDirector（面板开关 / ESC 的中央接线）不再触碰模式
const directorSrc = readFileSync(path.join(ROOT, 'src/systems/GameDirector.js'), 'utf8');
check(!/enterBuildMode|exitBuildMode|forceModeByStory|\.buildMode\s*=/.test(directorSrc),
  'GameDirector 不再直接改模式（面板打开 / ESC 路径已拆除）');

// M6-4：剧情 / 事件预留入口存在，但 src 内没有任何接入
check(typeof BuildSystem.forceModeByStory === 'function',
  'BuildSystem.forceModeByStory 预留入口已暴露');
const storyHits = [];
for (const f of srcFiles) {
  if (relOf(f) === 'src/systems/BuildSystem.js') continue;
  if (/forceModeByStory\s*\(/.test(readFileSync(f, 'utf8'))) storyHits.push(relOf(f));
}
check(storyHits.length === 0, '剧情/事件预留入口未被任何代码接入或触发', storyHits);

// ────────────────────────────────────────────────────────────
console.log(`\nsmoke-mode 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
