// 冒烟：放养生物每日草消耗上限 + 鸡舍/史莱姆屋开门/关门
//
// 覆盖：
//   1) 每只生物每日至多消耗 1 草元素量，达成后当天不再消耗；多只各算各的
//   2) 已投喂 / 饥饿 状态随消耗正确结算
//   3) 关门：归属生物 housed（不可见 / 不移动）、仍占容量、仍可查询
//   4) 开门：归属生物全部落在栅栏圆心合法区内、恢复渲染与移动
//   5) 野生生物（sourceTileIdx 为空）开关门前后位置与可见性均不变
//
// 用法：node tools/smoke-creature-door-grass.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import {
  spawnCreature,
  consumeGrassOnEnter,
  setFacilityDoorOpen,
  facilityOwnedCreatures,
  stepCreatures,
  advanceCreatureRendering,
  dailyTick,
} from '../src/systems/CreatureSystem.js';
import { fenceRect, creatureRadius, snapshotGeometry } from '../src/core/Geometry.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';
import { expandMap } from '../src/systems/MapExpandSystem.js';
import { moveStep } from '../src/systems/MovementSystem.js';
import { Random } from '../src/core/Random.js';
import { BUFFS } from '../src/data/buffs.js';
import { GLOSSARY } from '../src/data/items.js';
import { clearContent, placeContent } from '../src/systems/BuildSystem.js';
import { countByCategory, removeCreaturesOwnedByTile } from '../src/systems/CreatureSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}
const EPS = 1e-9;

function mkHenhouseState(facilityId = 'facility_henhouse') {
  const gs = createInitialState();
  gs.map.outerTiles[0].contentId = facilityId;
  gs.map.outerTiles[0].contentState = {};
  gs.map.fence[0].terrain = 'terrain_grass';
  gs.map.fence[0].terrainAmount = 10;
  return gs;
}

// ════════════════════════════════════════════════════════════
console.log('═══ 1. 每日草消耗：至多 1 元素量，达成即止 ═══');
const gs1 = mkHenhouseState();
const cell1 = gs1.map.fence[0];
gs1.capacity.friendly = 4;

const chick = spawnCreature(gs1, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const chicken = spawnCreature(gs1, 'chicken', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });

check(consumeGrassOnEnter(gs1, chick, cell1) === true, '小鸡首次经过草地 → 消耗 1 元素量');
check(cell1.terrainAmount === 9, `草地元素量 10 → 9（实际 ${cell1.terrainAmount}）`);
check(chick.grazedForFeed === true, '小鸡消耗草后达成当日【已投喂】条件');

check(consumeGrassOnEnter(gs1, chick, cell1) === false, '小鸡当天第二次经过草地 → 不再消耗');
check(cell1.terrainAmount === 9, `已达成，元素量保持 9（实际 ${cell1.terrainAmount}）`);

check(consumeGrassOnEnter(gs1, chicken, cell1) === true, '另一只鸡独立计算 → 消耗 1 元素量');
check(cell1.terrainAmount === 8, `元素量 9 → 8（实际 ${cell1.terrainAmount}）`);
check(consumeGrassOnEnter(gs1, chicken, cell1) === false, '同一只鸡当天第二次 → 不再消耗');
check(cell1.terrainAmount === 8, `保持 8（实际 ${cell1.terrainAmount}）`);

gs1.day += 1;
check(consumeGrassOnEnter(gs1, chick, cell1) === true, '跨天后额度重置 → 可再消耗 1 元素量');
check(cell1.terrainAmount === 7, `元素量 8 → 7（实际 ${cell1.terrainAmount}）`);
check(chick.grassFedDay === gs1.day, '按日号记账（grassFedDay = 当天）');

console.log('\n═══ 1b. 草耗尽 → 带索引的地形变化事件（UI 实时更新） ═══');
const gsEvent = mkHenhouseState();
gsEvent.map.fence[0].terrainAmount = 1;
const eater = spawnCreature(gsEvent, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
let terrainEvents = [];
EventBus.on(GE.TILE_TERRAIN_CHANGED, (payload) => terrainEvents.push(payload));
let fenceUpdatedEvents = 0;
EventBus.on(GE.FENCE_TILE_UPDATED, () => { fenceUpdatedEvents++; });
const depleted = consumeGrassOnEnter(gsEvent, eater, gsEvent.map.fence[0]);
check(depleted === true, '最后 1 元素量被消耗');
check(gsEvent.map.fence[0].terrain === 'terrain_none', '地块地形变为空地形 terrain_none');
check(terrainEvents.length === 1, `发出 1 次 TILE_TERRAIN_CHANGED（实际 ${terrainEvents.length}）`);
check(terrainEvents[0]?.fenceIdx === 0 && terrainEvents[0]?.row === 0 && terrainEvents[0]?.col === 0,
  `事件携带正确栅栏索引（fenceIdx=${terrainEvents[0]?.fenceIdx}, row=${terrainEvents[0]?.row}, col=${terrainEvents[0]?.col}）`);
check(fenceUpdatedEvents === 1, `同步发出 FENCE_TILE_UPDATED（实际 ${fenceUpdatedEvents}）`);

console.log('\n═══ 2. 已投喂 / 饥饿 状态结算 ═══');
const hungry = spawnCreature(gs1, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
dailyTick(gs1);
check(chick.lastFed === true, '前一日啃过草的小鸡 → 今日【已投喂】');
check(chicken.lastFed === true, '另一只啃过草的鸡 → 今日【已投喂】');
check(hungry.lastFed === false, '没吃到草且鸡舍无储存的小鸡 → 今日【饥饿】');
check(hungry.mood === -1, `饥饿心情 -1（实际 ${hungry.mood}）`);
const amountBeforeFedCheck = cell1.terrainAmount;
check(consumeGrassOnEnter(gs1, chick, cell1) === false, '日初已投喂的生物当天不再啃草');
check(cell1.terrainAmount === amountBeforeFedCheck, `元素量保持 ${amountBeforeFedCheck}`);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 3. 鸡舍关门 ═══');
const gs2 = mkHenhouseState();
const hA = spawnCreature(gs2, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const hB = spawnCreature(gs2, 'chicken', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const wild = spawnCreature(gs2, 'chick'); // 狩猎等来源：sourceTileIdx = null
const fenceCell = gs2.map.fence[0];
const friendlyBefore = gs2.capacity.friendly;
const wildPos0 = { x: wild.pos.x, y: wild.pos.y };

check(fenceCell.creatures.includes(hA.id) && fenceCell.creatures.includes(hB.id), '开门时归属生物在栅栏格缓存中');
const closed = setFacilityDoorOpen(gs2, 0, false);
check(closed.ok === true && closed.count === 2, `关门成功且收纳 2 只（实际 ${closed.count}）`);
check(hA.housed === true && hB.housed === true, '归属生物已收纳（housed=true，不可见）');
check(!fenceCell.creatures.includes(hA.id) && !fenceCell.creatures.includes(hB.id), '收纳后移出栅栏格缓存（不渲染）');
check(facilityOwnedCreatures(gs2, 0).length === 2, '归属关系不变 → 信息区仍可查询收纳生物');
check(gs2.creatures.length === 3, `容量按归属照常计算，生物总数不变（实际 ${gs2.creatures.length}）`);
check(gs2.capacity.friendly === friendlyBefore, `友善容量占用不变（${friendlyBefore}）`);

const snapClosed = snapshotGeometry(gs2);
check(!snapClosed.creatures.some(c => c.id === hA.id || c.id === hB.id), '空间快照排除收纳生物（不参与命中/查询）');

check(!wild.housed, '野生生物不被收纳');
check(wild.pos.x === wildPos0.x && wild.pos.y === wildPos0.y, '野生生物位置不因关门动作变化');

const posA0 = { x: hA.pos.x, y: hA.pos.y };
for (let i = 0; i < 100; i++) {
  stepCreatures(gs2, 0.2);
  advanceCreatureRendering(gs2, 0.05);
}
check(hA.pos.x === posA0.x && hA.pos.y === posA0.y, '关门期间收纳生物位置完全冻结（不参与移动）');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 4. 鸡舍开门：全部落在栅栏合法区 ═══');
const wildPos1 = { x: wild.pos.x, y: wild.pos.y };
const opened = setFacilityDoorOpen(gs2, 0, true);
check(opened.ok === true && opened.count === 2, `开门成功且放出 2 只（实际 ${opened.count}）`);
check(hA.housed === false && hB.housed === false, '放出后恢复渲染 / 移动');
check(fenceCell.creatures.includes(hA.id) && fenceCell.creatures.includes(hB.id), '主格缓存已重建，栅栏内可见');

const fRect = fenceRect(gs2);
for (const c of [hA, hB]) {
  const r = creatureRadius(c);
  const okX = c.pos.x >= fRect.x0 + r - EPS && c.pos.x <= fRect.x1 - r + EPS;
  const okY = c.pos.y >= fRect.y0 + r - EPS && c.pos.y <= fRect.y1 - r + EPS;
  check(okX && okY, `${c.kind} 落在栅栏圆心合法区内（${c.pos.x.toFixed(3)}, ${c.pos.y.toFixed(3)}）`);
}
check(gs2.capacity.friendly === friendlyBefore, '开门后容量占用仍不变');
check(gs2.creatures.length === 3, '开门不增删生物');

check(!wild.housed, '野生生物仍不被收纳');
check(wild.pos.x === wildPos1.x && wild.pos.y === wildPos1.y, '野生生物位置不因开门变化');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 5. 史莱姆屋同理（归属键与物种无关） ═══');
const gs3 = mkHenhouseState('facility_slimehouse');
const s1 = spawnCreature(gs3, 'slime_fire', { facilityId: 'facility_slimehouse', sourceTileIdx: 0 });
const s2 = spawnCreature(gs3, 'slime_water', { facilityId: 'facility_slimehouse', sourceTileIdx: 0 });
const sWild = spawnCreature(gs3, 'slime_thunder'); // 无归属
const sc = gs3.map.fence[0];
check(sc.creatures.includes(s1.id) && sc.creatures.includes(s2.id), '开门时史莱姆在栅栏格缓存中');
const closeSlime = setFacilityDoorOpen(gs3, 0, false);
check(closeSlime.ok === true && closeSlime.count === 2, `史莱姆屋关门收纳 2 只（实际 ${closeSlime.count}）`);
check(s1.housed === true && s2.housed === true, '归属史莱姆已收纳');
check(!sWild.housed, '无归属史莱姆不受开关门影响');
check(facilityOwnedCreatures(gs3, 0).length === 2, '史莱姆屋归属关系可按格查询');
const openSlime = setFacilityDoorOpen(gs3, 0, true);
check(openSlime.ok === true && s1.housed === false && s2.housed === false, '史莱姆屋开门正常放回');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 6. 非门禁设施不响应开关门 ═══');
const gs4 = createInitialState();
gs4.map.outerTiles[1].contentId = 'facility_wheat';
const notDoor = setFacilityDoorOpen(gs4, 1, false);
check(notDoor.ok === false && notDoor.reason === 'notDoorFacility', '麦田等设施不参与开关门');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 7. 史莱姆不吃草（仅草食生物可消耗草元素量） ═══');
const gsSlimeGrass = mkHenhouseState();
const slimeEater = spawnCreature(gsSlimeGrass, 'slime_water', { facilityId: 'facility_slimehouse', sourceTileIdx: 0 });
const grassCell = gsSlimeGrass.map.fence[0];
const amount0 = grassCell.terrainAmount;
check(consumeGrassOnEnter(gsSlimeGrass, slimeEater, grassCell) === false, '史莱姆经过草地不消耗草');
check(grassCell.terrainAmount === amount0, `草元素量保持 ${amount0}`);
check(slimeEater.grazedForFeed !== true, '史莱姆不会被标记为已投喂');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 8. 扩建后归属仍指向同一座设施 ═══');
const gsExp = createInitialState();
const henOld = gsExp.map.outerTiles[3]; // 右中，I 型（length）扩建会被右移
henOld.contentId = 'facility_henhouse';
henOld.contentState = {};
const expOwned = [
  spawnCreature(gsExp, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 3 }),
  spawnCreature(gsExp, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 3 }),
  spawnCreature(gsExp, 'chicken', { facilityId: 'facility_henhouse', sourceTileIdx: 3 }),
];
const expWild = spawnCreature(gsExp, 'chick'); // 狩猎来源：无归属
const oldUid = henOld.uid;

const r1 = expandMap(gsExp, 'length');
check(r1.ok, 'I 型（length）扩建成功');
const hen1 = gsExp.map.outerTiles.find(t => t.contentId === 'facility_henhouse');
check(!!hen1, '扩建后鸡舍仍存在');
check(hen1.uid === oldUid, `鸡舍实例 uid 不变（${oldUid}）`);
check(facilityOwnedCreatures(gsExp, hen1.idx).length === 3, '扩建后仍识别 3 只归属生物（未变野生）');
check(expOwned.every(c => Number.isInteger(c.sourceTileIdx) && c.sourceTileIdx === hen1.idx),
  '归属索引已重映射到新设施格 idx');
check(expWild.sourceTileUid === null && expWild.sourceTileIdx === null, '狩猎野生生物仍无归属');

const c1 = setFacilityDoorOpen(gsExp, hen1.idx, false);
check(c1.ok && c1.count === 3, `第一次扩建后关门收纳 3 只（实际 ${c1.count}）`);
check(expOwned.every(c => c.housed === true), '3 只归属生物全部收纳');
check(!expWild.housed, '野生生物不受关门影响');
const o1 = setFacilityDoorOpen(gsExp, hen1.idx, true);
check(o1.ok && o1.count === 3 && expOwned.every(c => !c.housed), '第一次扩建后开门放出 3 只');

const r2 = expandMap(gsExp, 'width');
check(r2.ok, 'II 型（width）连续扩建成功');
const hen2 = gsExp.map.outerTiles.find(t => t.contentId === 'facility_henhouse');
check(!!hen2 && hen2.uid === oldUid, '连续扩建后鸡舍仍是同一实例');
check(facilityOwnedCreatures(gsExp, hen2.idx).length === 3, '连续扩建后归属仍为 3 只');
const c2 = setFacilityDoorOpen(gsExp, hen2.idx, false);
check(c2.ok && c2.count === 3 && expOwned.every(c => c.housed), '连续扩建后关门仍收纳全部原归属');
const o2 = setFacilityDoorOpen(gsExp, hen2.idx, true);
check(o2.ok && o2.count === 3 && expOwned.every(c => !c.housed), '连续扩建后开门正常放出');
check(!expWild.housed && expWild.sourceTileUid === null, '两次扩建后野生生物仍不受影响');

// 旧存档（无 sourceTileUid）也要在扩建后被正确归属并升级
const gsLegacy = createInitialState();
const legacyHen = gsLegacy.map.outerTiles[3];
legacyHen.contentId = 'facility_henhouse';
legacyHen.contentState = {};
const legacy = spawnCreature(gsLegacy, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 3 });
delete legacy.sourceTileUid; // 模拟旧存档
expandMap(gsLegacy, 'length');
const legacyHen2 = gsLegacy.map.outerTiles.find(t => t.contentId === 'facility_henhouse');
check(facilityOwnedCreatures(gsLegacy, legacyHen2.idx).length === 1, '旧存档生物扩建后仍归属正确');
check(!!legacy.sourceTileUid, '旧存档生物已补稳定 uid');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 9. 粘液：不叠加 / 生效即移除 / 描述逐字一致 ═══');
const gsMucus = createInitialState();
gsMucus.map.outerTiles = [gsMucus.map.outerTiles[0]];
gsMucus.player.x = 99; // 唯一外圈格成为喷吐候选
spawnCreature(gsMucus, 'slime_fire');
const origChance = Random.chance;
Random.chance = () => true;
dailyTick(gsMucus);
dailyTick(gsMucus);
Random.chance = origChance;
check(gsMucus.map.outerTiles[0].states.filter(s => s.type === 'slime').length === 1,
  '重复施加粘液层数仍为 1');

const gsMucusMove = createInitialState();
const targetIdx = 5; // 玩家位于 idx 6，向右一格
gsMucusMove.map.outerTiles[targetIdx].states = [{ type: 'slime' }];
gsMucusMove.player.nextMoveNoStamina = true; // 隔离移动本身的 -1，只看粘液效果
const hpBefore = gsMucusMove.player.hp;
const staminaBefore = gsMucusMove.player.stamina;
const mv = moveStep(gsMucusMove, 'right');
check(mv.ok && gsMucusMove.player.x === targetIdx, '角色进入粘液格');
check(gsMucusMove.map.outerTiles[targetIdx].states.length === 0, '效果触发后粘液立即移除');
check(gsMucusMove.player.hp === hpBefore - 5, `生命 -5（${hpBefore} → ${gsMucusMove.player.hp}）`);
check(gsMucusMove.player.stamina === staminaBefore - 1, `行动力 -1（${staminaBefore} → ${gsMucusMove.player.stamina}）`);

const mucusTerm = GLOSSARY.find(g => g && g.term === '粘液');
check(!!mucusTerm?.meaning, '物品库「词条字典」存在粘液描述');
check(BUFFS.slime.description === mucusTerm?.meaning, '粘液描述与物品库逐字一致');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 10. 生物设施拆除：归属生物全部死亡移除、无掉落、容量实时下降 ═══');
const gsRem = mkHenhouseState();
gsRem.buildMode = true;
const deathEvents = [];
const capEvents = [];
EventBus.on(GE.CREATURE_DEFEATED, e => deathEvents.push(e));
EventBus.on(GE.CAPACITY_CHANGE, e => capEvents.push(e));
const remA = spawnCreature(gsRem, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const remB = spawnCreature(gsRem, 'chicken', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
setFacilityDoorOpen(gsRem, 0, false); // 关门：A/B 变为 housed
const remC = spawnCreature(gsRem, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 }); // 关门期间新生成 → 自动 housed
const remWild = spawnCreature(gsRem, 'chick'); // 无归属
const remFriendlyBefore = countByCategory(gsRem, 'friendly');
const remGoldBefore = gsRem.player.gold;
const remInvBefore = JSON.stringify(gsRem.inventory || {});
deathEvents.length = 0;
capEvents.length = 0;

const cleared = clearContent(gsRem, 0);
check(cleared.ok === true, '鸡舍拆除成功');
check(!gsRem.creatures.some(c => c.id === remA.id || c.id === remB.id || c.id === remC.id),
  '归属生物（含 housed）全部从 gs.creatures 移除');
check(gsRem.creatures.some(c => c.id === remWild.id) && !remWild.dead, '野生生物不受影响');
check(remFriendlyBefore - countByCategory(gsRem, 'friendly') === 3, '友善容量计数下降 3');
check(capEvents.some(e => e.category === 'friendly' && e.newCount === countByCategory(gsRem, 'friendly')),
  '拆除后发出 CAPACITY_CHANGE，容量条可实时刷新');
check(deathEvents.length === 3 && deathEvents.every(e => e.noReward === true),
  '3 只归属生物算作死亡且标记无奖励');
check(gsRem.player.gold === remGoldBefore, '拆除不产生金币收益');
check(JSON.stringify(gsRem.inventory || {}) === remInvBefore, '拆除不产生任何物品掉落');
check(!gsRem.map.fence[0].creatures.includes(remA.id), '栅栏格缓存已清理收纳/可见生物');
check(gsRem.map.outerTiles[0].contentId === null, '地块内容已清空');

deathEvents.length = 0;
capEvents.length = 0;
const clearedAgain = clearContent(gsRem, 0);
check(clearedAgain.ok === false && clearedAgain.reason === 'empty', '重复拆除幂等（空格返回 empty）');
check(deathEvents.length === 0 && capEvents.length === 0, '重复拆除不产生二次死亡/容量事件');

// 替换路径（UI 主要入口：有旧内容时先拆后放）
const gsRep = mkHenhouseState();
gsRep.buildMode = true;
const repA = spawnCreature(gsRep, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const repB = spawnCreature(gsRep, 'chick', { facilityId: 'facility_henhouse', sourceTileIdx: 0 });
const repWild = spawnCreature(gsRep, 'chick');
InventorySystem.addItem(gsRep, 'facility_slimehouse', 1);
const repPlaced = placeContent(gsRep, 0, 'facility_slimehouse');
check(repPlaced.ok === true, '用史莱姆屋替换旧鸡舍成功');
check(!gsRep.creatures.some(c => c.id === repA.id || c.id === repB.id), '替换时旧鸡舍归属生物一并死亡移除');
check(gsRep.creatures.some(c => c.id === repWild.id), '替换时野生生物不受影响');
check(gsRep.map.outerTiles[0].contentId === 'facility_slimehouse', '新设施已放置');

// 非生物类设施拆除：无归属生物 → 不触发任何生物死亡
const gsNon = createInitialState();
gsNon.buildMode = true;
gsNon.map.outerTiles[1].contentId = 'facility_wheat';
const nonA = spawnCreature(gsNon, 'chick'); // 野生
const noOp = removeCreaturesOwnedByTile(gsNon, gsNon.map.outerTiles[1]);
check(noOp.ok === false && noOp.removed.length === 0, '非生物设施拆除不产生生物死亡');
check(gsNon.creatures.some(c => c.id === nonA.id), '野生生物保持不变');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
