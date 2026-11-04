// 第 11 批：按现行模块修正引用（原 ExploreSystem/CombatEngine 等旧架构已不存在）
// 测试意图保持不变：新游戏初始化 / 移动与行动力 / 每日刷新（睡觉） / 存档读档 / 战斗分胜负
//
// 用法：node tools/smoke.mjs

// Node 环境无 localStorage —— 与 smoke-p0 一致的桩
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { registerFacilities } from '../src/data/facilities.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { SleepSystem } from '../src/systems/SleepSystem.js';
import { CreatureSystem } from '../src/systems/CreatureSystem.js';
import { SkillSystem } from '../src/systems/SkillSystem.js';
import { Storage } from '../src/state/storage.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';

const { move } = MovementSystem;
const { sleep } = SleepSystem;
const { save, load, clearSlot } = Storage;

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

registerFacilities(); // 挂载地块内容钩子（与其他冒烟脚本一致）

console.log('═══ 1. 新游戏初始化 ═══');
const gs = createInitialState();
check(gs.map.outerTiles.length === 8, `外圈 8 格（实际 ${gs.map.outerTiles.length}）`);
check(gs.map.outerTiles[6].contentId === 'facility_home', 'idx=6 为家');
check(gs.player.x === 6, `玩家初始站在家（x=${gs.player.x}）`);
check(gs.player.stamina === 8, `初始行动力 8（实际 ${gs.player.stamina}）`);
check(gs.player.hp === 100 && gs.player.gold === 50, '初始 HP 100 / 金币 50');
check(gs.day === 1, `初始第 1 天（实际 ${gs.day}）`);
check(Array.isArray(gs.inventory.items) && gs.inventory.items.length > 0, '初始背包有物品');

console.log('\n═══ 2. 移动与行动力 ═══');
gs.player.x = 7;
const dest = move(gs, 'up');
check(dest === 0, `从 7 向上 → 0（实际 ${dest}）`);
check(gs.player.x === 0, '玩家坐标已更新');
check(gs.player.stamina === 7, `移动扣 1 行动力（实际 ${gs.player.stamina}）`);

console.log('\n═══ 3. 每日刷新（在家睡觉） ═══');
gs.player.x = 6;
const dayBefore = gs.day;
const calBefore = gs.calendar.dayOfMonth;
sleep(gs);
check(gs.day === dayBefore + 1, `睡觉 → 天数 +1（${dayBefore} → ${gs.day}）`);
check(gs.calendar.dayOfMonth === calBefore + 1 || gs.calendar.month !== 3 || gs.calendar.year !== 1,
  `日历推进（${calBefore} → ${gs.calendar.dayOfMonth}，月/年进位亦可）`);
check(gs.player.stamina === 8, `行动力回满（实际 ${gs.player.stamina}）`);

console.log('\n═══ 4. 存档 / 读档 ═══');
const saved = save(2, gs);
check(saved === true, 'save(2) 成功');
const loaded = load(2);
check(!!loaded, 'load(2) 成功');
check(!!loaded && loaded.day === gs.day, `读档天数一致（${loaded?.day}）`);
check(!!loaded && loaded.player.gold === gs.player.gold, '读档金币一致');
check(!!loaded && loaded.player.stamina === gs.player.stamina, '读档行动力一致');
clearSlot(2);

console.log('\n═══ 5. 战斗（围栏内击败危险史莱姆） ═══');
// 围栏两格（{row, col, creatures} 结构，与 smoke-p0 P0-8 一致）
gs.creatures = [];
gs.map.fence = [
  { row: 0, col: 0, creatures: [] },
  { row: 0, col: 1, creatures: [] },
];
const slime = CreatureSystem.spawnCreature(gs, 'slime_grass', {});
check(!!slime && slime.category === 'danger', '围栏内生成危险史莱姆');
check(gs.creatures.some((c) => c.id === slime.id), '史莱姆已登记 gs.creatures');

// 地块 0 放余默斩击技能石，按回合推进冷却直至分出胜负
gs.map.outerTiles[0].contentId = 'skill_yumo_slash';
gs.map.outerTiles[0].contentState = {};
let defeatedEvent = null;
const onDefeated = (p) => { defeatedEvent = p; };
EventBus.on(GE.CREATURE_DEFEATED, onDefeated);
const hpStart = slime.hp;
let rounds = 0;
while (gs.creatures.some((c) => c.id === slime.id) && rounds < 60) {
  gs.skillCooldowns = {};
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  rounds++;
}
check(slime.hp < hpStart, `技能造成伤害（${hpStart} → ${slime.hp}，${rounds} 回合）`);
check(!gs.creatures.some((c) => c.id === slime.id), '史莱姆被击败移出场地');
check(!!defeatedEvent && defeatedEvent.creature === slime, 'CREATURE_DEFEATED 事件已发出');
EventBus.off(GE.CREATURE_DEFEATED, onDefeated);

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
