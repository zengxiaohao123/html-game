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

// ═══ 第 12 批：边界与异常路径自查 ═══
const { CombatSystem } = await import('../src/systems/CombatSystem.js');
const { TurnSystem } = await import('../src/systems/TurnSystem.js');
const { ShopSystem } = await import('../src/systems/ShopSystem.js');
const { BlessSystem } = await import('../src/systems/BlessSystem.js');
const InventorySystem = await import('../src/systems/InventorySystem.js');
const { migrateGS } = await import('../src/state/migrate.js');

console.log('\n═══ 6. 读档恢复：鸡舍储存 / 商店 visited / 地块 contentState / flags ═══');
{
  const g = createInitialState();
  const coopTile = g.map.outerTiles.find((t) => !t.contentId);
  coopTile.contentId = 'facility_henhouse';
  coopTile.contentState = { henhouseFeed: 3, eggStored: 2 };
  const shopTile = g.map.outerTiles.find((t) => !t.contentId);
  shopTile.contentId = 'resource_shop';
  shopTile.contentState = { shop: { visited: true, leftAtTurn: 5, refreshUsed: 1, weekKey: 'y1m1w1', stock: [] } };
  const tulipTile = g.map.outerTiles.find((t) => !t.contentId);
  tulipTile.contentId = 'facility_tulip';
  tulipTile.contentState = { tulipValue: 2 };
  g.flags = { creatureTruce: true };
  g.day = 9; g.player.gold = 123;

  check(save(4, g) === true, 'save(4) 成功');
  const m = migrateGS(load(4));
  const coop2 = m.map.outerTiles.find((t) => t.contentId === 'facility_henhouse');
  check(coop2?.contentState?.henhouseFeed === 3 && coop2?.contentState?.eggStored === 2,
    '读档恢复鸡舍储存（饲料 3 / 存蛋 2）', coop2?.contentState);
  const shop2 = m.map.outerTiles.find((t) => t.contentId === 'resource_shop');
  check(shop2?.contentState?.shop?.visited === true && shop2?.contentState?.shop?.leftAtTurn === 5,
    '读档恢复商店 visited / leftAtTurn', shop2?.contentState?.shop);
  const tulip2 = m.map.outerTiles.find((t) => t.contentId === 'facility_tulip');
  check(tulip2?.contentState?.tulipValue === 2, '读档恢复地块 contentState（郁金香倍率）');
  check(m.flags?.creatureTruce === true, '读档恢复 flags（生物停战）');
  check(m.day === 9 && m.player.gold === 123, '读档恢复天数 / 金币');
  clearSlot(4);
}

console.log('\n═══ 7. 涅槃不误触发：玩家攻击生物时不判定玩家致死 ═══');
{
  const g = createInitialState();
  g.team.groups[0].roles = ['yumo', 'xiayang']; // 夏阳在队（涅槃可用）
  g.team.xiayangRebornCooldownDay = 0;
  g.player.hp = 1; // 玩家低血量
  const atkBefore = g.player.atk;
  const target = { kind: 'slime', category: 'danger', hp: 100, maxHp: 100, activeBuffs: [] };
  const origRandom = Math.random;
  Math.random = () => 0.99; // 排除暴击/闪避干扰
  const r = CombatSystem.calculateDamage({ atk: 10, defender: target, element: 'physical', player: g.player, gs: g, roleId: 'yumo' });
  Math.random = origRandom;
  check(r.finalDamage > 0 && target.hp === 100 - r.finalDamage,
    `低血量攻击生物伤害正常结算（${r.finalDamage}）`, { finalDamage: r.finalDamage, hp: target.hp });
  check(g.team.xiayangRebornCooldownDay === 0 && g.player.atk === atkBefore && g.player.hp === 1,
    '涅槃未被误触发（无冷却 / 攻击未变 / 玩家血量未动）');

  // 正向对照：玩家本人受致命伤害时涅槃照常生效
  Math.random = () => 0.99;
  CombatSystem.calculateDamage({ atk: 999, defender: g.player, element: 'physical', player: g.player, gs: g, roleId: 'monster' });
  Math.random = origRandom;
  check(g.team.xiayangRebornCooldownDay === 3 && g.player.hp === Math.floor(g.player.maxHp * 0.5),
    '玩家受致命伤害仍触发涅槃（回 50% HP + 进 3 天冷却）', { hp: g.player.hp, cd: g.team.xiayangRebornCooldownDay });
}

console.log('\n═══ 8. 行动力为负：允许透支、-3 强制睡觉 ═══');
{
  const g = createInitialState();
  g.player.stamina = 0;
  const from = g.player.x;
  move(g, 'up');
  TurnSystem.advanceTurn(g, 1); // 与 GameDirector.move 相同的回合推进链路
  check(g.player.x !== from, '行动力 0 仍可移动（允许透支）');
  check(g.player.stamina === -1, `移动后行动力 -1（实际 ${g.player.stamina}）`);
  check(g.activeBuffs.some((b) => b.id === 'exhausted'), '首次透支挂【心力交瘁】debuff');

  g.player.stamina = -3;
  const r = TurnSystem.advanceTurn(g, 0);
  check(r.forcedSleep === true, '行动力 -3 → 强制睡觉信号');
  const dayBefore = g.day;
  sleep(g, true); // 模拟 GameDirector.move 对 forcedSleep 的处理
  check(g.player.stamina > 0, `强制睡觉后行动力恢复（${g.player.stamina}）`);
  check(g.day === dayBefore + 1, '强制睡觉同样推进天数');
}

console.log('\n═══ 9. 背包/储存边界：出货箱满 ═══');
{
  const { ITEMS } = await import('../src/data/items.js');
  const g = createInitialState();
  const ids = Object.keys(ITEMS);
  g.inventory.outbox = ids.slice(0, 12).map((id) => ({ itemId: id, qty: 1 }));
  const extraId = ids[12];
  check(InventorySystem.addToOutbox(g, extraId, 1) === false,
    '出货箱 12 格满 → 拒绝新物品放入');
  check(g.inventory.outbox.length === 12, '拒绝后出货箱格数不变');
  check(InventorySystem.addToOutbox(g, ids[0], 1) === true && g.inventory.outbox.length === 12,
    '已有同类格合并不受满箱阻挡（格数不增）');
  InventorySystem.addItem(g, extraId, 1);
  const before = InventorySystem.countItem(g, extraId);
  const mv = InventorySystem.moveItemBetween(g, 'items', 'outbox', extraId, 1);
  check(mv === false && InventorySystem.countItem(g, extraId) === before,
    'items→outbox 移动满箱回滚（背包数量不变）');
}

console.log('\n═══ 10. 资源耗尽：金币不足不负债 ═══');
{
  const g = createInitialState();
  const st = g.map.outerTiles.find((t) => !t.contentId);
  st.contentId = 'resource_shop';
  st.contentState = {};
  ShopSystem.enterShop(g, st.idx);
  const stock = st.contentState.shop.stock;
  const buyableIdx = stock.findIndex((s) => !s.sold);
  g.player.gold = 0;
  const rb = ShopSystem.buy(g, st.idx, buyableIdx);
  check(rb.ok === false && rb.reason === 'noGold' && g.player.gold === 0, '金币 0 购买被拒（不负债）');
  g.player.gold = 1;
  const rr = ShopSystem.refreshShop(g, st.idx);
  check(rr.ok === false && rr.reason === 'noGold' && g.player.gold === 1, '金币不足刷新被拒');
  // 祈福：先用掉 momo 首次减半（否则首次金币消耗为 0），再验证金币/行动力门禁
  g.player.gold = 0; g.player.stamina = 8; g.team.dailyBlessCount = 1;
  const bl = BlessSystem.blessStart(g);
  check(bl.ok === false && bl.reason === 'gold' && g.player.gold === 0, '金币不足祈福被拒（不负债）');
  g.player.gold = 100; g.player.stamina = 0;
  const bl2 = BlessSystem.blessStart(g);
  check(bl2.ok === false && bl2.reason === 'stamina', '行动力不足祈福被拒');
}

console.log('\n═══ 11. 生命归 0 后再行动：不卡死 ═══');
{
  const g = createInitialState();
  g.player.hp = 0; g.player.stamina = 5; g.player.gold = 100;
  CombatSystem.applyDeathPenalty(g, g.player);
  check(g.player.hp === 1 && g.player.stamina === 0, '惩罚后 HP=1 / 行动力=0');
  const from = g.player.x;
  move(g, 'up');
  check(g.player.x !== from, '惩罚后仍可移动（透支 -1，不卡死）');
  const bl = BlessSystem.blessStart(g);
  check(bl.ok === false && bl.reason === 'stamina', '行动力 0 祈福明确拒绝（非静默）');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
