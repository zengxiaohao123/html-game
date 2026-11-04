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
check(gs.player.hp === 100 && gs.player.gold === 0, `初始 HP 100 / 金币 0（§5.3 金币初始为 0，实际 ${gs.player.gold}）`);
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

// ═══ 第 13 批 波 1：阻断 + 系统严重修复验证 ═══
const { LinkSkillSystem } = await import('../src/systems/LinkSkillSystem.js');
const { TalentSystem } = await import('../src/systems/TalentSystem.js');
const { DaySystem } = await import('../src/systems/DaySystem.js');
const { UseItemSystem } = await import('../src/systems/UseItemSystem.js');
const { PassiveItemSystem } = await import('../src/systems/PassiveItemSystem.js');
const { GameDirector } = await import('../src/systems/GameDirector.js');
const { STARTER_GOLD } = await import('../src/data/starterPack.js');
const { SKILLS } = await import('../src/data/characters.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');

/** 确保围栏里有一只满血危险史莱姆（被击败则重新生成） */
function ensureSlime(g) {
  let s = g.creatures.find((c) => c.kind === 'slime_grass' && c.hp > 0);
  if (!s) s = CreatureSystem.spawnCreature(g, 'slime_grass', {});
  s.hp = s.maxHp;
  s.activeBuffs = s.activeBuffs || [];
  return s;
}

console.log('\n═══ 12. 技能冷却按技能卡 + 开拓消耗地形（§12.3 / SKL-A-003） ═══');
{
  const g = createInitialState();
  g.map.fence = [{ row: 0, col: 0, creatures: [] }];
  const s = CreatureSystem.spawnCreature(g, 'slime_grass', {});
  for (const idx of [1, 3, 4]) {
    g.map.outerTiles[idx].terrain = 'terrain_grass';
    g.map.outerTiles[idx].terrainAmount = 10;
  }
  g.map.outerTiles[0].contentId = 'skill_yumo_pioneer';
  g.skillCooldowns = {};
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  const keys = Object.keys(g.skillCooldowns);
  check(keys.length === 1 && !/_\d+$/.test(keys[0]), `冷却键按技能卡、不含地块索引（${keys[0]}）`);
  const terrLeft = g.map.outerTiles.filter((t) => t.terrain && t.terrain !== 'terrain_none').length;
  check(terrLeft === 1, `开拓攻击前恰好消耗 2 块地形（3 → ${terrLeft}）`);
  // 技能卡移到另一格：冷却保留（B-3）
  g.map.outerTiles[5].contentId = 'skill_yumo_pioneer';
  g.map.outerTiles[0].contentId = null;
  s.hp = s.maxHp;
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 5 });
  check(s.hp === s.maxHp, '技能卡移动后冷却保留、不重复触发（§12.3）');
  DaySystem.startNewDay(g);
  check((g.skillCooldowns[keys[0]] || 0) > 0, '技能卡冷却跨天不清零（以回合计）');
}

console.log('\n═══ 13. 鼓舞 / 众愿：本日生效 + 跨天回滚（SKL-A-004 / SKL-A-007） ═══');
{
  const g = createInitialState();
  g.map.fence = [{ row: 0, col: 0, creatures: [] }];
  ensureSlime(g);
  const atk0 = g.player.atk;
  g.map.outerTiles[0].contentId = 'skill_xiayang_inspire_lv1';
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  check(g.player.atk === atk0 + 15 && g.team.dailyInspireAtkApplied === 15,
    `鼓舞【进入时】本日攻击力 +15（${atk0} → ${g.player.atk}）`);
  ensureSlime(g);
  g.map.outerTiles[0].contentId = 'skill_xiayang_all_wishes';
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  check(g.team.allWishesActive === true, '众愿：本日火伤 +20% / 其余 -10% 已置位');
  DaySystem.startNewDay(g);
  check(Math.abs(g.player.atk - atk0) < 0.001, `鼓舞攻击加成跨天回滚（${g.player.atk} = ${atk0}）`);
  check(g.team.allWishesActive === false, '众愿跨天清除');
}

console.log('\n═══ 14. 引燃 / 爆炸狂欢 / 屏息瞄准（SKL-A-006 / 008 / 010） ═══');
{
  const g = createInitialState();
  g.map.fence = [{ row: 0, col: 0, creatures: [] }];
  const s = ensureSlime(g);
  // 引燃：【进入时】施加燃烧
  g.map.outerTiles[0].contentId = 'skill_xiayang_ignite';
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  const burnDur = SKILLS.skill_xiayang_ignite.extraEffect.duration;
  const burn = s.activeBuffs.find((b) => b.id === 'burn');
  check(!!burn && burn.remainingTurns === burnDur, `引燃【进入时】施加 ${burnDur} 回合燃烧（实际 ${burn?.remainingTurns}）`);
  // 引燃：【受祝福时】燃烧剩余回合翻倍（不再施加新燃烧）
  SkillSystem.triggerSkillByHook('onBlessed', { gs: g, tileIdx: 0 });
  const burn2 = s.activeBuffs.find((b) => b.id === 'burn');
  check(burn2.remainingTurns === burnDur * 2, `引燃【受祝福时】燃烧剩余回合翻倍（${burnDur} → ${burn2.remainingTurns}）`);
  // 爆炸狂欢：冷却置位 +【受祝福时】刷新冷却
  ensureSlime(g);
  g.map.outerTiles[0].contentId = 'skill_xiayang_blast_carnival';
  g.skillCooldowns = {};
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  const blastKey = 'skill_skill_xiayang_blast_carnival';
  check(g.skillCooldowns[blastKey] === SKILLS.skill_xiayang_blast_carnival.cooldown,
    `爆炸狂欢进入冷却 ${SKILLS.skill_xiayang_blast_carnival.cooldown} 回合（实际 ${g.skillCooldowns[blastKey]}）`);
  ensureSlime(g);
  SkillSystem.triggerSkillByHook('onBlessed', { gs: g, tileIdx: 0 });
  check(!(blastKey in g.skillCooldowns), '爆炸狂欢【受祝福时】冷却立即刷新');
  // 屏息瞄准：陆悠悠下次暴击率 +100%
  ensureSlime(g);
  g.map.outerTiles[0].contentId = 'skill_luyouyou_breathe_aim';
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 0 });
  check(g.team.luyouyouNextCritBonus === 1.0, '屏息瞄准：下次攻击暴击率 +100%（不可叠加标记已置）');
}

console.log('\n═══ 15. 合纵连横 行+列范围伤害（SKL-A-012） ═══');
{
  const g = createInitialState();
  g.map.fence = [{ row: 0, col: 0, creatures: [] }];
  const s = CreatureSystem.spawnCreature(g, 'slime_grass', {});
  g.map.outerTiles[1].contentId = 'skill_zongheng'; // 上中 → 栅栏列 0
  const hp0 = s.hp;
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 1 });
  check(s.hp < hp0, `合纵连横对所在行+列敌人结算（${hp0} → ${s.hp}）`);
}

console.log('\n═══ 16. 生物击杀掉落（物品库 BIO-001/002/003） ═══');
{
  const g = createInitialState();
  g.inventory.items = [];
  CreatureSystem.grantKillDrops(g, { kind: 'chick' });
  check(InventorySystem.countItem(g, 'item_raw_meat') === 1, '小鸡 → 生肉 ×1');
  CreatureSystem.grantKillDrops(g, { kind: 'chicken' });
  check(InventorySystem.countItem(g, 'item_raw_meat') === 4, '鸡 → 生肉 ×3（累计 4）');
  CreatureSystem.grantKillDrops(g, { kind: 'slime_fire' });
  check(InventorySystem.countItem(g, 'item_slime_gel') === 1, '元素史莱姆 → 史莱姆凝胶 ×1');
}

console.log('\n═══ 17. 晴风祈福攻击加成跨天回滚（§12.8 / §12.2） ═══');
{
  const g = createInitialState();
  g.team.groups[0].spirit = 'qingfeng';
  g.player.stamina = 8;
  g.player.gold = 10;
  const atk0 = g.player.atk;
  BlessSystem.bless(g);
  check(g.player.atk > atk0 && g.team.qingfengAtkApplied > 0,
    `晴风祈福攻击力 +8%（${atk0} → ${g.player.atk}，累计增量 ${g.team.qingfengAtkApplied}）`);
  DaySystem.startNewDay(g);
  check(Math.abs(g.player.atk - atk0) < 0.001, `晴风加成跨天一次性回滚（${g.player.atk} = ${atk0}）`);
  check((g.team.dailyQingfengAtkBonus || 0) === 0, '晴风层数跨天清零');
}

console.log('\n═══ 18. 载具移动推进回合 + 移形距离累计（§6.3 / SKL-L-008） ═══');
{
  const g = createInitialState();
  const director = new GameDirector();
  director.gs = g;
  director._registerOnce(); // 注册 GE.MOVE(byVehicle) 订阅
  InventorySystem.addItem(g, 'skill_link_shift', 1); // 已习得移形
  const turn0 = g.turn;
  EventBus.emit(GE.MOVE, { byVehicle: true, distance: 3, fromIdx: 6, toIdx: 2 });
  check(g.turn === turn0 + 1, `载具移动推进 1 回合（${turn0} → ${g.turn}）`);
  check(g.team.dailyDistanceMoved === 3, `移形今日移动距离累计 = ${g.team.dailyDistanceMoved}`);
  check((g.linkSkillQueue || []).some((e) => e.skillId === 'skill_link_shift'), '载具移动后移形入队');
}

console.log('\n═══ 19. 友善超容量：产蛋丢弃、小麦豁免、草莓归 0（§13.2） ═══');
{
  const g = createInitialState();
  g.capacity = g.capacity || {};
  // 真实超载：5 只友善生物 > 容量 4（1 块栅栏），拖欠 1 天 → 本次结算触发惩罚
  g.capacity.friendlyOverdue = 1;
  g.capacity.friendlyOverloaded = true; // 产蛋（第 3 步）发生在容量重算（第 4 步）之前，需预设
  const henTile = g.map.outerTiles.find((t) => !t.contentId);
  henTile.contentId = 'facility_henhouse';
  henTile.contentState = { henhouseFeed: { item_wheat: 1 }, eggStored: 0 };
  g.creatures.push({
    id: 'test_chicken', kind: 'chicken', name: '鸡', category: 'friendly',
    hp: 100, maxHp: 100, sourceTileIdx: henTile.idx, growth: 0, mood: 0,
    lastFed: false, grazedForFeed: false, activeBuffs: [], row: 0, col: 0,
  });
  for (let i = 0; i < 4; i++) {
    g.creatures.push({
      id: `test_chick_${i}`, kind: 'chick', name: '小鸡', category: 'friendly',
      hp: 10, maxHp: 10, sourceTileIdx: null, growth: 0, mood: 0,
      lastFed: false, grazedForFeed: false, activeBuffs: [], row: 0, col: 0,
    });
  }
  CreatureSystem.dailyTick(g);
  check(g.capacity.friendlyOverloaded === true, '超载结算成立（拖欠 ≥ 2 天）');
  check((henTile.contentState.eggStored || 0) === 0, '超容量 → 产蛋被惩罚丢弃（友善类收益归 0）');
  check(henTile.contentState.henhouseFeed.item_wheat === 0, '投喂流程本身不受惩罚影响（储存照常消耗）');
  // 小麦豁免
  const wTile = g.map.outerTiles.find((t) => !t.contentId);
  wTile.contentId = 'facility_wheat';
  wTile.contentState = {};
  wTile.dailyFlags = {};
  const w0 = InventorySystem.countItem(g, 'item_wheat');
  HookDispatcher.fire('onDailyStart', { gs: g });
  check(InventorySystem.countItem(g, 'item_wheat') > w0, '小麦产出不受超容量影响（§13.2 明确排除）');
  // 草莓【经过时】归 0
  const sTile = g.map.outerTiles.find((t) => !t.contentId);
  sTile.contentId = 'facility_strawberry';
  sTile.contentState = {};
  sTile.dailyFlags = {};
  HookDispatcher.fire('onPass', { gs: g, tileIdx: sTile.idx });
  check((sTile.contentState.strawberryStored || 0) === 0, '草莓【经过时】收益被超容量归 0');
  g.capacity.friendlyOverloaded = false;
  HookDispatcher.fire('onPass', { gs: g, tileIdx: sTile.idx });
  check((sTile.contentState.strawberryStored || 0) === 1, '惩罚解除后草莓【经过时】恢复正常');
}

console.log('\n═══ 20. 比翼双飞：加算暴击百分点、排除陆悠悠本人（§12.9） ═══');
{
  const g = createInitialState();
  g.team.twinBuffNextAtkCritRateBonus = 1.0;
  g.team.twinBuffActiveDays = 99;
  const r1 = TalentSystem.consumeTwinBuffIfAny(g, 'luyouyou');
  check(!r1.consumed && g.team.twinBuffNextAtkCritRateBonus === 1.0, '陆悠悠本人不消费比翼 buff');
  const r2 = TalentSystem.consumeTwinBuffIfAny(g, 'yumo');
  check(r2.consumed && r2.add === 1.0 && g.team.twinBuffNextAtkCritRateBonus === 0,
    '其余队友消费比翼：暴击率 +100 百分点（加算）');
}

console.log('\n═══ 21. 连携汲取元素消费 + 屏息瞄准暴击消费（SKL-L-005 / SKL-A-010） ═══');
{
  const g = createInitialState();
  const origRandom = Math.random;
  // 汲取：余默下次攻击转为汲取元素（一次性消费）
  const t1 = { kind: 'slime', category: 'danger', hp: 100, maxHp: 100, activeBuffs: [] };
  g.team.yumoNextElementOverride = 'water';
  Math.random = () => 0.99;
  const r1 = CombatSystem.calculateDamage({ atk: 10, defender: t1, element: 'physical', player: g.player, gs: g, roleId: 'yumo' });
  Math.random = origRandom;
  check(r1.finalElement === 'water' && !g.team.yumoNextElementOverride, '汲取：余默攻击转为水元素且标记被消费');
  // 屏息瞄准：陆悠悠下次攻击必暴并消费
  const t2 = { kind: 'slime', category: 'danger', hp: 100, maxHp: 100, activeBuffs: [] };
  g.team.luyouyouNextCritBonus = 1.0;
  Math.random = () => 0.99;
  const r2 = CombatSystem.calculateDamage({ atk: 10, defender: t2, element: 'physical', player: g.player, gs: g, roleId: 'luyouyou' });
  Math.random = origRandom;
  check(r2.isCrit === true && g.team.luyouyouNextCritBonus === 0, '屏息瞄准：本次攻击必暴且标记被消费');
}

console.log('\n═══ 22. 连携 / 道具冷却：剩余回合语义、跨天不清零（§12.7 / §14） ═══');
{
  const g = createInitialState();
  g.linkSkillCooldowns = { skill_link_yumo_drain: 3 };
  check(LinkSkillSystem.enqueue(g, { skillId: 'skill_link_yumo_drain' }) === null, '连携技冷却中入队被阻挡');
  TurnSystem.advanceTurn(g, 0);
  check(g.linkSkillCooldowns.skill_link_yumo_drain === 2, '连携冷却随回合推进 -1');
  DaySystem.startNewDay(g);
  check(g.linkSkillCooldowns.skill_link_yumo_drain === 2, '连携冷却跨天不清零（§12.7）');
  // 道具冷却
  InventorySystem.addItem(g, 'item_herb', 2);
  const ru = UseItemSystem.useItem(g, 'item_herb');
  check(ru.ok && (g.itemCooldowns.item_herb || 0) > 0, '草药使用后进入冷却（剩余回合数）');
  const leftCd = g.itemCooldowns.item_herb;
  check(!UseItemSystem.canUse(g, 'item_herb').ok, '冷却中的草药被 canUse 拒绝');
  DaySystem.startNewDay(g);
  check(g.itemCooldowns.item_herb === leftCd, '道具冷却跨天不清零（§14）');
  TurnSystem.advanceTurn(g, 0);
  check(g.itemCooldowns.item_herb === leftCd - 1, '回合推进递减道具冷却');
}

console.log('\n═══ 23. 放置型道具放置后不消失（§14.2） ═══');
{
  const g = createInitialState();
  g.inventory.items = [];
  InventorySystem.addItem(g, 'item_trap', 1);
  g.map.outerTiles[0].contentState = {};
  const r = UseItemSystem.useItem(g, 'item_trap', { tileIdx: 0 });
  check(r.ok, '陷阱放置成功');
  check(InventorySystem.countItem(g, 'item_trap') === 1, '放置型道具放置后仍留在背包（不消失）');
  check(g.map.outerTiles[0].contentState.placedItems?.[0]?.itemId === 'item_trap', '陷阱已登记到地块状态');
}

console.log('\n═══ 24. 易伤同名取最高值（§15） ═══');
{
  const target = { kind: 'slime', hp: 100, maxHp: 100, activeBuffs: [] };
  CombatSystem.applyBuff({ buffId: 'vulnerable', target, duration: 3, params: { strength: 0.5 } });
  CombatSystem.applyBuff({ buffId: 'vulnerable', target, duration: 2, params: { strength: 0.3 } });
  const b = target.activeBuffs.find((x) => x.id === 'vulnerable');
  check(b.params.strength === 0.5, `易伤刷新不被更低强度覆盖（strength = ${b.params.strength}）`);
  check(b.remainingTurns === 3, '易伤持续回合取较长者');
}

console.log('\n═══ 25. 心力交瘁：持续 1 日 / 睡觉移除 / 睡觉增益失效（§15 / §5.1） ═══');
{
  const g = createInitialState();
  PassiveItemSystem.initPassiveItems(() => g);
  g.player.stamina = -1;
  TurnSystem.advanceTurn(g, 0);
  check(g.activeBuffs.some((b) => b.id === 'exhausted'), '行动力透支挂【心力交瘁】');
  g.player.stamina = 2;
  TurnSystem.advanceTurn(g, 0);
  check(g.activeBuffs.some((b) => b.id === 'exhausted'), '行动力回合内恢复不提前移除心力交瘁（持续 1 日）');
  g.player.x = 6;
  g.player.hp = 50;
  InventorySystem.addItem(g, 'collectible_royal_pillow', 1);
  SleepSystem.sleep(g);
  check(!g.activeBuffs.some((b) => b.id === 'exhausted'), '睡觉睡醒后移除心力交瘁');
  check(g.player.hp === 50, `心力交瘁期间睡觉增益失效（皇家枕头不回血，hp = ${g.player.hp}）`);
  check(g.player.stamina === Math.ceil(g.player.maxStamina / 2), `心力交瘁睡觉固定回一半行动力（${g.player.stamina}）`);
  // 对照：无心衰时枕头正常生效
  const g2 = createInitialState();
  g2.player.x = 6;
  g2.player.hp = 50;
  InventorySystem.addItem(g2, 'collectible_royal_pillow', 1);
  SleepSystem.sleep(g2);
  check(g2.player.hp === 65, `正常睡觉皇家枕头回 15% 生命（hp = ${g2.player.hp}）`);
}

console.log('\n═══ 26. 开局：金币 0 / 初始包无未知物品（§5.3） ═══');
{
  check(STARTER_GOLD === 0, 'STARTER_GOLD = 0（§5.3 金币初始为 0）');
  const fresh = createInitialState();
  check(fresh.player.gold === 0, `新开局金币 0（实际 ${fresh.player.gold}）`);
  check(!fresh.inventory.items.some((e) => e.itemId === 'skill_heart_force'),
    '初始包不含未知物品 skill_heart_force');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
