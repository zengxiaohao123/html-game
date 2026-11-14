// tools/smoke-b7.mjs —— 第 7 批冒烟：用户裁决 7 条规则落地（Node，无 DOM）
//
// 覆盖（逐条对应 2026-11-04 裁决）：
//   ① 鸡蛋储存满 10 → 产出直接丢弃（不进背包/不进储存，记日志）
//   ① 优质蛋与鸡蛋共享同一储存额度（合计 10），收获时两物分别占格
//   ② 超载惩罚 = 该类型全部生物逐只按「100% 当前攻击力」真实伤害（含增益 / 减益）
//   ③ 鸡舍「投放饲料」真实 UI 入口（逻辑 + InfoPanel 入口存在性）
//   ④ 狩猎祝福按地块记账（本格下次狩猎生效，不影响其他狩猎格）
//   ⑤ 巴士站轮子不限次数（每次进入 +1）
//   ⑥ 事件池/奖励池占位表可抽取、效果可结算、条目均标注占位
//
// 用法：node tools/smoke-b7.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities, huntCreature } = await import('../src/data/facilities.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
const { addItem, countItem } = await import('../src/systems/InventorySystem.js');
const CreatureSystem = await import('../src/systems/CreatureSystem.js');
const { getCreatureDef } = await import('../src/data/creatures.js');
const {
  EVENT_POOL_PLACEHOLDER, REWARD_POOL_PLACEHOLDER, REWARD_BLESS_WEIGHT_MULT,
  drawPlaceholderEvent, drawPlaceholderReward, applyPlaceholderEventEffect,
} = await import('../src/data/placeholderPools.js');
const { readFileSync } = await import('node:fs');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();
const gs = createInitialState();
gs.inventory.items = [];
gs.inventory.outbox = [];
gs.player.gold = 500;

const setTile = (idx, contentId) => {
  const t = gs.map.outerTiles[idx];
  t.contentId = contentId;
  t.contentState = {};
  t.dailyFlags = {};
  return t;
};
const origRandom = Math.random;

// ════════════════════════════════════════════════════════════
head('裁决① 鸡蛋储存满 10：产出直接丢弃（不进背包、不进任何储存）');
// ════════════════════════════════════════════════════════════
{
  const tile1 = setTile(1, 'facility_henhouse');
  gs.creatures = [];
  const chicken = CreatureSystem.spawnCreature(gs, 'chicken', { facilityId: 'facility_henhouse', sourceTileIdx: 1 });
  chicken.mood = 0; // 优质蛋概率 0，保证确定性
  tile1.contentState.eggStored = 10; // 已满额
  tile1.contentState.eggStoredGolden = 0;
  tile1.contentState.henhouseFeed = { item_wheat: 1 };
  const bagBefore = countItem(gs, 'item_egg');
  CreatureSystem.onDayEnd(gs);
  assert(tile1.contentState.eggStored === 10, '满额：鸡蛋不再入库（仍为 10）', tile1.contentState.eggStored);
  assert(countItem(gs, 'item_egg') === bagBefore, '满额：鸡蛋也不进背包（直接丢弃）', countItem(gs, 'item_egg'));
}

// ════════════════════════════════════════════════════════════
head('裁决① 优质蛋与鸡蛋共享同一储存额度（合计 10）');
// ════════════════════════════════════════════════════════════
{
  const tile1 = gs.map.outerTiles[1];
  const chicken = gs.creatures.find((c) => c.kind === 'chicken');
  // 8 + 0：本日产 1 普通蛋 + 心情 10 → 优质蛋概率 100%（chance(1) 恒真）→ 合计正好 10
  tile1.contentState.eggStored = 8;
  tile1.contentState.eggStoredGolden = 0;
  tile1.contentState.henhouseFeed = { item_wheat: 1 };
  chicken.mood = 10;
  CreatureSystem.onDayEnd(gs);
  assert(tile1.contentState.eggStored === 9, '普通蛋入库（8→9）', tile1.contentState.eggStored);
  assert(tile1.contentState.eggStoredGolden === 1, '优质蛋入同一额度（0→1）', tile1.contentState.eggStoredGolden);
  assert((tile1.contentState.eggStored + tile1.contentState.eggStoredGolden) === 10, '合计达到共享上限 10');

  // 满额次日：鸡蛋与优质蛋都丢弃
  tile1.contentState.henhouseFeed = { item_wheat: 1 };
  const bagEgg = countItem(gs, 'item_egg');
  const bagGold = countItem(gs, 'item_golden_egg');
  CreatureSystem.onDayEnd(gs);
  assert(tile1.contentState.eggStored === 9 && tile1.contentState.eggStoredGolden === 1,
    '满额：鸡蛋与优质蛋都不再入库', { e: tile1.contentState.eggStored, g: tile1.contentState.eggStoredGolden });
  assert(countItem(gs, 'item_egg') === bagEgg && countItem(gs, 'item_golden_egg') === bagGold,
    '满额：两者都不进背包（直接丢弃）');

  // 收获进背包：两物为不同物品分别占格
  const before = gs.inventory.items.length;
  addItem(gs, 'item_egg', 1);
  addItem(gs, 'item_golden_egg', 1);
  const ids = gs.inventory.items.map((s) => s.itemId);
  assert(ids.includes('item_egg') && ids.includes('item_golden_egg') && gs.inventory.items.length >= before + 2,
    '收获进背包：鸡蛋与优质蛋分别占格（不同物品条目）', ids);
}

// ════════════════════════════════════════════════════════════
head('裁决② 超载真伤 = 该类型全部生物 × 100% 当前攻击力（逐只独立结算）');
// ════════════════════════════════════════════════════════════
{
  gs.creatures = [];
  // 先用 5 格栅栏生成 5 只危险生物，再缩回 1 格 → 容量 = 4（§13.1 栅栏扩格加成），构成超载 1 只
  gs.map.fence = [];
  for (let i = 0; i < 5; i++) gs.map.fence.push({ row: 0, col: i, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] });
  for (let i = 0; i < 5; i++) CreatureSystem.spawnCreature(gs, 'slime_fire', { facilityId: 'resource_hunt', sourceTileIdx: null });
  assert(gs.creatures.length === 5, '5 只危险生物已生成', gs.creatures.length);
  gs.map.fence = [gs.map.fence[0]]; // 容量回到 危险 4
  // 模拟增益：最后一只实例当前攻击力被改写为 25（按当前值结算，不是种族面板 10）
  gs.creatures[4].atk = 25;
  gs.player.maxHp = 1000; gs.player.hp = 1000;
  gs.capacity = gs.capacity || {};
  gs.capacity.dangerOverdue = 2; // 警告期已满 → 本次【每一日开始时】结算触发惩罚
  Math.random = () => 0.99; // 抑制史莱姆喷吐等随机干扰
  CreatureSystem.onDayStart(gs);
  Math.random = origRandom;
  const baseAtk = getCreatureDef('slime_fire').atk;
  assert(baseAtk === 10, '面板基础攻击力 = 10（creatures.js 定义）', baseAtk);
  assert(gs.player.hp === 1000 - (baseAtk * 4 + 25),
    '超载真伤 = 该类型全部 5 只各自当前攻击力（4×10 + 增益后 25 = -65；旧口径只会扣超出容量的 1 只 -10）', gs.player.hp);
  assert(gs.capacity.dangerOverloaded === true, 'dangerOverloaded 已置位');
}
{
  // 同类型 3 只、容量 1（超 2 只）→ 3 次独立结算（不是只扣超出的 2 只）
  gs.creatures = [];
  for (let i = 0; i < 3; i++) CreatureSystem.spawnCreature(gs, 'slime_fire', { facilityId: 'resource_hunt', sourceTileIdx: null });
  gs.capacity = gs.capacity || {};
  gs.capacity.danger = 1; // 容量 1（本用例直接验证结算口径，不经过 onDayStart 的容量重算）
  gs.player.maxHp = 1000; gs.player.hp = 1000;
  const r3 = CreatureSystem.applyOverloadTrueDamage(gs, 'danger', 'danger_overload');
  assert(r3.count === 3 && r3.total === 30, '同类型 3 只、容量 1 → 结算 3 次、合计 30', r3);
  assert(gs.player.hp === 970, '3 只全部各扣 100% 当前攻击力（-30；旧口径只扣超出的 2 只 -20）', gs.player.hp);
}
{
  // 当前攻击力被增益 / 减益后按当前值结算（15 增益 +5、5 减益 -5、20 强化）
  gs.creatures = [];
  for (let i = 0; i < 3; i++) CreatureSystem.spawnCreature(gs, 'slime_fire', { facilityId: 'resource_hunt', sourceTileIdx: null });
  gs.creatures[0].atk = 15;
  gs.creatures[1].atk = 5;
  gs.creatures[2].atk = 20;
  gs.player.maxHp = 1000; gs.player.hp = 1000;
  const rb = CreatureSystem.applyOverloadTrueDamage(gs, 'danger', 'danger_overload');
  assert(rb.count === 3 && rb.total === 40, '增益 / 减益后逐只按当前攻击力结算（15+5+20 = 40）', rb);
  assert(gs.player.hp === 960, '当前攻击力生效（若按面板 10 结算则应为 -30）', gs.player.hp);
}

// ════════════════════════════════════════════════════════════
head('裁决③ 鸡舍「投放饲料」真实 UI 入口（背包 → 鸡舍储存，与取回对称）');
// ════════════════════════════════════════════════════════════
{
  const tile3 = setTile(3, 'facility_henhouse');
  addItem(gs, 'item_wheat', 3);
  addItem(gs, 'item_rice_straw', 2);
  const w0 = countItem(gs, 'item_wheat');
  const dep = CreatureSystem.depositHenhouseFeed(gs, 3, 'item_wheat', 2);
  assert(dep.ok === true && dep.deposited === 2, '投放小麦 ×2 成功', dep);
  assert(countItem(gs, 'item_wheat') === w0 - 2, '投放从背包扣除', countItem(gs, 'item_wheat'));
  assert(tile3.contentState.henhouseFeed.item_wheat === 2, '进入鸡舍储存', tile3.contentState.henhouseFeed);
  const dep2 = CreatureSystem.depositHenhouseFeed(gs, 3, 'item_rice_straw', 5);
  assert(dep2.ok === true && dep2.deposited === 2, '投放稻草：超出背包数量自动截断为 2', dep2);
  const back = CreatureSystem.withdrawHenhouseFeed(gs, 3, 'item_wheat', 1);
  assert(back.ok === true && countItem(gs, 'item_wheat') === w0 - 1 && tile3.contentState.henhouseFeed.item_wheat === 1,
    '取回与投放对称（储存 -1、背包 +1）', back);
  // UI 入口存在性（InfoPanel 鸡舍功能选项）
  const infoSrc = readFileSync(new URL('../src/ui/InfoPanel.js', import.meta.url), 'utf-8');
  assert(infoSrc.includes('投放饲料') && infoSrc.includes('depositHenhouseFeed'),
    'InfoPanel 已有「投放饲料」入口并调用 depositHenhouseFeed');
}

// ════════════════════════════════════════════════════════════
head('裁决④ 狩猎祝福按地块记账（本格生效，不影响其他狩猎格）');
// ════════════════════════════════════════════════════════════
{
  // 补栅栏空位（上一用例缩到 1 格且被占），保证狩猎成功时生物可入栏
  for (let i = gs.map.fence.length; i < 6; i++) {
    gs.map.fence.push({ row: 1, col: i, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] });
  }
  setTile(4, 'resource_hunt');
  setTile(5, 'resource_hunt');
  HookDispatcher.fire('onBlessed', { gs, tileIdx: 4 });
  assert(gs.map.outerTiles[4].contentState.huntBlessPending === true, '4 号格记账 huntBlessPending');
  assert(!gs.map.outerTiles[5].contentState.huntBlessPending, '5 号格不受影响（不是全局下次）');

  // 5 号格狩猎：无祝福 —— random=0.99 → rate=0.895，判定 0.99>0.895 失败且未 +50%
  Math.random = () => 0.99;
  const hA = huntCreature(gs, 5, 'normal');
  assert(hA.ok === true && Math.abs(hA.rate - 0.895) < 1e-9, '5 号格未获得 +50%（祝福不在本格）', hA.rate);

  // 4 号格狩猎：祝福生效 —— 0.895 + 0.5 → 上限 1.0
  const hB = huntCreature(gs, 4, 'normal');
  assert(hB.ok === true && hB.rate === 1, '4 号格祝福生效（0.895+0.5 → 100%）', hB.rate);
  assert(gs.map.outerTiles[4].contentState.huntBlessPending === false, '4 号格祝福已消耗');
  Math.random = origRandom;
}

// ════════════════════════════════════════════════════════════
head('裁决⑤ 巴士站轮子不限次数（每次进入 +1）');
// ════════════════════════════════════════════════════════════
{
  setTile(7, 'resource_bus');
  gs.player.x = 7;
  gs.player.stamina = 5;
  const wheels = () => gs.vehicle.available.filter((a) => a.vehicleId === 'vehicle_wheel').length;
  const w0 = wheels();
  HookDispatcher.fire('onEnter', { gs, tileIdx: 7 });
  HookDispatcher.fire('onEnter', { gs, tileIdx: 7 });
  HookDispatcher.fire('onEnter', { gs, tileIdx: 7 });
  assert(wheels() === w0 + 3, '同日进入 3 次 → 轮子 +3（不限次数）', wheels() - w0);
  assert(gs.player.stamina === 6, '行动力 +1 仍每日限一次（对照）', gs.player.stamina);
}

// ════════════════════════════════════════════════════════════
head('裁决⑥ 事件池/奖励池：可抽取、可结算、名称均为玩家可见文案');
// ════════════════════════════════════════════════════════════
{
  assert(EVENT_POOL_PLACEHOLDER.length >= 5, '事件池占位条目 ≥5', EVENT_POOL_PLACEHOLDER.length);
  assert(REWARD_POOL_PLACEHOLDER.length >= 5, '奖励池占位条目 ≥5', REWARD_POOL_PLACEHOLDER.length);
  assert([...EVENT_POOL_PLACEHOLDER, ...REWARD_POOL_PLACEHOLDER].every((e) => !e.name.includes('占位')),
    '所有条目名称均为玩家可见文案（不含「占位」字样）');

  // 抽取稳定性：多次抽取均返回表内条目
  const evIds = new Set(EVENT_POOL_PLACEHOLDER.map((e) => e.id));
  let allValid = true;
  for (let i = 0; i < 30; i++) {
    const hit = drawPlaceholderEvent();
    if (!hit || !evIds.has(hit.id)) { allValid = false; break; }
  }
  assert(allValid, '事件池 30 次抽取全部命中表内条目');

  // 效果结算：金币 / 物品 / 行动力
  const byType = {};
  for (const e of EVENT_POOL_PLACEHOLDER) byType[e.effect.type] ??= e;
  const g0 = gs.player.gold;
  applyPlaceholderEventEffect(gs, byType.gold);
  assert(gs.player.gold !== g0, '事件效果：金币变化已结算', gs.player.gold - g0);
  const wheat0 = countItem(gs, 'item_wheat');
  applyPlaceholderEventEffect(gs, { effect: { type: 'item', itemId: 'item_wheat', qty: 2 } });
  assert(countItem(gs, 'item_wheat') === wheat0 + 2, '事件效果：物品进背包');
  const st0 = gs.player.stamina;
  applyPlaceholderEventEffect(gs, byType.stamina);
  assert(gs.player.stamina >= st0, '事件效果：行动力结算', gs.player.stamina - st0);

  // 事件点全流程：进入 → 抽取 + 结算 + onEventResolve（eventId 非空）
  const resolved = [];
  HookDispatcher.register('onEventResolve', (p) => resolved.push(p));
  setTile(0, 'resource_event');
  HookDispatcher.fire('onEnter', { gs, tileIdx: 0 });
  const evLast = resolved[resolved.length - 1];
  assert(!!evLast && evLast.type === 'event' && typeof evLast.eventId === 'string' && evIds.has(evLast.eventId),
    '事件点进入：onEventResolve 携带事件池 eventId', evLast?.eventId);

  // 奖励池：受祝福提升高价值权重（同一随机数下抽取结果不同）
  Math.random = () => 0.8;
  const rwNormal = drawPlaceholderReward(false);
  const rwBlessed = drawPlaceholderReward(true);
  Math.random = origRandom;
  assert(rwNormal.id === 'rwd_ph_05' && rwBlessed.id === 'rwd_ph_06' && rwBlessed.highValue === true,
    `同一随机数 0.8：普通抽中「${rwNormal.name}」，祝福抽中高价值「${rwBlessed.name}」（权重 ×${REWARD_BLESS_WEIGHT_MULT}）`);

  // 奖励点全流程：进入 → 发放 + onEventResolve（rewardId 非空）；祝福记账消耗
  setTile(2, 'resource_reward');
  HookDispatcher.fire('onBlessed', { gs, tileIdx: 2 });
  assert(gs.map.outerTiles[2].contentState.rewardBlessPending === true, '奖励点祝福记账');
  const goldBefore = gs.player.gold;
  const invBefore = gs.inventory.items.reduce((s, x) => s + (x.qty || 0), 0);
  HookDispatcher.fire('onEnter', { gs, tileIdx: 2 });
  const rwLast = resolved[resolved.length - 1];
  const rwIds = new Set(REWARD_POOL_PLACEHOLDER.map((e) => e.id));
  assert(!!rwLast && rwLast.type === 'reward' && rwIds.has(rwLast.rewardId) && rwLast.blessed === true,
    '奖励点进入：携带祝福结算并返回奖励池 rewardId', rwLast?.rewardId);
  const goldAfter = gs.player.gold;
  const invAfter = gs.inventory.items.reduce((s, x) => s + (x.qty || 0), 0);
  assert(goldAfter > goldBefore || invAfter > invBefore,
    '奖励已实际发放（金币或物品）', { dGold: goldAfter - goldBefore, dInv: invAfter - invBefore });
  assert(gs.map.outerTiles[2].contentState.rewardBlessPending === false, '祝福记账已消耗');
}

// ════════════════════════════════════════════════════════════
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
