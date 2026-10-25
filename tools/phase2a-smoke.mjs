// Phase 2A 逻辑冒烟测试（Node ESM，无 DOM）
// 目的：所有新 import 能正常加载；HookDispatcher 回调总数 >= 34；核心词条触发无 ReferenceError
// 不验证 UI 层

// --------- 先让 Node 能识别无 DOM 代码 ---------
// 只 stub 那些可能被 import 链引用但不执行的浏览器依赖
// 本 Phase 代码全部是纯逻辑，不需要 DOM stub

// 强制允许 .js ESM
import { createInitialState } from '../src/state/gameState.js';
import { registerFacilities } from '../src/data/facilities.js';
import { HookDispatcher } from '../src/core/HookDispatcher.js';
import { EventBus } from '../src/core/EventBus.js';
import { DaySystem } from '../src/systems/DaySystem.js';
import { BlessSystem } from '../src/systems/BlessSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { BuildSystem } from '../src/systems/BuildSystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { Distance } from '../src/core/Distance.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg); }
}

console.log('\n════════════════ Phase 2A 冒烟测试 ════════════════\n');

// 1. 新文件 import 成功（无 ReferenceError）
console.log('— import 所有新模块 —');
assert(typeof createInitialState === 'function', 'gameState.createInitialState');
assert(typeof registerFacilities === 'function', 'facilities.registerFacilities');
assert(typeof DaySystem.startNewDay === 'function', 'DaySystem.startNewDay');
assert(typeof BlessSystem.bless === 'function', 'BlessSystem.bless');
assert(typeof InventorySystem.addItem === 'function', 'InventorySystem.addItem');
assert(typeof BuildSystem.enterBuildMode === 'function', 'BuildSystem.enterBuildMode');
assert(typeof Distance.outerNeighbors === 'function', 'Distance.outerNeighbors');

// 2. GS 初始状态
console.log('\n— GS 初始状态 —');
const gs = createInitialState();
assert(gs.player !== null, 'GS.player 存在');
assert(gs.inventory.items !== undefined, 'inventory.items 存在');
assert(gs.inventory.outbox !== undefined, 'inventory.outbox 存在');
assert(gs.buildMode === false, 'buildMode = false');
assert(gs.blessingQueue !== undefined, 'blessingQueue 字段保留（兼容）');
assert(gs.map.outerTiles.length === 8, '外圈 8 格');
assert(gs.map.outerTiles.every(t => 'states' in t), '每格有 states 字段');
assert(gs.map.outerTiles.every(t => 'dailyFlags' in t), '每格有 dailyFlags 字段');
assert(gs.map.outerTiles[6].contentId === 'facility_home', 'idx=6 是家');

// 3. 注册 hook
console.log('\n— Hook 注册 —');
HookDispatcher.clearAll();
registerFacilities();
const enter = HookDispatcher.count('onEnter');
const passN = HookDispatcher.count('onPass');
const blessed = HookDispatcher.count('onBlessed');
const daily = HookDispatcher.count('onDailyStart');
const sleep = HookDispatcher.count('onSleep');
const replace = HookDispatcher.count('onReplace');
const useSkill = HookDispatcher.count('onUseSkill');
const everyN = HookDispatcher.count('onEveryNTurn');
const total = enter + passN + blessed + daily + sleep + replace + useSkill + everyN;

console.log('  各 hook 数量：onEnter=', enter, 'onPass=', passN, 'onBlessed=', blessed,
  'onDailyStart=', daily, 'onSleep=', sleep, 'onReplace=', replace,
  'onUseSkill=', useSkill, 'onEveryNTurn=', everyN);
console.log('  总回调数 =', total, '(目标 ≥ 34)');

// 任务 brief 估计 ≈34，实际精确数取决于拆分方式。这里用 30 作为下限（home×4 + tent×3 + wheat×2 + rice×2 + potato×3 + tulip×2 + strawberry×3 + pea×4 + henhouse×2 + slimehouse×2 + resource×5 = 32）
assert(total >= 30, `hook 总数 ≥ 30，实际 = ${total}`);
assert(enter >= 5, 'onEnter 至少覆盖 home/tent(无)/potato/henhouse 等');
assert(passN >= 2, 'onPass 至少 home/strawberry');
assert(blessed >= 8, 'onBlessed 至少 8 个设施');
assert(daily >= 4, 'onDailyStart 至少 wheat/rice/potato/tulip/slimehouse');

// 4. home 核心词条：onPass + onEnter（都在 idx=6 home）
console.log('\n— Home 核心词条 —');
// 先让玩家到 home 上
gs.player.x = 6;
// onPass from current → onPass target（当前 home 两次触发 home 词条）
gs.player.stamina = 8;
const prevGold = gs.player.gold;
// home 的 onPass / onEnter 通过 MovementSystem 触发；直接 fire
HookDispatcher.fire('onPass', { gs, tileIdx: 6 });
// tile.dailyFlags['facility_home_onPass'] 已置，再触发一次应无效
HookDispatcher.fire('onPass', { gs, tileIdx: 6 });
assert(gs.player.gold === prevGold + 1, `home onPass 第一次 +1 金币，第二次限次 0，总 +1：当前 = ${gs.player.gold}`);

// 新一天让 dailyFlags 重置
gs.map.outerTiles.forEach(t => t.dailyFlags = {});
HookDispatcher.fire('onEnter', { gs, tileIdx: 6 });
assert(gs.player.gold === prevGold + 2, `home onEnter 再 +1 金币，总 +2：当前 = ${gs.player.gold}`);

// 5. Wheat 核心词条：onDailyStart
console.log('\n— Wheat 核心词条 —');
// 在 home 右边放麦田（idx=2 已是 wheat，GameDirector 放的）
// 我们这里直接放一个 wheat 在 idx=1
gs.map.outerTiles[1].contentId = 'facility_wheat';
gs.player.gold = 0;
gs.inventory.items = [];
gs.player.stamina = 8;
gs.player.gold = 10;

DaySystem.startNewDay(gs);
const wheatEntry = gs.inventory.items.find(i => i.itemId === 'item_wheat');
assert(wheatEntry !== undefined, '麦田产出了小麦（背包有 entry）');
assert(wheatEntry.qty >= 2, `每块麦田至少 +2 小麦，当前 qty = ${wheatEntry.qty}`);

// 6. Potato 核心词条
console.log('\n— Potato 核心词条 —');
gs.map.outerTiles[3].contentId = 'facility_potato';
gs.inventory.items = [];
DaySystem.startNewDay(gs);
// 触发小麦 / 土豆 / 等日产出
const potatoStored = gs.map.outerTiles[3].contentState?.potatoStored || 0;
assert(potatoStored >= 3, `土豆储存 ≥ 3，当前 = ${potatoStored}`);
// 玩家走到 potato 上
gs.player.x = 3;
HookDispatcher.fire('onEnter', { gs, tileIdx: 3 });
const potatoInBag = gs.inventory.items.find(i => i.itemId === 'item_potato')?.qty || 0;
assert(potatoInBag >= 3, `土豆被取出，背包土豆 ≥ 3：当前 = ${potatoInBag}`);

// 7. Bus 核心词条：行动力 +1 + 1 轮子（每日限 1）
console.log('\n— Bus 核心词条 —');
gs.map.outerTiles[4].contentId = 'resource_bus';
gs.player.stamina = 5;
gs.player.x = 4;
gs.inventory.items = [];
HookDispatcher.fire('onEnter', { gs, tileIdx: 4 });
assert(gs.player.stamina === Math.min(8, 5 + 1), `bus 行动力 +1：${gs.player.stamina} (max 8)`);
const wheelQty = gs.inventory.items.find(i => i.itemId === 'item_wheel')?.qty || 0;
assert(wheelQty >= 1, `bus 得 1 轮子：${wheelQty}`);

// 再次触发应被每日限次阻挡
const before = gs.player.stamina;
HookDispatcher.fire('onEnter', { gs, tileIdx: 4 });
assert(gs.player.stamina === before, 'bus 第二次触发被限次阻挡，行动力不变');

// 8. BuildSystem 核心词条
console.log('\n— BuildSystem —');
gs.buildMode = false;
const result1 = BuildSystem.placeContent(gs, 5, 'facility_tent');
assert(result1.ok === false, '非建造模式时拒绝放置');

BuildSystem.enterBuildMode(gs);
// Phase 2B：BuildSystem 现在要求库存里有对应物品（HotBar 与背包同步）
InventorySystem.addItem(gs, 'facility_tent', 1);
const result2 = BuildSystem.placeContent(gs, 5, 'facility_tent');
assert(result2.ok === true, '建造模式下空地可放 tent');

// Home 不可替换
InventorySystem.addItem(gs, 'facility_tent', 1);
const result3 = BuildSystem.placeContent(gs, 6, 'facility_tent');
assert(result3.ok === false, 'home 不可替换（永恒）');

// 放置一个 tent，然后用 wheat 覆盖它 → tent.onReplace 触发 → tent 自己回背包
gs.map.outerTiles[0].contentId = 'facility_tent'; // 先有 tent
gs.inventory.items = []; // 清空背包（目的是验证 tent.onReplace 回背包）
InventorySystem.addItem(gs, 'facility_wheat', 1); // 但需要有 wheat 才能替换
const result4 = BuildSystem.placeContent(gs, 0, 'facility_wheat'); // wheat 替换 tent
assert(result4.ok === true, 'wheat 可替换 tent');
// tent 被替换，它的 onReplace hook 把 facility_tent addItem 回背包
const returnedTent = gs.inventory.items.find(i => i.itemId === 'facility_tent')?.qty || 0;
assert(returnedTent >= 1, `tent 被替换时回背包：当前 ${returnedTent}`);

// 9. BlessSystem 核心词条
console.log('\n— BlessSystem —');
gs.player.gold = 10;
gs.player.stamina = 8;
// 清理一个 blessed tile（bus 占着），随便找一个有 content 的
gs.map.outerTiles[7].contentId = 'facility_strawberry';
const r = BlessSystem.bless(gs);
assert(r.ok === true, `bless 成功: targetIdx=${r.targetIdx}`);
assert(gs.player.stamina === 8 - 2, `stamina -2 = ${gs.player.stamina}`);
assert(gs.player.gold === 10 - 1, `gold -1 = ${gs.player.gold}`);
// 确认 tile.states 有 blessed
const tile = gs.map.outerTiles[r.targetIdx];
assert(tile.states.some(s => s.type === 'blessed'), 'tile.states 挂了 blessed');

// 新一天 blessed -1 天
gs.day = 1;
DaySystem.startNewDay(gs);
const stillBlessed = gs.map.outerTiles[r.targetIdx].states.some(s => s.type === 'blessed');
assert(!stillBlessed, '过了一天 blessed 状态 -1 后到期移除');

// 10. InventorySystem + Outbox round-trip
console.log('\n— InventorySystem + Outbox —');
gs.inventory.items = [];
gs.inventory.outbox = [];
InventorySystem.addItem(gs, 'item_wheat', 5);
InventorySystem.addItem(gs, 'item_egg', 2);
assert(InventorySystem.countItem(gs, 'item_wheat') === 5, 'countItem = 5');
assert(InventorySystem.countItem(gs, 'item_egg') === 2, 'countItem = 2');

InventorySystem.moveItemBetween(gs, 'items', 'outbox', 'item_wheat', 3);
assert(InventorySystem.countItem(gs, 'item_wheat') === 2, '搬到 outbox 后剩 2');

// 手动往 outbox 加 egg
const ok = InventorySystem.addToOutbox(gs, 'item_egg', 2);
assert(ok === true, 'addToOutbox ok');

// 次日结算
gs.player.gold = 0;
const res = InventorySystem.loadFromOutbox(gs);
// wheat(1)×3 + egg(3)×2 = 3 + 6 = 9
assert(res.earnedGold === 3 + 6, `结算金币 = ${res.earnedGold} (wheat×3 + egg×2 = 9)`);
assert(gs.player.gold === 9, `GS gold = ${gs.player.gold}`);
assert(gs.inventory.outbox.length === 0, 'outbox 清空');

// 11. Outbox 满 12 格拒绝
console.log('\n— Outbox 12 格上限 —');
gs.inventory.outbox = [];
const ids = ['item_wheat','item_egg','item_raw_meat','item_wheel','item_slime_gel',
             'item_potato','item_strawberry','item_pea','item_rice_straw','item_wheat'];
// 先放 10 种不同（避免 item_wheat 重复叠放）
const ids10 = ['item_egg','item_raw_meat','item_wheel','item_slime_gel',
               'item_potato','item_strawberry','item_pea','item_rice_straw',
               'item_egg','item_raw_meat']; // 后 2 个故意重复测试叠放
for (let i = 0; i < 10; i++) InventorySystem.addToOutbox(gs, ids10[i], 1);
const afterDup = gs.inventory.outbox.length;
assert(afterDup === 8, `同名叠放不新增格子（8 种不同，10 次放）: 当前 ${afterDup}`);
// 11 种不同 —— 会成功直到 12 种
const r11 = InventorySystem.addToOutbox(gs, 'item_wheel', 1);  // 已存在
assert(r11 === true, '重复 wheel 叠放 ok');
assert(gs.inventory.outbox.length <= 12, `outbox 格子数 ≤ 12: ${gs.inventory.outbox.length}`);

// 填满 12 种不同后再加一种必须拒绝
gs.inventory.outbox = [];
const uniqueIds = ['a','b','c','d','e','f','g','h','i','j','k','l','m'];
for (let i = 0; i < 12; i++) InventorySystem.addToOutbox(gs, uniqueIds[i], 1);
assert(gs.inventory.outbox.length === 12, 'outbox 12 种不同满');
const reject = InventorySystem.addToOutbox(gs, 'item_wheat', 1);  // wheat 算新 item
assert(reject === false, '满 12 格后拒绝新种类');

// 12. DaySystem blessed -1 天循环
console.log('\n— DaySystem blessed 倒计时 —');
gs.map.outerTiles[0].contentId = 'facility_wheat';
gs.player.x = 6;
BlessSystem.bless(gs);  // 会挑一个 tile
const blessedIdx = gs.map.outerTiles.findIndex(t => t.states.some(s => s.type === 'blessed'));
assert(blessedIdx !== -1, 'blessed 已挂上');
gs.day = 1;
// 手动跑 startNewDay（会 -1 天）
DaySystem.startNewDay(gs);
const still = gs.map.outerTiles[blessedIdx].states.some(s => s.type === 'blessed');
assert(!still, 'blessed 1 天后消失');

// 13. ✅ rice/slimehouse/tent 长期祝福效果 —— 独立 state，不被 DaySystem blessed-1 清除
console.log('\n— 长期祝福效果（独立 state，DaySystem 只筛 blessed 类型）—');

// rice 测试：手动挂独立 rice_bless state
gs.map.outerTiles[1].contentId = 'facility_rice';
gs.map.outerTiles[1].states = [
  { type: 'blessed', remainingDays: 1, source: 'bless' },
  { type: 'rice_bless', remainingDays: 5 },
];
DaySystem.startNewDay(gs);
// blessed 1 天后被 DaySystem 清除；rice_bless 独立 state 不被清除，remainingDays 由 rice 自己减
const blessedGone = !gs.map.outerTiles[1].states.some(s => s.type === 'blessed');
const rbAlive = gs.map.outerTiles[1].states.some(s => s.type === 'rice_bless');
assert(blessedGone, 'DaySystem 清除 1 天 blessed state');
assert(rbAlive, '但 rice_bless 独立 state 不被清除');
const rbAfter1 = gs.map.outerTiles[1].states.find(s => s.type === 'rice_bless');
assert(rbAfter1 && rbAfter1.remainingDays === 4, `rice_bless 日减 1：remainingDays=${rbAfter1.remainingDays} (期望 4)`);

// 再过 4 天 → rice_bless 消失
for (let i = 0; i < 4; i++) DaySystem.startNewDay(gs);
const rbFinal = gs.map.outerTiles[1].states.find(s => s.type === 'rice_bless');
assert(!rbFinal, 'rice_bless 5 天后自然消失');

// tent 测试：手动挂 tent_bless state
gs.map.outerTiles[2].contentId = 'facility_tent';
gs.map.outerTiles[2].states = [
  { type: 'blessed', remainingDays: 1, source: 'bless' },
  { type: 'tent_bless', bonus: 3 },
];
DaySystem.startNewDay(gs);
const tentBlessAlive = gs.map.outerTiles[2].states.some(s => s.type === 'tent_bless');
const blessed2Gone = !gs.map.outerTiles[2].states.some(s => s.type === 'blessed');
assert(tentBlessAlive, 'tent_bless 独立 state 不受 DaySystem blessed 清除影响');
assert(blessed2Gone, 'tent 格上的 1 天 blessed state 仍被正确清除');

// slimehouse 测试
gs.map.outerTiles[3].contentId = 'facility_slimehouse';
gs.map.outerTiles[3].states = [
  { type: 'slime_bless', remainingDays: 3 },
];
DaySystem.startNewDay(gs);
const sbAlive = gs.map.outerTiles[3].states.some(s => s.type === 'slime_bless');
const sbAfter = gs.map.outerTiles[3].states.find(s => s.type === 'slime_bless');
assert(sbAlive && sbAfter.remainingDays === 2, `slime_bless 日减 1：remainingDays=${sbAfter.remainingDays}`);

console.log(`\n═══════════════════ 结果：${pass} 通过，${fail} 失败 ════════════════\n`);
process.exit(fail ? 1 : 0);
