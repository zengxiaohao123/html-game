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
  InventorySystem.addItem(g, 'skill_link_shift', 1); // 已习得移形（背包持有 ≠ 生效）
  // 裁定 5：必须放置才生效 —— 未放置时载具移动不入队
  EventBus.emit(GE.MOVE, { byVehicle: true, distance: 1, fromIdx: 6, toIdx: 2 });
  check((g.linkSkillQueue || []).length === 0, '移形未放置 → 背包持有不触发（裁定 5）');
  // 放到外圈格后才生效
  g.map.outerTiles[0].contentId = 'skill_link_shift';
  LinkSkillSystem.onSkillCardPlaced(g, 0, 'skill_link_shift');
  const turn0 = g.turn;
  EventBus.emit(GE.MOVE, { byVehicle: true, distance: 3, fromIdx: 6, toIdx: 2 });
  check(g.turn === turn0 + 1, `载具移动推进 1 回合（${turn0} → ${g.turn}）`);
  check(g.team.dailyDistanceMoved === 4, `移形今日移动距离累计 = ${g.team.dailyDistanceMoved}`);
  check((g.linkSkillQueue || []).some((e) => e.skillId === 'skill_link_shift' && e.key === '0|skill_link_shift'),
    '载具移动后移形（已放置实例）入队');
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
  // 连携技实例化：冷却按放置实例 `tileIdx|skillId`
  g.map.outerTiles[0].contentId = 'skill_link_yumo_drain';
  LinkSkillSystem.onSkillCardPlaced(g, 0, 'skill_link_yumo_drain');
  const key = '0|skill_link_yumo_drain';
  g.linkSkillCooldowns = { [key]: 3 };
  check(LinkSkillSystem.enqueue(g, { tileIdx: 0, skillId: 'skill_link_yumo_drain' }) === null, '连携技冷却中入队被阻挡');
  TurnSystem.advanceTurn(g, 0);
  check(g.linkSkillCooldowns[key] === 2, '连携冷却随回合推进 -1');
  DaySystem.startNewDay(g);
  check(g.linkSkillCooldowns[key] === 2, '连携冷却跨天不清零（§12.7）');
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

// ═══ 第 13 批 波 3：系统一般项与剩余轻微项验证 ═══
const { ITEMS } = await import('../src/data/items.js');
const { VehicleSystem } = await import('../src/systems/VehicleSystem.js');

const mkEnemy = (id, row, col, hp = 1000) => ({
  id, kind: 'slime_grass', name: '草史莱姆', category: 'danger',
  hp, maxHp: hp, activeBuffs: [], row, col, growth: 0, mood: 0,
});

console.log('\n═══ 27. 粘液 debuff 仅最终停留格结算（C-4 / §15） ═══');
{
  const g = createInitialState();
  // 移除枯木新枝（初始包含藏：移动后回血会干扰断言）
  g.inventory.items = g.inventory.items.filter((e) => e.itemId !== 'collectible_deadwood');
  // 左列滑行（3×3 外圈 8 格）：6((0,2)) → 7((0,1)) 冰 → 0((0,0)) 停
  g.map.outerTiles[7].contentId = null;
  g.map.outerTiles[0].contentId = null;
  g.map.outerTiles[7].terrain = 'terrain_ice';
  g.map.outerTiles[7].states = [{ type: 'slime' }];
  g.player.x = 6;
  g.player.stamina = 8;
  const hp0 = g.player.hp;
  const dest = move(g, 'up');
  check(dest === 0, `冰面滑行停在最终格 0（实际 ${dest}）`);
  check(g.map.outerTiles[7].states.some((s) => s.type === 'slime'), 'C-4：滑行经过的中间格粘液不被消耗');
  check(g.player.hp === hp0, 'C-4：中间格粘液不造成伤害');
  // 粘液在最终停留格 → 结算
  g.map.outerTiles[7].states = [];
  g.map.outerTiles[0].states = [{ type: 'slime' }];
  g.player.x = 6;
  const hp1 = g.player.hp;
  const st1 = g.player.stamina;
  const dest2 = move(g, 'up');
  check(dest2 === 0, `第二次滑行仍停在最终格 0（实际 ${dest2}）`);
  check(!g.map.outerTiles[0].states.some((s) => s.type === 'slime'), 'C-4：最终停留格粘液被消耗');
  check(g.player.hp === hp1 - 5 && g.player.stamina === st1 - 2,
    `C-4：最终格结算 hp -5 / stamina -1（含移动消耗，hp ${hp1} → ${g.player.hp}）`);
}

console.log('\n═══ 28. 拼命 2 目标 + 自损致死、风止 2 随机（B-9 / C-14） ═══');
{
  const g = createInitialState();
  check(SKILLS.skill_yumo_desperate.targetCount === 2 && SKILLS.skill_luyouyou_wind_stop.targetCount === 2,
    'B-9：拼命 / 风止配置 targetCount = 2');
  g.map.fence = [
    { row: 0, col: 0, creatures: ['t1'] },
    { row: 0, col: 1, creatures: ['t2'] },
  ];
  const t1 = mkEnemy('t1', 0, 0);
  const t2 = mkEnemy('t2', 0, 1);
  g.creatures = [t1, t2];
  g.map.outerTiles[1].contentId = 'skill_yumo_desperate';
  g.skillCooldowns = {};
  const hp0 = g.player.hp;
  SkillSystem.triggerSkillByHook('onEnter', { gs: g, tileIdx: 1 });
  check(t1.hp < 1000 && t2.hp < 1000, 'B-9：拼命对 2 个敌人造成伤害');
  check(g.player.hp < hp0, '拼命自损 8% 生效');
  // C-14：自损致死 → 涅槃冷却中 → 立即结算 §5.4 惩罚
  const g2 = createInitialState();
  g2.map.fence = [{ row: 0, col: 0, creatures: [] }];
  ensureSlime(g2);
  g2.map.outerTiles[0].contentId = 'skill_yumo_desperate';
  g2.skillCooldowns = {};
  g2.team.xiayangRebornCooldownDay = g2.day + 999; // 涅槃冷却中
  g2.player.hp = 1; // 自损 max(1, floor(1*8%)) = 1 → hp 0
  g2.player.gold = 100;
  g2.player.stamina = 5;
  SkillSystem.triggerSkillByHook('onEnter', { gs: g2, tileIdx: 0 });
  check(g2.player.hp === 1 && g2.player.stamina === 0 && g2.player.gold === 90,
    `C-14：拼命自损致死立即结算死亡惩罚（hp ${g2.player.hp} / stamina ${g2.player.stamina} / gold ${g2.player.gold}）`);
  // 风止：恰好 2 个随机目标，各挂虚弱
  const g3 = createInitialState();
  g3.map.fence = [
    { row: 0, col: 0, creatures: ['w1'] },
    { row: 0, col: 1, creatures: ['w2'] },
    { row: 1, col: 0, creatures: ['w3'] },
  ];
  const w1 = mkEnemy('w1', 0, 0);
  const w2 = mkEnemy('w2', 0, 1);
  const w3 = mkEnemy('w3', 1, 0);
  g3.creatures = [w1, w2, w3];
  g3.map.outerTiles[0].contentId = 'skill_luyouyou_wind_stop';
  g3.skillCooldowns = {};
  SkillSystem.triggerSkillByHook('onEnter', { gs: g3, tileIdx: 0 });
  const damaged = [w1, w2, w3].filter((c) => c.hp < 1000);
  check(damaged.length === 2, `B-9：风止恰好命中 2 个随机敌人（实际 ${damaged.length}）`);
  check(damaged.every((c) => c.activeBuffs.some((b) => b.id === 'weakened')), '风止对每个目标施加 25% 虚弱');
}

console.log('\n═══ 29. 弱点突破真实暴击、炽燃不额外挂燃烧（C-1 / C-3） ═══');
{
  const g = createInitialState();
  const origRandom = Math.random;
  // C-1：弱点突破 —— 暴击率 +100% 走真实判定（bonus 被 CombatSystem 消费）
  const t = mkEnemy('wp', 0, 0);
  t.activeBuffs.push({ id: 'charging', remainingTurns: 1, params: {} });
  g.creatures = [t];
  g.map.fence = [{ row: 0, col: 0, creatures: ['wp'] }];
  Math.random = () => 0.5; // 不闪避（≥0.05）、基础不暴（≥0.1），+100% 后 1.1 > 0.5 必暴
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_luyouyou_weak_point, {});
  Math.random = origRandom;
  check(g.team.luyouyouNextCritBonus === 0, 'C-1：暴击加成置位后被真实暴击判定消费');
  const weak = t.activeBuffs.find((b) => b.id === 'weakened');
  check(!!weak && weak.remainingTurns === 3, '弱点突破施加 3 回合 25% 虚弱');
  check(t.hp < 1000, '弱点突破伤害正常结算');
  // C-3：炽燃 —— 只伤害，不再额外施加/刷新燃烧
  const b1 = mkEnemy('sc', 0, 0);
  b1.activeBuffs.push({ id: 'burn', remainingTurns: 4, params: {} });
  g.creatures = [b1];
  g.map.fence = [{ row: 0, col: 0, creatures: ['sc'] }];
  Math.random = () => 0.5;
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_xiayang_scorch, {});
  Math.random = origRandom;
  const burns = b1.activeBuffs.filter((b) => b.id === 'burn');
  check(burns.length === 1 && burns[0].remainingTurns === 4, 'C-3：炽燃不再额外施加/刷新燃烧');
  check(b1.hp < 1000, '炽燃伤害正常结算');
}

console.log('\n═══ 30. 焚灭半径语义：tier1 同格 / tier2 含对角（C-2） ═══');
{
  const g = createInitialState();
  const a = mkEnemy('a', 0, 0); // 中心
  const b = mkEnemy('b', 0, 1); // 相邻
  const c = mkEnemy('c', 1, 1); // 对角
  const d = mkEnemy('d', 2, 0); // 距离 2
  g.creatures = [a, b, c, d];
  g.map.fence = [
    { row: 0, col: 0, creatures: ['a'] },
    { row: 0, col: 1, creatures: ['b'] },
    { row: 1, col: 1, creatures: ['c'] },
    { row: 2, col: 0, creatures: ['d'] },
  ];
  const origRandom = Math.random;
  Math.random = () => 0.5;
  g.team.groups[0].roles = ['yumo', 'xiayang', 'luyouyou'];
  g.map.outerTiles[0].contentId = 'skill_link_xiayang_annihilate';
  LinkSkillSystem.onSkillCardPlaced(g, 0, 'skill_link_xiayang_annihilate');
  const annKey = '0|skill_link_xiayang_annihilate';
  g.linkSkillCounters[annKey].count = 3;
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_xiayang_annihilate, { tier: 1, targetCreatureId: 'a', instanceKey: annKey });
  check(a.hp < 1000 && b.hp === 1000 && c.hp === 1000 && d.hp === 1000,
    'C-2：焚灭 tier1 半径 0.4 仅命中中心同格');
  check(g.linkSkillCounters[annKey].count === 0, '焚灭 tier1 消耗该实例 3 层计数');
  [a, b, c, d].forEach((x) => { x.hp = 1000; });
  g.linkSkillCounters[annKey].count = 7;
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_xiayang_annihilate, { tier: 2, targetCreatureId: 'a', instanceKey: annKey });
  Math.random = origRandom;
  check(a.hp < 1000 && b.hp < 1000 && c.hp < 1000 && d.hp === 1000,
    'C-2：焚灭 tier2 半径 1.5 命中同格+相邻+对角（距离 2 不中）');
}

console.log('\n═══ 31. 追猎弹射候选限当前目标同围栏格（C-2） ═══');
{
  const g = createInitialState();
  const a = mkEnemy('a', 0, 0);
  const b = mkEnemy('b', 0, 0);
  const c = mkEnemy('c', 0, 1);
  g.creatures = [a, b, c];
  g.map.fence = [
    { row: 0, col: 0, creatures: ['a', 'b'] },
    { row: 0, col: 1, creatures: ['c'] },
  ];
  const origRandom = Math.random;
  Math.random = () => 0.5;
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_luyouyou_hunt, { targetCreatureId: 'a' });
  Math.random = origRandom;
  check(c.hp === 1000, 'C-2：追猎弹射不命中其他围栏格的生物');
  check(a.hp < 1000 || b.hp < 1000, '追猎对同格候选造成伤害');
}

console.log('\n═══ 32. 风暴眼直线碰撞、第 4 元素即时入队（C-2 / C-10） ═══');
{
  const g = createInitialState();
  const a = mkEnemy('a', 0, 0); // 网格 (1,1)：在玩家 (1,0) → (1,1) 直线上
  g.creatures = [a];
  g.map.fence = [{ row: 0, col: 0, creatures: ['a'] }];
  g.player.x = 1; // (1,0)
  g.team.groups[0].roles = ['yumo', 'luyouyou'];
  g.map.outerTiles[0].contentId = 'skill_link_luyouyou_storm_eye';
  LinkSkillSystem.onSkillCardPlaced(g, 0, 'skill_link_luyouyou_storm_eye');
  const seKey = '0|skill_link_luyouyou_storm_eye';
  g.linkSkillCounters[seKey].elements = ['fire', 'water', 'grass', 'wind'];
  const origRandom = Math.random;
  Math.random = () => 0.5;
  LinkSkillSystem.resolveLinkSkill(g, SKILLS.skill_link_luyouyou_storm_eye, { instanceKey: seKey });
  Math.random = origRandom;
  check(a.hp < 1000, 'C-2：风暴眼对直线经过（线段距 ≤ 0.5）的敌人造成伤害');
  check(g.linkSkillCounters[seKey].elements.length === 0, '风暴眼结算后清空该实例的元素累计');
  // C-10：第 4 种元素经伤害路径记录（CombatSystem → ELEMENT_DAMAGE_APPLIED → onElementDamage，
  // 不经过 onSkillFired）→ 风暴眼立即入队
  const g2 = createInitialState();
  g2.team.groups[0].roles = ['yumo', 'luyouyou'];
  g2.map.outerTiles[0].contentId = 'skill_link_luyouyou_storm_eye';
  LinkSkillSystem.onSkillCardPlaced(g2, 0, 'skill_link_luyouyou_storm_eye');
  g2.linkSkillCounters['0|skill_link_luyouyou_storm_eye'].elements = ['fire', 'water', 'grass'];
  g2.team.dailyElementDamages = ['fire', 'water', 'grass']; // 天赋「何以为我」的独立每日列表
  g2.map.fence = [{ row: 0, col: 0, creatures: [] }];
  const t2 = ensureSlime(g2);
  const origR2 = Math.random;
  Math.random = () => 0.5;
  CombatSystem.calculateDamage({ atk: 10, defender: t2, element: 'ice', player: g2.player, gs: g2, roleId: 'xiayang', attackerRoleId: 'xiayang' });
  Math.random = origR2;
  check(g2.team.dailyElementDamages.length === 4, '伤害路径记录第 4 种元素');
  // 模拟 GameDirector 的 ELEMENT_DAMAGE_APPLIED 订阅转发
  LinkSkillSystem.onElementDamage(g2, { element: 'ice', byRoleId: 'xiayang', target: t2 });
  check((g2.linkSkillQueue || []).some((e) => e.key === '0|skill_link_luyouyou_storm_eye'),
    'C-10：第 4 元素非技能触发记录 → 风暴眼实例立即入队');
}

console.log('\n═══ 33. 何以为我元素加成仅对已记录元素（B-17） ═══');
{
  const g = createInitialState();
  // 何以为我是余默的天赋，默认编队 roles=['yumo'] 已生效
  const t = { kind: 'slime_grass', category: 'danger', hp: 1000, maxHp: 1000, activeBuffs: [] };
  const origRandom = Math.random;
  Math.random = () => 0.5;
  const r1 = CombatSystem.calculateDamage({ atk: 10, defender: t, element: 'fire', player: g.player, gs: g, roleId: 'yumo' });
  check(r1.finalDamage === 10, `B-17：新元素首次命中无加成（finalDamage = ${r1.finalDamage}）`);
  const r2 = CombatSystem.calculateDamage({ atk: 10, defender: t, element: 'fire', player: g.player, gs: g, roleId: 'yumo' });
  Math.random = origRandom;
  check(r2.finalDamage === 12, `B-17：已记录元素伤害 +20%（finalDamage = ${r2.finalDamage}）`);
}

console.log('\n═══ 34. 好奇心额外奖励 = 掉落再发一份、额外金币 = 售卖合计（B-18） ═══');
{
  const g = createInitialState();
  g.team.groups[0].roles = ['xiayang']; // 好奇心是夏漾的天赋（按编队 roles 生效）
  const meat0 = InventorySystem.countItem(g, 'item_raw_meat');
  const gold0 = g.player.gold;
  const origRandom = Math.random;
  Math.random = () => 0.1; // 30% 与 50% 均触发
  TalentSystem.onCreatureDefeated(g, { kind: 'chick', category: 'danger' });
  Math.random = origRandom;
  check(InventorySystem.countItem(g, 'item_raw_meat') === meat0 + 1,
    'B-18：30% 额外奖励 = 该生物掉落再发一份（小鸡 → 生肉 ×1）');
  const meatValue = ITEMS.item_raw_meat?.value ?? 0;
  check(g.player.gold === gold0 + meatValue, `B-18：50% 额外金币 = 掉落物售卖价值合计（+${meatValue}）`);
}

console.log('\n═══ 35. 涅槃攻击加成可追踪：99 天到期回收（B-15） ═══');
{
  const g = createInitialState();
  g.team.groups[0].roles = ['xiayang']; // 涅槃按编队 roles 生效
  g.player.hp = 0;
  const atk0 = g.player.atk;
  const saved = TalentSystem.onHPDeath(g, { roleId: 'xiayang' });
  const expectBonus = Math.floor(atk0 * 1.25) - atk0;
  check(saved && g.player.atk === atk0 + expectBonus, `涅槃：攻击力 +25%（${atk0} → ${g.player.atk}）`);
  check(g.team.rebornAtkBonus?.amount === expectBonus && g.team.rebornAtkBonus?.days === 99,
    'B-15：加成的数值与 99 天持续期被记录');
  g.team.rebornAtkBonus.days = 1; // 明天到期
  const atk1 = g.player.atk;
  DaySystem.startNewDay(g);
  check(g.player.atk === Math.max(1, atk1 - expectBonus), `B-15：到期回收加成（atk ${atk1} → ${g.player.atk}）`);
  check(g.team.rebornAtkBonus.days === 0 && g.team.rebornAtkBonus.amount === 0, 'B-15：回收后记录归零');
}

console.log('\n═══ 36. 状态持续时间上限 99（C-8） ═══');
{
  const target = { kind: 'slime_grass', hp: 100, maxHp: 100, activeBuffs: [] };
  CombatSystem.applyBuff({ buffId: 'burn', target, duration: 150 });
  const b = target.activeBuffs.find((x) => x.id === 'burn');
  check(b.remainingTurns === 99, `C-8：新建状态时长钳制 99（实际 ${b.remainingTurns}）`);
  CombatSystem.applyBuff({ buffId: 'burn', target, duration: 200 });
  check(b.remainingTurns === 99, `C-8：刷新合并也钳制 99（实际 ${b.remainingTurns}）`);
}

console.log('\n═══ 37. 载具模拟路径：中间格只判定，终点结算（B-21） ═══');
{
  // any 模式（心想事成，3×3 外圈 8 格）：6((0,2)) → 0((0,0)) 最短弧经过 7
  const g = createInitialState();
  VehicleSystem.gainVehicle(g, 'vehicle_chance');
  VehicleSystem.attachVehicle(g, g.vehicle.available[0].instanceId);
  const midTile = g.map.outerTiles[7];
  midTile.contentId = 'facility_strawberry';
  midTile.contentState = {};
  midTile.dailyFlags = {};
  const dstTile = g.map.outerTiles[0];
  dstTile.contentId = 'facility_strawberry';
  dstTile.contentState = {};
  dstTile.dailyFlags = {};
  g.player.x = 6;
  g.player.stamina = 8;
  const r = VehicleSystem.tryMove(g, { vehicleId: 'vehicle_chance', targetIdx: 0 });
  check(r.ok, `心想事成移动成功（${r.reason || 'ok'}）`);
  check(g.player.x === 0, '落点为目标格');
  check(r.path.length === 2 && r.path[0] === 7 && r.path[1] === 0, 'any 模式模拟路径 = [7,0]');
  check((midTile.contentState.strawberryStored || 0) === 0, 'B-21：中间格不结算地块效果');
  check((dstTile.contentState.strawberryStored || 0) === 1, 'B-21：终点结算【经过时】+1');
  // line 模式（扫帚）：6((0,2)) → 4((2,2)) 同行，中间格 5((1,2))
  const g2 = createInitialState();
  VehicleSystem.gainVehicle(g2, 'vehicle_broom');
  VehicleSystem.attachVehicle(g2, g2.vehicle.available[0].instanceId);
  const midTile2 = g2.map.outerTiles[5];
  midTile2.contentId = 'facility_strawberry';
  midTile2.contentState = {};
  midTile2.dailyFlags = {};
  const dstTile2 = g2.map.outerTiles[4];
  dstTile2.contentId = 'facility_strawberry';
  dstTile2.contentState = {};
  dstTile2.dailyFlags = {};
  g2.player.x = 6;
  g2.player.stamina = 8;
  const r2 = VehicleSystem.tryMove(g2, { vehicleId: 'vehicle_broom', targetIdx: 4 });
  check(r2.ok, `扫帚移动成功（${r2.reason || 'ok'}）`);
  check(r2.path.length === 2 && r2.path[0] === 5 && r2.path[1] === 4, 'line 模式模拟路径 = [5,4]');
  check((midTile2.contentState.strawberryStored || 0) === 0, 'B-21：line 中间格不结算地块效果');
  check((dstTile2.contentState.strawberryStored || 0) === 1, 'B-21：line 终点结算【经过时】+1');
}

console.log('\n═══ 38. 农耕手册保证抽到 3 个设施（C-15） ═══');
{
  const g = createInitialState();
  g.inventory.items = [];
  PassiveItemSystem.onItemGained(g, 'collectible_farm_guide');
  const facilityCount = g.inventory.items
    .filter((e) => e.itemId.startsWith('facility_') && e.itemId !== 'facility_wild_seed')
    .reduce((s, e) => s + e.qty, 0);
  check(facilityCount === 3, `C-15：农耕手册恰好发放 3 个设施（实际 ${facilityCount}）`);
}

console.log('\n═══ 39. 连携技实例化：必须放置 / 同名独立 / 拆除作废 / 离队回背包（§12.1 / §12.5） ═══');
{
  const { BuildSystem } = await import('../src/systems/BuildSystem.js');
  const ALL_ROLES = ['yumo', 'xiayang', 'luyouyou'];
  const placeSkill = (g, idx, skillId) => {
    g.map.outerTiles[idx].contentId = skillId;
    LinkSkillSystem.onSkillCardPlaced(g, idx, skillId);
  };
  const TRIGGERS = {
    skill_link_yumo_drain: (g) => LinkSkillSystem.onElementDamage(g, { element: 'fire', byRoleId: 'xiayang', target: null }),
    skill_link_xiayang_scorch: (g) => {
      g.creatures = [{ id: 'burn1', hp: 10, maxHp: 10, activeBuffs: [{ id: 'burn' }] }];
      LinkSkillSystem.periodicConditionScan(g);
    },
    skill_link_xiayang_annihilate: (g) => {
      for (let i = 0; i < 3; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_xiayang_x', target: null });
    },
    skill_link_luyouyou_weak_point: (g) => {
      g.creatures = [{ id: 'charge1', hp: 10, maxHp: 10, activeBuffs: [{ id: 'charge' }] }];
      LinkSkillSystem.periodicConditionScan(g);
    },
    skill_link_luyouyou_storm_eye: (g) => {
      for (const el of ['fire', 'water', 'grass', 'ice']) {
        LinkSkillSystem.onElementDamage(g, { element: el, byRoleId: 'yumo', target: null });
      }
    },
    skill_link_luyouyou_hunt: (g) => {
      for (let i = 0; i < 3; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'yumo', skillId: 'skill_x', target: null });
    },
    skill_link_luyouyou_rise_wind: (g) => LinkSkillSystem.onElementDamage(g, { element: 'fire', byRoleId: 'yumo', target: null }),
    skill_link_shift: (g) => LinkSkillSystem.onVehicleMoved(g, { distance: 1 }),
  };

  // 1) 未放置：条件达成但队列为空（7 个 + 移形各一条）
  for (const [skillId, fire] of Object.entries(TRIGGERS)) {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    fire(g);
    check((g.linkSkillQueue || []).length === 0, `未放置 → ${skillId} 不入队`);
  }

  // 2) 已放置：条件达成 → 入队（放置格任意外圈都成立；玩家不在该格）
  for (const [skillId, fire] of Object.entries(TRIGGERS)) {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    placeSkill(g, 2, skillId);
    g.player.x = 6;
    fire(g);
    check((g.linkSkillQueue || []).some((e) => e.key === `2|${skillId}`), `已放置 → ${skillId} 入队（格 2，玩家在 6）`);
  }

  // 3) 解锁条件未达成 → 不入队
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    placeSkill(g, 1, 'skill_link_xiayang_scorch');
    g.creatures = [{ id: 'plain', hp: 10, maxHp: 10, activeBuffs: [] }];
    LinkSkillSystem.periodicConditionScan(g);
    check(g.linkSkillQueue.length === 0, '已放置但未燃烧 → 炽燃不入队');
    placeSkill(g, 3, 'skill_link_yumo_drain');
    LinkSkillSystem.onSkillFired(g, { roleId: 'yumo', skillId: 'skill_xiayang_x', target: null });
    check(g.linkSkillQueue.length === 0, '已放置但无元素伤害 → 汲取不入队');
  }

  // 4) 两份同名：独立队列条目 / 独立冷却 / 独立计数
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    placeSkill(g, 0, 'skill_link_xiayang_scorch');
    placeSkill(g, 5, 'skill_link_xiayang_scorch');
    g.creatures = [{ id: 'burn2', hp: 10, maxHp: 10, activeBuffs: [{ id: 'burn' }] }];
    LinkSkillSystem.periodicConditionScan(g);
    const keys = g.linkSkillQueue.map((e) => e.key);
    check(keys.length === 2 && keys[0] === '0|skill_link_xiayang_scorch' && keys[1] === '5|skill_link_xiayang_scorch',
      `同名两份 → 两条独立队列条目（${keys.join(' / ')}）`);
    const r1 = LinkSkillSystem.fireLinkSkill(g, '0|skill_link_xiayang_scorch');
    check(r1.ok && g.linkSkillCooldowns['0|skill_link_xiayang_scorch'] > 0
      && !g.linkSkillCooldowns['5|skill_link_xiayang_scorch'],
      '同名两份 → 冷却只记在触发的那份实例');
    check(g.linkSkillQueue.length === 1 && g.linkSkillQueue[0].key === '5|skill_link_xiayang_scorch',
      '同名两份 → 另一份窗口仍在队列');
  }
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    placeSkill(g, 0, 'skill_link_xiayang_annihilate');
    placeSkill(g, 4, 'skill_link_xiayang_annihilate');
    for (let i = 0; i < 3; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_x', target: null });
    check(g.linkSkillCounters['0|skill_link_xiayang_annihilate'].count === 3
      && g.linkSkillCounters['4|skill_link_xiayang_annihilate'].count === 3,
      '同名两份焚灭 → 计数各自独立累计到 3');
    check(g.linkSkillQueue.length === 2, '同名两份焚灭 → 各自入队');
    LinkSkillSystem.fireLinkSkill(g, '0|skill_link_xiayang_annihilate');
    check(g.linkSkillCounters['0|skill_link_xiayang_annihilate'].count === 0
      && g.linkSkillCounters['4|skill_link_xiayang_annihilate'].count === 3,
      '焚灭结算只消耗该实例计数，另一份不受影响');
  }

  // 5) 拆除 → 计数清零、后续不入队、窗口作废
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    g.buildMode = true;
    g.inventory.items = [];
    placeSkill(g, 0, 'skill_link_xiayang_annihilate');
    for (let i = 0; i < 3; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_x', target: null });
    check(g.linkSkillQueue.length === 1 && g.linkSkillCounters['0|skill_link_xiayang_annihilate'].count === 3,
      '拆除前：焚灭已入队、计数 3');
    const rc = BuildSystem.clearContent(g, 0);
    check(rc.ok && g.map.outerTiles[0].contentId === null, '拆除成功（地块清空）');
    check(g.linkSkillQueue.length === 0 && !g.linkSkillCounters['0|skill_link_xiayang_annihilate'],
      '拆除 → 该实例计数清零、已入队窗口作废');
    for (let i = 0; i < 3; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_x', target: null });
    check(g.linkSkillQueue.length === 0, '拆除后条件再次达成也不入队');
  }

  // 6) 入队后 8 秒内拆卡 → 按 E 不结算
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    g.buildMode = true;
    g.inventory.items = [];
    placeSkill(g, 0, 'skill_link_yumo_drain');
    LinkSkillSystem.onElementDamage(g, { element: 'fire', byRoleId: 'xiayang', target: null });
    check(g.linkSkillQueue.length === 1, '汲取已入队');
    BuildSystem.clearContent(g, 0);
    check(g.linkSkillQueue.length === 0, '拆卡 → 队列条目立即清除');
    // 模拟「队列未清理的残留窗口」：强行塞回条目再按 E
    g.linkSkillQueue = [{ key: '0|skill_link_yumo_drain', skillId: 'skill_link_yumo_drain', tileIdx: 0, context: { element: 'fire' }, expireAtMs: Date.now() + 8000 }];
    const r = LinkSkillSystem.fireCurrentQueueTop(g);
    check(!r.ok && r.message === 'unplaced' && g.linkSkillQueue.length === 0 && !g.team.yumoNextElementOverride,
      '拆卡后 8 秒内按 E → 不结算（窗口作废）');
  }

  // 7) 角色离队 → 已放置技能自动回背包；不在编队不可放置
  {
    const g = createInitialState();
    g.team.groups[0].roles = ['yumo', 'xiayang'];
    placeSkill(g, 0, 'skill_link_xiayang_scorch');
    g.team.groups[0].roles = ['yumo'];
    const removed = BuildSystem.autoRemoveSkillsOutsideTeam(g);
    check(removed === 1 && g.map.outerTiles[0].contentId === null, '角色离队 → 该角色技能自动拆除');
    check(InventorySystem.countItem(g, 'skill_link_xiayang_scorch') === 1, '自动拆除 → 技能卡回到背包');

    const g2 = createInitialState();
    g2.team.groups[0].roles = ['yumo'];
    g2.inventory.items = [];
    InventorySystem.addItem(g2, 'skill_link_xiayang_scorch', 1);
    const rp = BuildSystem.placeContent(g2, 3, 'skill_link_xiayang_scorch');
    check(!rp.ok && rp.reason === 'roleNotInTeam', '角色不在编队 → 背包中的该技能无法放置');
    check(InventorySystem.countItem(g2, 'skill_link_xiayang_scorch') === 1, '拒绝放置后技能卡仍在背包');
  }

  // 8) 未放置时计数不累计；放置后从 0 起算（不会立刻弹窗）
  {
    const g = createInitialState();
    g.team.groups[0].roles = ALL_ROLES.slice();
    for (let i = 0; i < 5; i++) LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_x', target: null });
    check(g.linkSkillQueue.length === 0, '未放置 → 夏阳技能不累计焚灭计数（队列空）');
    placeSkill(g, 0, 'skill_link_xiayang_annihilate');
    check(g.linkSkillCounters['0|skill_link_xiayang_annihilate'].count === 0,
      '放置瞬间焚灭计数从 0 起算（不追溯历史）');
    check(g.linkSkillQueue.length === 0, '放置瞬间不弹窗');
    LinkSkillSystem.onSkillFired(g, { roleId: 'xiayang', skillId: 'skill_x', target: null });
    check(g.linkSkillCounters['0|skill_link_xiayang_annihilate'].count === 1
      && g.linkSkillQueue.length === 0,
      '放置后第 1 次才计数（1/3，不弹窗）');
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
