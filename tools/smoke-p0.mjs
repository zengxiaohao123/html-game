// tools/smoke-p0.mjs —— 第 1 批 P0 修复冒烟测试（Node，无 DOM）
//
// 覆盖：
//   P0-1 连携技按 E 触发队列头部
//   P0-2 祈福/睡觉推进回合
//   P0-3 跨年 year+1
//   P0-4 啤酒【暴躁】临时 +25%（不永久改 atk，按天移除）
//   P0-5 感恩节晚餐 friendlyAsEnemyToday 消费
//   P0-6 心力交瘁睡觉固定回一半（捕获顺序修复）
//   P0-7 帐篷 +3 与回满优先级 —— 2026-11-03 裁决：先回满、后结算 +3 且可超上限
//   P0-8 技能只在本格触发 + 目标取最近
//   P0-9 生命归 0 完整惩罚 + 生物停战/解除
//   P0-10 鸡舍无争议四项（产蛋前置/储存扣饲料/放牧路径/按实例 4 只上限）
//
// 2026-11-03 追加：
//   三处库矛盾裁决（饥饿成长 +5 / 已投喂任一条件 / 帐篷 +3 先回满后超上限）
//   第 3 批生物闭环（容量扩格加成 / 心情 +1 进鸡舍时机 / 鸡蛋储存于鸡舍 /
//   饲料投放取回 / 史莱姆 7 变体核对 05 表）
//
// 用法：node tools/smoke-p0.mjs

import { readFileSync } from 'node:fs';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
const { CalendarSystem } = await import('../src/systems/CalendarSystem.js');
const BlessSystem = await import('../src/systems/BlessSystem.js');
const { sleep } = await import('../src/systems/SleepSystem.js');
const { startNewDay } = await import('../src/systems/DaySystem.js');
const { useItem } = await import('../src/systems/UseItemSystem.js');
const CombatSystem = await import('../src/systems/CombatSystem.js');
const SkillSystem = await import('../src/systems/SkillSystem.js');
const CreatureSystem = await import('../src/systems/CreatureSystem.js');
const LinkSkillSystem = await import('../src/systems/LinkSkillSystem.js');
const { addItem, countItem } = await import('../src/systems/InventorySystem.js');
const { CREATURES } = await import('../src/data/creatures.js');

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
gs.player.gold = 100;
gs.player.stamina = 10;

head('P0-3 跨年 year+1');
{
  const g = { calendar: { year: 1, month: 12, dayOfMonth: 28, weekday: 7 } };
  const r = CalendarSystem.tickDay(g);
  assert(r.newYear === true, '12 月 28 日 +1 天触发跨年标记');
  assert(g.calendar.year === 2, '年份 +1（此前恒为 1）', g.calendar.year);
  assert(g.calendar.month === 3 && g.calendar.dayOfMonth === 1, '跨年落到次年 3 月 1 日');
}

head('P0-1 连携技按 E 触发队列头部');
{
  gs.linkSkillQueue = [
    { skillId: 'skill_link_yumo_drain', roleId: 'yumo', expireAtMs: Date.now() + 3000, context: { element: 'fire' } },
    { skillId: 'skill_link_xiayang_scorch', roleId: 'xiayang', expireAtMs: Date.now() + 3000, context: {} },
  ];
  const r = LinkSkillSystem.fireCurrentQueueTop(gs);
  assert(!!r && r.ok === true, 'fireCurrentQueueTop 结算成功', r);
  assert(gs.linkSkillQueue.length === 1 && gs.linkSkillQueue[0].skillId === 'skill_link_xiayang_scorch',
    '只消费队列头部，其余依次前移', gs.linkSkillQueue.map(e => e.skillId));
  assert(gs.team.yumoNextElementOverride === 'fire', '头部技能（汲取）效果已结算');
  const uiSrc = readFileSync(new URL('../src/ui/LinkSkillUI.js', import.meta.url), 'utf8');
  assert(uiSrc.includes("key === 'e' || key === 'E'"), 'LinkSkillUI 按键改为 E');
  assert(uiSrc.includes('fireCurrentQueueTop') && !uiSrc.includes('_triggerIdx'), 'UI 走队列头部触发（不再有 1/2/3 数字键按索引触发）');
}

head('P0-2 祈福推进回合');
{
  const turn0 = gs.turn;
  const s1 = BlessSystem.blessStart(gs);
  assert(s1.ok === true, '祈福开始成功', s1.reason);
  BlessSystem.blessCommit(gs, s1.targetIdx);
  assert(gs.turn === turn0 + 1, '祈福结算后 turn +1（§5.2）', { turn0, now: gs.turn });
}

head('P0-2 睡觉推进回合');
{
  gs.skillCooldowns = { skill_smoke_0: 3 };
  gs.player.x = 6; // 家
  gs.player.stamina = 5;
  sleep(gs);
  assert(gs.skillCooldowns.skill_smoke_0 === 2, '睡觉经过 1 次 advanceTurn → 技能冷却 -1', gs.skillCooldowns);
  assert(gs.player.stamina === gs.player.maxStamina, '在家睡觉回满', gs.player.stamina);
}

head('P0-6 心力交瘁：带着入睡只回一半');
{
  gs.player.x = 6;
  gs.player.stamina = -2;
  gs.activeBuffs.push({ id: 'exhausted', target: 'player', remainingTurns: 1, params: {} });
  sleep(gs);
  assert(gs.player.stamina === Math.ceil(gs.player.maxStamina / 2),
    '心力交瘁入睡固定回一半（此前被 startNewDay 先清 buff，恒回满）', gs.player.stamina);
  assert(!gs.activeBuffs.some(b => b.id === 'exhausted'), '睡后心力交瘁解除');
}

head('P0-4 啤酒【暴躁】：临时 +25%，不改 atk，按天移除');
{
  const atk0 = gs.player.atk;
  const origRandom = Math.random;
  Math.random = () => 0.01; // 强制命中 30% 概率
  addItem(gs, 'item_beer', 1);
  const ub = useItem(gs, 'item_beer');
  Math.random = origRandom;
  assert(ub.ok === true, '啤酒使用成功');
  const grumpy = gs.activeBuffs.find(b => b.id === 'grumpy');
  assert(!!grumpy && grumpy.remainingDays === 1, '暴躁以 buff 形式挂载，持续 1 天', grumpy);
  assert(gs.player.atk === atk0, 'gs.player.atk 不再被永久乘算', { atk0, now: gs.player.atk });

  // 伤害乘算验证
  // 注意：队伍含雨墨天赋「何以为我」，物理伤害 ×1.5（当日元素种类 0 → 无衰减）。
  // 暴躁在天赋之前乘算：⌊(10×1.25)×1.5⌋ = 18；无暴躁：⌊10×1.5⌋ = 15。
  const defender = { kind: 'slime', category: 'danger', hp: 100, maxHp: 100, activeBuffs: [] };
  Math.random = () => 0.99; // 避免暴击
  const withGrumpy = CombatSystem.calculateDamage({ atk: 10, defender, element: 'physical', player: gs.player, gs, roleId: 'yumo' });
  assert(withGrumpy.finalDamage === 18, '暴躁时 10 攻 → 18（×1.25 再 ×1.5 天赋后向下取整）', withGrumpy.finalDamage);
  gs.activeBuffs = gs.activeBuffs.filter(b => b.id !== 'grumpy');
  defender.hp = 100;
  const noGrumpy = CombatSystem.calculateDamage({ atk: 10, defender, element: 'physical', player: gs.player, gs, roleId: 'yumo' });
  Math.random = origRandom;
  assert(noGrumpy.finalDamage === 15, '无暴躁时伤害还原为 15（仅天赋 ×1.5，buff 到期即失效）', noGrumpy.finalDamage);

  // 跨日移除
  gs.activeBuffs.push({ id: 'grumpy', name: '暴躁', remainingDays: 1, atkBonus: 0.25 });
  startNewDay(gs);
  assert(!gs.activeBuffs.some(b => b.id === 'grumpy'), '次日开始时暴躁被移除（remainingDays 每日 -1）');
}

head('P0-5 感恩节晚餐：友善生物当日视为敌人');
{
  gs.map.outerTiles[0].contentId = 'skill_yumo_slash';
  gs.skillCooldowns = {};
  const chick = CreatureSystem.spawnCreature(gs, 'chick', {});
  assert(!!chick && chick.category === 'friendly', '栅栏里有一只友善小鸡');
  const hp0 = chick.hp;
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  assert(chick.hp === hp0, '未用晚餐：技能不攻击友善生物');
  gs.flags = gs.flags || {};
  gs.flags.friendlyAsEnemyToday = true;
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  assert(chick.hp < hp0, '使用晚餐当天：技能可攻击友善生物', { hp0, now: chick.hp });
  gs.flags.friendlyAsEnemyToday = false;
}

head('P0-8 技能只在事件本格触发 + 目标取最近');
{
  // 清场：手搓两只不同距离的危险生物
  gs.creatures = [];
  gs.map.fence = [
    { row: 0, col: 0, creatures: [] },
    { row: 0, col: 1, creatures: [] },
  ];
  const cA = { id: 'cA', kind: 'slime', category: 'danger', row: 0, col: 0, hp: 100, maxHp: 100, atk: 0, activeBuffs: [] };
  const cB = { id: 'cB', kind: 'slime', category: 'danger', row: 0, col: 1, hp: 100, maxHp: 100, atk: 0, activeBuffs: [] };
  gs.creatures.push(cA, cB);
  gs.map.fence[0].creatures = ['cA'];
  gs.map.fence[1].creatures = ['cB'];
  gs.map.outerTiles[0].contentId = 'skill_yumo_slash';
  gs.map.outerTiles[2].contentId = 'skill_yumo_slash';
  gs.skillCooldowns = {};

  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  assert(cA.hp < 100, '本格技能触发：命中目标', cA.hp);
  assert(cB.hp === 100, '只触发 0 号格技能（2 号格技能未被连带触发；且目标是离 0 号格最近的 cA）', cB.hp);

  const hpBefore = cA.hp;
  SkillSystem.triggerSkillByHook('onEnter', { gs }); // 无 tileIdx
  assert(cA.hp === hpBefore, '缺少 tileIdx 时不触发任何技能');
}

head('P0-9 生命归 0 惩罚 + 生物停战');
{
  // 基础惩罚
  gs.player.hp = 0; gs.player.stamina = 5; gs.player.gold = 200;
  CombatSystem.applyDeathPenalty(gs, gs.player);
  assert(gs.player.hp === 1, '生命回 1');
  assert(gs.player.stamina === 0, '行动力变 0');
  assert(gs.player.gold === 180, '扣 10% 金币', gs.player.gold);
  assert(gs.flags.creatureTruce === true, '进入生物停战状态');

  // 已为负数的行动力不变（§5.4）
  gs.player.hp = 0; gs.player.stamina = -2; gs.player.gold = 0;
  CombatSystem.applyDeathPenalty(gs, gs.player);
  assert(gs.player.stamina === -2, '行动力已为负数时不变', gs.player.stamina);

  // 金币扣除上限 1000
  gs.player.hp = 0; gs.player.stamina = 0; gs.player.gold = 20000;
  CombatSystem.applyDeathPenalty(gs, gs.player);
  assert(gs.player.gold === 19000, '金币扣除额上限 1000', gs.player.gold);

  // 停战解除：玩家主动攻击任意生物
  gs.flags.creatureTruce = true;
  const target = { kind: 'slime', category: 'danger', hp: 100, maxHp: 100, activeBuffs: [] };
  CombatSystem.calculateDamage({ atk: 5, defender: target, element: 'physical', player: gs.player, gs, roleId: 'yumo' });
  assert(gs.flags.creatureTruce === false, '玩家主动攻击生物后停战解除');

  // 真实伤害路径并入归 0 判定
  gs.flags.creatureTruce = false;
  gs.player.hp = 3; gs.player.stamina = 4; gs.player.gold = 100;
  CombatSystem.applyTrueDamageToPlayer(gs, gs.player, 10, { reason: 'smoke' });
  assert(gs.player.hp === 1 && gs.player.stamina === 0 && gs.player.gold === 90,
    '真实伤害打到 0 也触发完整惩罚', { hp: gs.player.hp, stamina: gs.player.stamina, gold: gs.player.gold });
  assert(gs.flags.creatureTruce === true, '真实伤害归 0 同样进入停战');
}

head('P0-10 鸡舍：按实例 4 只上限');
{
  gs.creatures = [];
  gs.map.fence = [
    { row: 0, col: 0, creatures: [] }, { row: 0, col: 1, creatures: [] },
    { row: 1, col: 0, creatures: [] }, { row: 1, col: 1, creatures: [] },
    { row: 0, col: 2, creatures: [] }, { row: 2, col: 0, creatures: [] },
  ];
  gs.map.fenceRowCols = 3;
  gs.map.outerTiles[1].contentId = 'facility_henhouse';
  gs.map.outerTiles[3].contentId = 'facility_henhouse';
  gs.map.outerTiles[1].dailyFlags = {};
  gs.map.outerTiles[3].dailyFlags = {};
  gs.map.outerTiles[1].contentState = {};
  gs.map.outerTiles[3].contentState = {};

  for (let i = 0; i < 4; i++) {
    CreatureSystem.spawnCreature(gs, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 1 });
  }
  assert(gs.creatures.filter(c => c.sourceTileIdx === 1).length === 4, '1 号鸡舍实例已有 4 只');
  HookDispatcher.fire('onEnter', { gs, tileIdx: 1 });
  assert(gs.creatures.filter(c => c.sourceTileIdx === 1).length === 4, '1 号鸡舍已满 4 只 → 不再生成');
  HookDispatcher.fire('onEnter', { gs, tileIdx: 3 });
  assert(gs.creatures.filter(c => c.sourceTileIdx === 3).length === 1,
    '3 号鸡舍实例独立计数，仍可生成（不是按类型全局 4 只）');
}

head('P0-10 鸡舍：饲料存入鸡舍内储存');
{
  addItem(gs, 'item_wheat', 3);
  const dep = CreatureSystem.depositHenhouseFeed(gs, 1, 'item_wheat', 2);
  assert(dep.ok === true && dep.deposited === 2, '饲料存入鸡舍', dep);
  assert(countItem(gs, 'item_wheat') === 1, '背包扣除饲料');
  assert(gs.map.outerTiles[1].contentState.henhouseFeed.item_wheat === 2, '鸡舍内储存 +2');
  assert(!CreatureSystem.depositHenhouseFeed(gs, 1, 'item_egg', 1).ok, '非饲料不可存入');
  assert(!CreatureSystem.depositHenhouseFeed(gs, 0, 'item_wheat', 1).ok, '非鸡舍地块不可存入');
}

head('P0-10 鸡舍：投喂从鸡舍内储存扣（不动背包）');
{
  // 只保留 1 号鸡舍的第一只小鸡，排除干扰
  const chick1 = gs.creatures.find(c => c.sourceTileIdx === 1);
  gs.creatures = [chick1];
  for (const t of gs.map.fence) t.creatures = t.creatures.filter(id => id === chick1.id);
  chick1.grazedForFeed = false; chick1.growth = 0; chick1.mood = 0; chick1.lastFed = false;

  CreatureSystem.dailyTick(gs);
  assert(chick1.lastFed === true, '有储存饲料 → 已投喂');
  assert(chick1.growth === 10, '成长值 +（10 + 心情 0）', chick1.growth);
  assert(gs.map.outerTiles[1].contentState.henhouseFeed.item_wheat === 1, '从鸡舍内储存扣 1');
  assert(countItem(gs, 'item_wheat') === 1, '背包不被扣除');
}

head('P0-10 鸡舍：放牧路径（啃草次日免消耗即已投喂）');
{
  const chick1 = gs.creatures[0];
  const storeBefore = gs.map.outerTiles[1].contentState.henhouseFeed.item_wheat;
  const growthBefore = chick1.growth;
  chick1.grazedForFeed = true;
  CreatureSystem.dailyTick(gs);
  assert(chick1.lastFed === true && chick1.grazedForFeed === false, '放牧标记被消费 → 已投喂');
  assert(chick1.growth === growthBefore + 10 + chick1.mood || chick1.growth > growthBefore, '放牧同样获得成长', chick1.growth);
  assert(gs.map.outerTiles[1].contentState.henhouseFeed.item_wheat === storeBefore, '放牧不消耗鸡舍内储存');
}

head('P0-10 鸡舍：心情 +1 时机 = 玩家进入鸡舍（每日限 1 次）');
{
  const chick1 = gs.creatures[0];
  chick1.mood = 0;
  chick1.lastHenhouseMoodDay = undefined;
  gs.map.outerTiles[1].dailyFlags['facility_henhouse_spawn'] = true; // 跳过生成小鸡，只验心情
  HookDispatcher.fire('onEnter', { gs, tileIdx: 1 });
  assert(chick1.mood === 1, '进入鸡舍 → 心情 +1（§13.3 / BIO-002 L 列）', chick1.mood);
  HookDispatcher.fire('onEnter', { gs, tileIdx: 1 });
  assert(chick1.mood === 1, '同日再次进入不叠加（每日限 1 次）', chick1.mood);
  // dailyTick 不再无条件结算心情 +1
  const m0 = chick1.mood;
  chick1.grazedForFeed = true; // 走投喂，避免饥饿 -1 干扰
  CreatureSystem.dailyTick(gs);
  assert(chick1.mood === m0, 'dailyTick 不无条件加心情', chick1.mood);
}

head('P0-10 鸡舍：饥饿 → 心情 -1、成长值 +5（2026-11-03 裁决）');
{
  const chick1 = gs.creatures[0];
  gs.map.outerTiles[1].contentState.henhouseFeed = {};
  chick1.grazedForFeed = false;
  const g0 = chick1.growth;
  const m0 = chick1.mood;
  CreatureSystem.dailyTick(gs);
  assert(chick1.lastFed === false, '无饲料无放牧 → 饥饿');
  assert(chick1.growth === g0 + 5, '饥饿成长值 +5（裁决：成长 +5、心情 -1）', { g0, now: chick1.growth });
  assert(chick1.mood === Math.max(-5, m0 - 1), '饥饿心情 -1', { m0, now: chick1.mood });
}

head('P0-10 鸡舍：产蛋需已投喂前置 + 鸡蛋储存于来源鸡舍（OUT-11）');
{
  const chick1 = gs.creatures[0];
  chick1.kind = 'chicken'; chick1.stage = 'adult'; chick1.growthMax = 0;
  chick1.mood = 0; // 优质蛋概率 0，保证确定性
  const tile1 = gs.map.outerTiles[1];
  tile1.contentState.eggStored = 0;

  chick1.lastFed = false;
  chick1.grazedForFeed = false;
  tile1.contentState.henhouseFeed = {};
  CreatureSystem.dailyTick(gs);
  assert(tile1.contentState.eggStored === 0, '饥饿（未投喂）→ 不产蛋');

  tile1.contentState.henhouseFeed = { item_wheat: 1 };
  CreatureSystem.dailyTick(gs);
  assert(chick1.lastFed === true, '本日投喂结算为已投喂');
  assert(tile1.contentState.eggStored === 1,
    '已投喂 → 产 1 蛋，储存于来源鸡舍（进入时取走）', tile1.contentState.eggStored);

  // 储存上限 10（OUT-11）：满后不再入库
  tile1.contentState.eggStored = 10;
  tile1.contentState.henhouseFeed = { item_wheat: 1 };
  CreatureSystem.dailyTick(gs);
  assert(tile1.contentState.eggStored === 10, '储存上限 10：满后不再入库', tile1.contentState.eggStored);
}

head('P0-7 帐篷 +3：先回满、后结算 +3 且可超上限（2026-11-03 裁决）');
{
  // 搭帐篷（5 号格）并祝福攒 +3，睡一觉：先回满再 +3，允许超出上限
  gs.map.outerTiles[5].contentId = 'facility_tent';
  gs.map.outerTiles[5].contentState = {};
  gs.map.outerTiles[5].dailyFlags = {};
  gs.map.outerTiles[5].states = [{ type: 'tent_bless', bonus: 3 }];
  gs.player.x = 5;
  gs.player.stamina = 0;
  gs.activeBuffs = gs.activeBuffs.filter(b => b.id !== 'exhausted');
  sleep(gs);
  assert(gs.player.stamina === gs.player.maxStamina + 3,
    '帐篷 +3 在回满之后结算且超出上限', gs.player.stamina);
  assert(!gs.map.outerTiles[5].states.some(s => s.type === 'tent_bless'),
    'tent_bless 一次睡觉消耗一次');
}

head('三处库矛盾裁决：TODO 已移除');
{
  const facSrc = readFileSync(new URL('../src/data/facilities.js', import.meta.url), 'utf8');
  const sleepSrc = readFileSync(new URL('../src/systems/SleepSystem.js', import.meta.url), 'utf8');
  const creatureSrc = readFileSync(new URL('../src/systems/CreatureSystem.js', import.meta.url), 'utf8');
  assert(!facSrc.includes('TODO(P0-7') && !sleepSrc.includes('TODO(P0-7'), '帐篷 +3 与回满优先级：TODO 已移除');
  assert(!creatureSrc.includes('TODO(饥饿成长值'), '饥饿成长 +5：TODO 已移除');
  assert(!creatureSrc.includes('TODO(BIO-002'), 'BIO-002 已投喂语义：TODO 已移除');
  assert(creatureSrc.includes('c.growth += 5'), '饥饿成长值按裁决改为 +5');
}

head('P1-2 容量扩格加成：栅栏每多 1 格 → 友善/危险容量各 +1');
{
  const fence0 = gs.map.fence;
  gs.map.fence = [{}, {}, {}, {}]; // 4 格
  CreatureSystem.dailyTick(gs);
  assert(gs.capacity.friendly === 7, '4 格栅栏 → 友善容量 4+3', gs.capacity.friendly);
  assert(gs.capacity.danger === 7, '4 格栅栏 → 危险容量 4+3', gs.capacity.danger);
  gs.map.fence = [{}]; // 初始 1 格
  CreatureSystem.dailyTick(gs);
  assert(gs.capacity.friendly === 4 && gs.capacity.danger === 4,
    '1 格栅栏 → 初始容量 4/4', gs.capacity);
  gs.map.fence = fence0;
}

head('鸡舍饲料投放/取回：depositHenhouseFeed / withdrawHenhouseFeed');
{
  const tile1 = gs.map.outerTiles[1];
  tile1.contentState.henhouseFeed = {};
  addItem(gs, 'item_wheat', 2);
  const w0 = countItem(gs, 'item_wheat');
  assert(CreatureSystem.depositHenhouseFeed(gs, 1, 'item_wheat', 2).ok, '投放 2 小麦入鸡舍');
  assert(tile1.contentState.henhouseFeed.item_wheat === 2, '鸡舍储存 +2');
  assert(countItem(gs, 'item_wheat') === w0 - 2, '背包 -2');
  const r = CreatureSystem.withdrawHenhouseFeed(gs, 1, 'item_wheat', 1);
  assert(r.ok && r.withdrawn === 1, '取回 1 小麦');
  assert(tile1.contentState.henhouseFeed.item_wheat === 1, '储存剩 1');
  assert(countItem(gs, 'item_wheat') === w0 - 1, '背包 +1');
  CreatureSystem.withdrawHenhouseFeed(gs, 1, 'item_wheat', 1);
  assert(!CreatureSystem.withdrawHenhouseFeed(gs, 1, 'item_wheat', 1).ok, '储存为空不可再取回');
}

head('史莱姆 7 变体：属性免疫与数值逐项核对物品库 05 表');
{
  // 05 表 BIO-004~BIO-010：hp 40 / atk 10 / spd 2，免疫自身属性元素
  const expect = {
    slime_fire: 'fire', slime_water: 'water', slime_thunder: 'thunder',
    slime_ice: 'ice', slime_grass: 'grass', slime_wind: 'wind', slime_rock: 'rock',
  };
  for (const [kind, elem] of Object.entries(expect)) {
    const def = CREATURES[kind];
    assert(def && def.hp === 40 && def.atk === 10, `${kind} hp 40 / atk 10`, def && { hp: def.hp, atk: def.atk });
    assert(def.element === elem && def.elementImmune === elem, `${kind} 属性/免疫 = ${elem}`, { element: def.element, immune: def.elementImmune });
    assert(def.moveEverySec === 2, `${kind} spd 2 → moveEverySec 2`, def.moveEverySec);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
