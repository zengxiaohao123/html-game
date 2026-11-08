// tools/smoke-save.mjs —— 天数存档（日初基线）冒烟测试
// 依据：《空间碰撞与时序方案》§11 / 设计文档 v0.5 §19
//
// 覆盖：
//   S1 唯一采集点：SleepSystem.sleep 末尾 capture 且位于全部结算之后；DaySystem 不再自动存档
//   S2 日初时点：换日 / 行动力恢复 / 心力交瘁移除 / 罚款落定后才采集
//   S3 无墙钟：payload 递归扫描键名 Ms$ / At$
//   S4 幂等：save → load → 立刻再 save，两份基线逐字节一致（除 savedAt）
//   S5 手动存档写日初基线（日内变化不进档）
//   S6 旧档迁移：日内计数器归零、墙钟丢弃、跨日地基保留
//   S7 payload 结构：schemaVersion / saveMode: 'dayStart' / meta
//   S8 文案：存档/读档各只留一句
//
// 用法：node tools/smoke-save.mjs

import { readFileSync } from 'node:fs';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { sleep } = await import('../src/systems/SleepSystem.js');
const { Storage } = await import('../src/state/storage.js');
const { DayBaseline } = await import('../src/state/DayBaseline.js');
const { migrateGS, normalizeToDayStart } = await import('../src/state/migrate.js');
const { VehicleSystem } = await import('../src/systems/VehicleSystem.js');
const { AUTOSAVE_SLOT } = await import('../src/utils/constants.js');

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');
const json = (v) => JSON.stringify(v);

registerFacilities();

const sleepSrc = readFileSync(new URL('../src/systems/SleepSystem.js', import.meta.url), 'utf8');
const daySrc = readFileSync(new URL('../src/systems/DaySystem.js', import.meta.url), 'utf8');
const storageSrc = readFileSync(new URL('../src/state/storage.js', import.meta.url), 'utf8');
const settingsSrc = readFileSync(new URL('../src/ui/SettingsPanel.js', import.meta.url), 'utf8');

head('S1 唯一采集点（静态）');
{
  check(sleepSrc.includes('DayBaseline.capture(gs)'), 'SleepSystem.sleep 内调用 DayBaseline.capture');
  check(sleepSrc.indexOf('DayBaseline.capture(gs)') > sleepSrc.indexOf('强制睡觉金币惩罚'),
    '采集点位于强制睡觉罚款之后');
  check(sleepSrc.indexOf('DayBaseline.capture(gs)') < sleepSrc.indexOf('EventBus.emit(GE.SLEEP'),
    '采集点在 SLEEP 事件 / 演出之前');
  check(!daySrc.includes('autoSave'), 'DaySystem 不再调用 autoSave');
  check(!daySrc.includes("from '../state/storage.js'"), 'DaySystem 不再依赖 storage');
  check(storageSrc.includes("saveMode: SAVE_MODE_DAY_START") && storageSrc.includes('schemaVersion: SAVE_SCHEMA_VERSION'),
    'storage payload 写入 schemaVersion / saveMode');
}

head('S2 日初时点：换日全部结算完成后采集');
{
  const gs = createInitialState();
  gs.player.x = 6;                 // 家
  gs.player.gold = 100;
  gs.player.stamina = -2;
  gs.activeBuffs.push({ id: 'exhausted', target: 'player', remainingTurns: 1, params: {} });
  const dayBefore = gs.day;

  const r = sleep(gs, /* isAuto = */ true);
  check(gs.day === dayBefore + 1, `换日 day ${dayBefore} → ${gs.day}`);
  check(gs.player.stamina === Math.floor(gs.player.maxStamina / 2), '心力交瘁：负数先归 0 再回一半（已恢复后的值入档）', gs.player.stamina);
  check(!gs.activeBuffs.some(b => b.id === 'exhausted'), '心力交瘁 buff 已移除');
  check(r.goldPenalty === 10 && gs.player.gold === 90, '强制睡觉罚款已落定（扣 10）', { penalty: r.goldPenalty, gold: gs.player.gold });

  const payload = Storage.readPayload(AUTOSAVE_SLOT);
  check(!!payload, 'slot 1 已写入自动档');
  check(payload.saveMode === 'dayStart', "payload.saveMode === 'dayStart'", payload.saveMode);
  check(payload.schemaVersion === 2, 'payload.schemaVersion === 2', payload.schemaVersion);
  check(payload.meta?.day === gs.day, 'payload.meta.day 与当前天一致', payload.meta);
  check(payload.gs.day === gs.day && payload.gs.turn === 0, '基线 day 正确且 turn 恒为 0', { day: payload.gs.day, turn: payload.gs.turn });
  check(payload.gs.player.stamina === gs.player.stamina, '基线记录的是恢复后的行动力', payload.gs.player.stamina);
  check(payload.gs.player.gold === gs.player.gold, '基线记录的是罚款后的金币', payload.gs.player.gold);
  check(!payload.gs.activeBuffs.some(b => b.id === 'exhausted'), '基线不含已移除的心力交瘁');
  check(payload.gs.pendingSleepStaminaBonus === 0, '睡眠结算中间量 pendingSleepStaminaBonus 已剥离');
  check(json(DayBaseline.getCurrent()) === json(payload.gs), 'DayBaseline.getCurrent 与 slot 1 基线一致');
}

head('S3 无墙钟（递归扫描 Ms$ / At$）');
{
  const payload = Storage.readPayload(AUTOSAVE_SLOT);
  const hits = DayBaseline.findWallClockKeys(payload.gs);
  check(hits.length === 0, '基线不含任何墙钟字段', hits);
  check(!json(payload.gs).includes('lastMoveTs'), 'lastMoveTs 未入档');
  check(!json(payload.gs).includes('expireAtMs'), 'expireAtMs 未入档');
  check(!json(payload.gs).includes('lastMoveAt'), 'uiState.lastMoveAt 未入档');
  check(!json(payload.gs).includes('"blessing"'), 'uiState.blessing 演出标记未入档');
  check(json(payload.gs.linkSkillQueue) === '[]' && json(payload.gs.linkSkillCounters) === '{}'
    && payload.gs.lastTurnLinkSkill === 0, '连携队列 / 计数 / 上回合标记已剥离');
}

head('S4 幂等：save → load → 立刻再 save');
{
  const baseline = DayBaseline.getCurrent();
  check(DayBaseline.assertIdempotent(baseline) === true, 'capture 对基线再采集逐字节一致');

  Storage.save(2, baseline);
  const first = Storage.readPayload(2);
  const loaded = Storage.load(2);
  const migrated = migrateGS(loaded);
  const second = DayBaseline.capture(migrated);
  check(json(first.gs) === json(second), '读档后 capture 与原基线逐字节一致');

  Storage.save(2, second); // 同一槽位立刻再存档
  const third = Storage.readPayload(2);
  check(json(second) === json(third.gs), '再存档落盘内容与读档前逐字节一致');
  check(json({ ...first, savedAt: 0 }) === json({ ...third, savedAt: 0 }),
    '完整 payload 除 savedAt 外逐字节一致');
  Storage.clearSlot(2);
}

head('S5 手动存档写日初基线（日内变化不进档）');
{
  const baseline = DayBaseline.getCurrent();
  const goldAtDayStart = baseline.player.gold;
  const staminaAtDayStart = baseline.player.stamina;
  const creaturesAtDayStart = baseline.creatures.length;

  // 日内：加钱、耗行动力、加生物、开连携窗口、移动冷却
  const gs = createInitialState();
  gs.player.gold = goldAtDayStart + 500;
  gs.player.stamina = 0;
  gs.creatures.push({
    id: 'creature_intraday', kind: 'slime_grass', row: 0, col: 0,
    pos: { x: 1.5, y: 1.5 }, dir: { x: 1, y: 0 }, renderPos: { x: 1.5, y: 1.5 },
    hp: 10, maxHp: 10, atk: 3, lastMoveTs: Date.now(),
  });
  gs.linkSkillQueue.push({ key: '0|skill_link_yumo_drain', skillId: 'skill_link_yumo_drain', expireAtMs: Date.now() + 8000 });
  gs.uiState.lastMoveAt = Date.now();
  gs.uiState.blessing = true;

  Storage.save(4, baseline);
  const payload = Storage.readPayload(4);
  check(payload.gs.player.gold === goldAtDayStart, '手动存档金币 = 日初值（日内 +500 未入档）', payload.gs.player.gold);
  check(payload.gs.player.stamina === staminaAtDayStart, '手动存档行动力 = 日初值（日内消耗未入档）', payload.gs.player.stamina);
  check(payload.gs.creatures.length === creaturesAtDayStart, '手动存档生物名册 = 日初名册', payload.gs.creatures.length);
  check(DayBaseline.findWallClockKeys(payload.gs).length === 0, '日内墙钟字段未混入手动存档');
  Storage.clearSlot(4);

  check(settingsSrc.includes('getBaseline'), 'SettingsPanel 手动存档走 director.getBaseline');
  check(!settingsSrc.includes('Storage.save(slot, gs)'), 'SettingsPanel 不再直接把实时 gs 写入槽位');
}

head('S6 旧档迁移（旧实时档 → 日初基线）');
{
  const oldGs = createInitialState();
  oldGs.turn = 5;
  oldGs.day = 9;
  oldGs.player.gold = 77;
  oldGs.player.hp = 55;
  oldGs.skillCooldowns = { skill_yumo_slash: 2 };
  oldGs.itemCooldowns = { item_potion: 4 };
  oldGs.linkSkillCooldowns = { '0|skill_link_yumo_drain': 3 };
  oldGs.linkSkillQueue = [
    { key: '0|skill_link_yumo_drain', skillId: 'skill_link_yumo_drain', tileIdx: 0, roleId: 'yumo', expireAtMs: Date.now() + 8000, context: { element: 'fire' } },
  ];
  oldGs.linkSkillCounters = { '0|skill_link_yumo_drain': { count: 2, elements: ['fire', 'water'] } };
  oldGs.lastTurnLinkSkill = 1;
  oldGs.uiState.blessing = true;
  oldGs.uiState.lastMoveAt = Date.now();
  oldGs.buildMode = true;
  oldGs.pendingSleepStaminaBonus = 3;
  oldGs.blessingQueue = [{}];
  oldGs.creatures = [{
    id: 'creature_old', kind: 'slime_grass', row: 0, col: 0,
    pos: { x: 1.5, y: 1.5 }, dir: { x: 0, y: 1 },
    hp: 5, maxHp: 20, atk: 3, growth: 2, lastMoveTs: Date.now(),
  }];
  const invCount = oldGs.inventory.items.length;
  const homeContent = oldGs.map.outerTiles[6].contentId;

  migrateGS(oldGs);
  check(typeof normalizeToDayStart === 'function', 'normalizeToDayStart 已导出');
  check(oldGs.turn === 0, '旧档日内回合号归零', oldGs.turn);
  check(json(oldGs.linkSkillQueue) === '[]', '连携窗口队列清空', oldGs.linkSkillQueue);
  check(json(oldGs.linkSkillCounters) === '{}', '连携日内计数归零', oldGs.linkSkillCounters);
  check(oldGs.lastTurnLinkSkill === 0, 'lastTurnLinkSkill 归零');
  check(oldGs.uiState.blessing === undefined && oldGs.uiState.lastMoveAt === undefined, '演出 / 墙钟界面态已丢弃', oldGs.uiState);
  check(oldGs.buildMode === false, '建造态清除');
  check(oldGs.pendingSleepStaminaBonus === 0, '睡眠结算中间量清除');
  check(json(oldGs.blessingQueue) === '[]', '废弃祝福队列清空');
  check(!oldGs.creatures[0].lastMoveTs, '生物墙钟 lastMoveTs 丢弃');
  check(DayBaseline.findWallClockKeys(oldGs).length === 0, '迁移后不含任何墙钟字段');

  // 跨日地基保留
  check(oldGs.player.hp === 55 && oldGs.player.gold === 77, '地基保留：HP / 金币', { hp: oldGs.player.hp, gold: oldGs.player.gold });
  check(oldGs.creatures.length === 1 && oldGs.creatures[0].hp === 5 && oldGs.creatures[0].growth === 2,
    '地基保留：生物名册 / 血量 / 成长');
  check(oldGs.creatures[0].pos.x === 1.5 && oldGs.creatures[0].pos.y === 1.5
    && typeof oldGs.creatures[0].dir === 'number',
    '地基保留：生物 pos / dir（dir 已按阶段 2 语义归一化为弧度）',
    { pos: oldGs.creatures[0].pos, dir: oldGs.creatures[0].dir });
  check(oldGs.map.outerTiles[6].contentId === homeContent, '地基保留：地块内容');
  check(oldGs.inventory.items.length === invCount, '地基保留：背包');
  check(oldGs.skillCooldowns.skill_yumo_slash === 2, '地基保留：剩余回合冷却（技能）', oldGs.skillCooldowns);
  check(oldGs.day === 9, '天数保留', oldGs.day);

  // 迁移后写盘带上版本号与模式标记
  Storage.save(5, DayBaseline.capture(oldGs));
  const p = Storage.readPayload(5);
  check(p.saveMode === 'dayStart' && p.schemaVersion === 2, '迁移后写回带 saveMode / schemaVersion', { mode: p.saveMode, v: p.schemaVersion });
  Storage.clearSlot(5);
}

head('S6b 旧档技能石换算为技能物品');
{
  const oldGs = createInitialState();
  oldGs.inventory.items = [
    { itemId: 'skill_stone_zongheng', qty: 2, value: 1 },
    { itemId: 'item_wheat', qty: 1, value: 2 },
  ];
  oldGs.inventory.outbox = [{ itemId: 'skill_stone_shift', qty: 1, value: 1 }];
  oldGs.hotbar = Array(10).fill(null);
  oldGs.hotbar[0] = { itemId: 'skill_stone_zongheng' };
  oldGs.map.outerTiles[2].contentId = 'resource_magic_shop';
  oldGs.map.outerTiles[2].contentState = {
    shop: {
      kind: 'magic',
      weekKey: '1-1',
      refreshUsed: 0,
      visited: false,
      freeRefreshPending: 0,
      leftAtTurn: -1,
      stock: [{ id: 'skill_stone_shift', name: '技能石：移形', emoji: '💠', price: 20, value: 1, rarity: 2, group: '技能石', sold: false }],
    },
  };

  migrateGS(oldGs);
  check(oldGs.inventory.items[0].itemId === 'skill_zongheng' && oldGs.inventory.items[0].qty === 2,
    '背包技能石 → 对应技能（数量保留）', oldGs.inventory.items[0]);
  check(oldGs.inventory.items[1].itemId === 'item_wheat', '非技能石条目不受影响');
  check(oldGs.inventory.outbox[0].itemId === 'skill_link_shift', '出货箱技能石 → 对应技能');
  check(oldGs.hotbar[0].itemId === 'skill_zongheng', '快捷栏技能石 → 对应技能');
  const slot = oldGs.map.outerTiles[2].contentState.shop.stock[0];
  check(slot.id === 'skill_link_shift' && slot.name === '移形' && slot.group === '技能',
    '商店库存技能石 → 技能商品（名称/分组同步）', slot);
  check(!/技能石|skill_stone/.test(json(oldGs)), '迁移后存档内无技能石残留');
}

head('S7 槽位机制（8 槽，1 号自动）');
{
  const slots = Storage.listSlots();
  check(slots.length === 8, '共 8 个槽位', slots.length);
  check(slots[0].slot === AUTOSAVE_SLOT && slots[0].used === true, '1 号位为自动存档且已写入');
  check(slots.filter(s => s.used).length === 1, '其余槽位保持空闲', slots.map(s => [s.slot, s.used]));
}

head('S8 UI 文案（各只留一句）');
{
  check(settingsSrc.includes('以本日开始时存档'), '存档提示为「以本日开始时存档」');
  check(settingsSrc.includes('读档将回到本日开始时'), '读档提示为「读档将回到本日开始时」');
  check(!/text:\s*['"][^'"]*当天[^'"]*(丢失|进度)/.test(settingsSrc)
    && !/text:\s*['"][^'"]*日初/.test(settingsSrc), '无当日进度损失解释、槽位无日初标注');
  check(!settingsSrc.includes('Slot ${slot} 存档成功'), '不再出现旧的存档成功提示');
}

head('S9 载具实例存档往返（同名两件独立保留）');
{
  const gs = createInitialState();
  VehicleSystem.gainVehicle(gs, 'vehicle_broom');
  VehicleSystem.gainVehicle(gs, 'vehicle_broom');
  VehicleSystem.gainVehicle(gs, 'vehicle_chance');
  gs.vehicle.available[0].usageLeft = 1; // 两件同名的次数不同，验证不会被合并/覆盖

  const idsBefore = gs.vehicle.available.map((v) => v.instanceId);
  const nextBefore = gs.vehicle.nextInstanceId;

  Storage.save(7, DayBaseline.capture(gs));
  const loaded = migrateGS(Storage.load(7));
  check(loaded.vehicle.available.length === 3, '读档后实例条数不变（同名不合并）', loaded.vehicle.available.length);
  check(json(loaded.vehicle.available.map((v) => v.instanceId)) === json(idsBefore),
    '读档后 instanceId 不变', loaded.vehicle.available.map((v) => v.instanceId));
  check(loaded.vehicle.available[0].usageLeft === 1 && loaded.vehicle.available[1].usageLeft === 2,
    '读档后两件同名各自剩余次数不变',
    [loaded.vehicle.available[0].usageLeft, loaded.vehicle.available[1].usageLeft]);
  check(loaded.vehicle.nextInstanceId === nextBefore, '读档后 nextInstanceId 保留', loaded.vehicle.nextInstanceId);

  // 无限次数（巧遇）：JSON 无 Infinity → null；载具系统读档后按定义补回
  check(loaded.vehicle.available[2].usageLeft === null,
    '（存档口径）Infinity 经 JSON 变为 null', loaded.vehicle.available[2].usageLeft);
  VehicleSystem.canVehicleReach(loaded, 1); // 触发 ensureVehicleState 归一化
  check(loaded.vehicle.available[2].usageLeft === Infinity, '载具系统读档后补回无限次数',
    loaded.vehicle.available[2].usageLeft);

  // 读档后继续获得同名载具：新实例 id 唯一、计数继续推进
  VehicleSystem.gainVehicle(loaded, 'vehicle_broom');
  const ids = loaded.vehicle.available.map((v) => v.instanceId);
  check(new Set(ids).size === ids.length, '读档后新增实例 id 不与已有冲突', ids);
  check(loaded.vehicle.nextInstanceId === nextBefore + 1, '新增实例推进自增计数', loaded.vehicle.nextInstanceId);

  Storage.clearSlot(7);
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail === 0 ? 0 : 1);
