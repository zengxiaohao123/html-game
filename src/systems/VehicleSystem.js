// src/systems/VehicleSystem.js
// Agent 3 —— 载具移动逻辑
// 设计文档 §14.7 + vehicles.js（vehicle_wheel / vehicle_broom / vehicle_chance 三种）
// 移动方式：
//   vehicle_wheel (directional) —— 指定方向最多 2 格，穿越非法但不能停留
//   vehicle_broom (line)         —— 同行列任意格（必须同行或同列），不能穿越非法
//   vehicle_chance (any)         —— 任意格（心想事成天赋专用，每天限 1 次，用后自动卸下）
//
// 载具不占背包，单独在载具页面（T 键）管理。
// 载具是独立实体：同名载具不是同一个东西，每件都有自己的 instanceId / 剩余次数，
// 永不按 vehicleId 合并、也不叠放（不放进背包，所以也不存在堆叠）。
// GS 里新增字段：
//   gs.vehicle = {
//     current: null | { instanceId, vehicleId, usageLeft },   // 当前装载的那一件
//     available: [{ instanceId, vehicleId, usageLeft }],      // 持有的每一件（不合并同名）
//     nextInstanceId: 1,                                      // 实例 id 自增计数（可存档、无时间戳）
//     chanceUsedToday: false,
//   }

import { syncBlueBreath } from './BlueBreathSystem.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { addGold } from './GoldSystem.js';
import { Random } from '../core/Random.js';
import { VEHICLES } from '../data/vehicles.js';
import { ITEMS } from '../data/items.js';
import { Direction } from '../utils/Direction.js';
import { firePassHookAt, fireEnterHooks } from './MoveHooks.js';
import { StaminaSystem } from './StaminaSystem.js';
import { canMoveNow, markMoved } from './MoveCooldown.js';
import {
  playerRef,
  setPlayerRef,
  getTile,
  refXY,
  refOfXY,
  neighborRef,
  isLegalStandRef,
  refsEqual,
  gridManhattan,
  legalStandRefs,
  tileRefKey,
  fenceIdxOf,
  isFenceRef,
} from '../core/TileAccess.js';

function ensureVehicleState(gs) {
  if (!gs.vehicle) {
    gs.vehicle = {
      current: null,          // { instanceId, vehicleId, usageLeft }
      available: [],          // 持有的每一件（不叠放、不按 vehicleId 合并）
      nextInstanceId: 1,      // 实例 id 自增计数
      chanceUsedToday: false, // 心想事成 巧遇 每天限 1 次
    };
  }
  const v = gs.vehicle;
  if (!Array.isArray(v.available)) v.available = [];
  // 实例 id 缺失时按现有实例推导，保证新分配的 id 不与已有实例冲突
  if (!Number.isInteger(v.nextInstanceId) || v.nextInstanceId < 1) {
    let max = 0;
    for (const e of [...v.available, v.current]) {
      if (Number.isInteger(e?.instanceId)) max = Math.max(max, e.instanceId);
    }
    v.nextInstanceId = max + 1;
  }
  // JSON 没有 Infinity：无限次数（巧遇）存档往返后会变成 null，读回时按载具定义补回
  for (const e of [...v.available, v.current]) {
    if (e && e.usageLeft == null) e.usageLeft = VEHICLES[e.vehicleId]?.usageCount ?? 1;
  }
}

/**
 * 载具移动完成后，按徒步跋涉方式模拟「起点 → 终点」的最短路径。
 * v0.6：合法路线 = 外圈格 + 生效小径格（用户裁定 16/17）。
 * 用 BFS 在网格上取最短路线（同一距离按 上→右→下→左 的稳定顺序），
 * 因此「沿外圈绕行」和「穿过小径」都会参与比较，取更短的一条。
 * 该路径只用于【经过时】判定与路径长度，不触发冰面滑行等地形位移效果。
 */
function simulateWalkPath(gs, fromRef, toRef) {
  const startKey = tileRefKey(fromRef);
  const goalKey = tileRefKey(toRef);
  if (startKey === null || goalKey === null) return [toRef];
  if (startKey === goalKey) return [toRef];

  const prev = new Map([[startKey, null]]);
  const queue = [fromRef];
  let found = false;
  while (queue.length > 0 && !found) {
    const cur = queue.shift();
    for (let d = 0; d < 4; d++) {
      const nxt = neighborRef(gs, cur, d);
      if (nxt === null || !isLegalStandRef(gs, nxt)) continue;
      const k = tileRefKey(nxt);
      if (k === null || prev.has(k)) continue;
      prev.set(k, cur);
      if (k === goalKey) { found = true; break; }
      queue.push(nxt);
    }
  }
  if (!found) return [toRef];

  const path = [];
  let curRef = toRef;
  while (curRef !== null && tileRefKey(curRef) !== startKey) {
    path.unshift(curRef);
    curRef = prev.get(tileRefKey(curRef));
  }
  return path;
}

/** 落点是否满足该载具的 landFilter（田块 / 设施 / 资源 / 技能 / 指定 contentId） */
export function landOk(gs, ref, def) {
  const filter = def?.landFilter;
  if (!filter) return true;
  const tile = getTile(gs, ref);
  if (!tile || !tile.contentId) return false;
  if (filter.contentIds) return filter.contentIds.includes(tile.contentId);
  if (filter.tier2) {
    const want = Array.isArray(filter.tier2) ? filter.tier2 : [filter.tier2];
    return want.includes(ITEMS[tile.contentId]?.tier2);
  }
  return true;
}

/** 当前载具所有合法落点（供 UI 高亮 / 随机传送用）；返回 ref 列表 */
export function listLandingTiles(gs) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return [];
  const fromRef = playerRef(gs);
  const out = [];
  for (const ref of legalStandRefs(gs)) {
    if (refsEqual(ref, fromRef)) continue;
    if (canVehicleReach(gs, ref).ok) out.push(ref);
  }
  return out;
}

/** 当前启用队伍的成员 */
function activeGroupRoles(gs) {
  const idx = gs?.team?.activeGroup ?? 0;
  return gs?.team?.groups?.[idx]?.roles || [];
}

/** 天赋限定载具的持有者是否在当前队伍中 */
function talentOwnerInTeam(gs, def) {
  if (!def?.talentRoleId) return true;
  return activeGroupRoles(gs).includes(def.talentRoleId);
}

/**
 * 天赋限定载具跟随其持有者（心想事成 → 巧遇）：
 * - 持有者在当前队伍：保证恰好持有 1 件（进队 / 读档 / 开局补发）
 * - 持有者离队：立即收回，正在装载的强制卸下
 * 由 GameDirector 在开局、读档、TEAM_CHANGE 后调用。
 */
export function syncTalentVehicles(gs) {
  ensureVehicleState(gs);
  const roles = activeGroupRoles(gs);
  for (const def of Object.values(VEHICLES)) {
    if (!def.talentExclusive || !def.talentRoleId) continue;
    const ownedCount = gs.vehicle.available.filter(a => a.vehicleId === def.id).length;
    const isCurrent = gs.vehicle.current?.vehicleId === def.id;
    if (roles.includes(def.talentRoleId)) {
      if (ownedCount === 0 && !isCurrent) gainVehicle(gs, def.id);
      continue;
    }
    // 离队：强制卸下 + 收回全部同名实例
    if (isCurrent) {
      const cur = gs.vehicle.current;
      gs.vehicle.current = null;
      EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: cur.vehicleId, instanceId: cur.instanceId, attached: false });
    }
    if (ownedCount > 0) {
      gs.vehicle.available = gs.vehicle.available.filter(a => a.vehicleId !== def.id);
      EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 已随天赋收回`, duration: 1500 });
    }
  }
}

/**
 * 玩家获得一个载具（巴士站 / 心想事成天赋 / 商店等）
 */
export function gainVehicle(gs, vehicleId) {
  const def = VEHICLES[vehicleId];
  if (!def) {
    devLog.warn('[VehicleSystem.gainVehicle] unknown', vehicleId);
    return;
  }
  ensureVehicleState(gs);
  // 每获得一件就是一个新实例：同名载具也是两个独立个体，不合并、不叠放
  const instanceId = gs.vehicle.nextInstanceId++;
  gs.vehicle.available.push({
    instanceId,
    vehicleId,
    usageLeft: def.usageCount ?? 1,
  });
  EventBus.emit(GE.VEHICLE_GAIN, { vehicleId, instanceId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 获得载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.gainVehicle]', vehicleId, 'instance', instanceId);
}

/**
 * 装备某一「件」载具（切到该实例；同时只能装一个）
 * @param {object} gs
 * @param {number} instanceId 载具实例 id（不是 vehicleId：同名载具各自独立）
 * @returns {boolean}
 */
export function attachVehicle(gs, instanceId) {
  ensureVehicleState(gs);
  if (!Number.isInteger(instanceId)) return false;
  const entry = gs.vehicle.available.find(a => a.instanceId === instanceId);
  if (!entry) return false;

  const def = VEHICLES[entry.vehicleId];
  if (!def) return false;

  // 天赋限定载具：持有者必须仍在当前队伍
  if (def.talentExclusive && !talentOwnerInTeam(gs, def)) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 需要天赋持有者在当前队伍`, duration: 1500 });
    return false;
  }
  // 每天限 1 次
  if (def.perDayLimit && gs.vehicle.chanceUsedToday) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 每天限用 1 次`, duration: 1500 });
    return false;
  }

  gs.vehicle.current = {
    instanceId: entry.instanceId,
    vehicleId: entry.vehicleId,
    usageLeft: entry.usageLeft,
  };
  EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: entry.vehicleId, instanceId, attached: true });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 装备载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.attachVehicle]', entry.vehicleId, 'instance', instanceId);
  return true;
}

/**
 * 卸下载具（用完了或主动切换）
 * 卸下后这一件回到持有列表，仍是同一个实例（instanceId 不变、次数保持）
 */
export function detachVehicle(gs) {
  ensureVehicleState(gs);
  if (gs.vehicle.current) {
    const cur = gs.vehicle.current;
    // 按实例同步回 available（同名载具不会串到别的实例）
    const avail = gs.vehicle.available.find(a => a.instanceId === cur.instanceId);
    if (avail) {
      avail.usageLeft = cur.usageLeft;
    }
    gs.vehicle.current = null;
    EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: cur.vehicleId, instanceId: cur.instanceId, attached: false });
    devLog.info('[VehicleSystem.detachVehicle]', 'instance', cur.instanceId);
  }
}

/**
 * 消费当前这一件载具的使用次数（用完自动卸下并从 available 移除该实例）
 */
function consumeUsage(gs) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return false;
  cur.usageLeft -= 1;

  const def = VEHICLES[cur.vehicleId];
  if (def.talentExclusive && def.perDayLimit) {
    gs.vehicle.chanceUsedToday = true;
    // 每日限次载具用后自动卸下：避免「仍装载但当日不允许」按整键拦截把方向键全锁死
    if (cur.usageLeft > 0) {
      const avail = gs.vehicle.available.find(a => a.instanceId === cur.instanceId);
      if (avail) avail.usageLeft = cur.usageLeft;
      gs.vehicle.current = null;
      EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: cur.vehicleId, instanceId: cur.instanceId, attached: false });
      EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 今日次数已用，已自动卸下`, duration: 1500 });
      devLog.info('[VehicleSystem.consumeUsage]', cur.vehicleId, 'perDayLimit → auto detach');
      return true;
    }
  }

  if (cur.usageLeft <= 0) {
    // 用完 —— 卸下并移除「这一件」（同名其它实例不受影响）
    const idx = gs.vehicle.available.findIndex(a => a.instanceId === cur.instanceId);
    if (idx >= 0) gs.vehicle.available.splice(idx, 1);
    gs.vehicle.current = null;
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 使用完毕`, duration: 1500 });
    devLog.info('[VehicleSystem.consumeUsage]', cur.vehicleId, 'instance', cur.instanceId, 'used up');
  } else {
    // 同步 available 中「这一件」的剩余次数
    const avail = gs.vehicle.available.find(a => a.instanceId === cur.instanceId);
    if (avail) avail.usageLeft = cur.usageLeft;
  }
  return true;
}

/** 判断两格是否同行或同列（网格坐标；小径格也参与） */
function sameRowOrCol(gs, aRef, bRef) {
  const a = refXY(gs, aRef);
  const b = refXY(gs, bRef);
  if (!a || !b) return false;
  return a.x === b.x || a.y === b.y;
}

/** 把 UI/旧调用传入的 targetIdx / targetRef 统一成 ref（非法返回 null） */
function normalizeTarget(gs, opts) {
  if (opts?.targetRef !== undefined && opts?.targetRef !== null) return opts.targetRef;
  if (opts?.targetIdx !== undefined && opts?.targetIdx !== null) return opts.targetIdx;
  return null;
}

/**
 * 载具尝试移动
 * @param {object} gs
 * @param {object} opts
 * @param {string} opts.type 'direction' | 'target' —— 方向式（轮子）或目标式（扫帚/巧遇）
 * @param {string} [opts.direction] 'up'|'right'|'down'|'left' —— 轮子用
 * @param {(number|object)} [opts.targetRef] —— 目标格 ref（外圈 idx / fence ref）
 * @returns {{ ok: boolean, path: any[] | null, finalIdx: number|null, finalRef: any, reason?: string }}
 */
export function tryMove(gs, opts = {}) {
  // §5.2：与 WASD /「前往」共用同一套 0.5 秒移动冷却（冷却期间直接忽略）
  if (!canMoveNow(gs)) return { ok: false, reason: 'cooldown' };

  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { ok: false, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { ok: false, reason: 'unknown' };

  // 天赋限定载具：持有者不在队 → 直接拒绝（配合 syncTalentVehicles 的双保险）
  if (def.talentExclusive && !talentOwnerInTeam(gs, def)) {
    return { ok: false, reason: 'talentUnavailable' };
  }
  // 每日限次载具：当日次数已用 → 拒绝，不消耗任何东西
  if (def.perDayLimit && gs.vehicle.chanceUsedToday) {
    return { ok: false, reason: 'perDayLimit' };
  }

  const fromRef = playerRef(gs);
  if (fromRef === null) return { ok: false, reason: 'badTarget' };
  const wantedRef = normalizeTarget(gs, opts);
  // 目标必须是合法落点（外圈格 / 生效小径格）
  if (wantedRef !== null && !isLegalStandRef(gs, wantedRef)) {
    return { ok: false, reason: 'badTarget' };
  }
  let targetRef = null;

  if (opts.wasdStep) {
    // WASD 走 1 格：落点就是调用方给定的相邻格（是否允许已由 canUseVehicleForStep 预判）
    if (wantedRef === null) return { ok: false, reason: 'needTarget' };
    if (refsEqual(wantedRef, fromRef)) return { ok: false, reason: 'sameTile' };
    if (def.movePattern === 'random') return { ok: false, reason: 'randomNoWASD' };
    targetRef = wantedRef;
  } else if (def.movePattern === 'directional') {
    // 轮子：指定方向最多 maxRange 格。穿越栅栏/虚空合法，只要求最终落点是合法地块。
    const dirIdx = Direction.dirToIndex(opts.direction);
    if (dirIdx === -1) return { ok: false, reason: 'badDirection' };

    const p = refXY(gs, fromRef);
    let cx = p.x;
    let cy = p.y;
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dirIdx];
    const maxRange = def.maxRange || 2;

    // 沿方向扫最远的合法落点（中间栅栏/虚空都穿越）
    let finalRef = null;
    for (let step = 1; step <= maxRange; step++) {
      cx += dx;
      cy += dy;
      const candidate = refOfXY(gs, cx, cy);
      if (candidate !== null && isLegalStandRef(gs, candidate)) finalRef = candidate;
    }

    if (finalRef === null) return { ok: false, reason: 'noValidLanding' };
    targetRef = finalRef;
  } else if (def.movePattern === 'line') {
    // 扫帚：同行或同列任意格
    if (wantedRef === null) return { ok: false, reason: 'needTarget' };
    if (refsEqual(wantedRef, fromRef)) return { ok: false, reason: 'sameTile' };
    if (!sameRowOrCol(gs, fromRef, wantedRef)) return { ok: false, reason: 'notSameRowCol' };
    targetRef = wantedRef;
  } else if (def.movePattern === 'any') {
    if (wantedRef === null) return { ok: false, reason: 'needTarget' };
    if (refsEqual(wantedRef, fromRef)) return { ok: false, reason: 'sameTile' };
    targetRef = wantedRef;
  } else if (def.movePattern === 'range') {
    if (wantedRef === null) return { ok: false, reason: 'needTarget' };
    if (refsEqual(wantedRef, fromRef)) return { ok: false, reason: 'sameTile' };
    if (gridManhattan(gs, fromRef, wantedRef) > (def.maxRange || 2)) {
      return { ok: false, reason: 'outOfRange' };
    }
    targetRef = wantedRef;
  } else if (def.movePattern === 'random') {
    // 随机一格（momo 图腾）：优先本日未进入过的地块
    const cands = listLandingTiles(gs);
    if (cands.length === 0) return { ok: false, reason: 'noLanding' };
    const visited = Array.isArray(gs.player?.visitedTodayRefs)
      ? new Set(gs.player.visitedTodayRefs)
      : null;
    const prefer = def.preferUnvisitedToday && visited
      ? cands.filter((r) => !visited.has(tileRefKey(r)))
      : [];
    const pool = prefer.length ? prefer : cands;
    targetRef = pool[Math.floor(Math.random() * pool.length)];
  } else {
    return { ok: false, reason: 'badPattern' };
  }

  const targetIdx = typeof targetRef === 'number' ? targetRef : null;
  // 无论哪种载具：位置先落到终点，再按徒步模拟「起点 → 终点」的最短路径
  const path = simulateWalkPath(gs, fromRef, targetRef);

  // 落点限制（设施 / 资源 / 技能 / 指定地块）
  if (!landOk(gs, targetRef, def)) return { ok: false, reason: 'landFilter' };

  // 消耗载具使用次数
  consumeUsage(gs);

  // 扣 stamina（芋圆 nextMoveNoStamina 也适用载具移动）
  if (gs.player.nextMoveNoStamina) {
    gs.player.nextMoveNoStamina = false;
  } else if (!def.freeStamina) {
    StaminaSystem.spendStaminaActive(gs, 1, { reason: 'vehicle_move' });
  }

  // 效果层只在终点生效
  firePassHookAt(gs, targetRef);

  // 更新位置
  setPlayerRef(gs, targetRef);
  syncBlueBreath(gs);

  // 到达后额外效果（拓荒者 +5 行动力；购物车 +4 金币）
  if (def.staminaGain) {
    StaminaSystem.gainStaminaFlat(gs, def.staminaGain, { reason: def.id });
    EventBus.emit(GE.TOAST_SHOW, { text: `${def.emoji} ${def.name} 行动力 +${def.staminaGain}`, duration: 1500 });
  }
  if (def.goldOnArrive) {
    addGold(gs, def.goldOnArrive, 'vehicle:arrive');
  }

  fireEnterHooks(gs, targetRef);

  const distance = Math.max(1, (path || []).length);
  EventBus.emit(GE.MOVE, {
    fromIdx: typeof fromRef === 'number' ? fromRef : null,
    toIdx: targetIdx,
    fromRef,
    toRef: targetRef,
    byVehicle: true,
    distance,
    path,
  });
  EventBus.emit(GE.TILE_UPDATED, {
    tileIdx: typeof fromRef === 'number' ? fromRef : null,
    tileRef: fromRef,
    fenceIdx: isFenceRef(fromRef) ? fenceIdxOf(gs, fromRef) : undefined,
  });
  EventBus.emit(GE.TILE_UPDATED, {
    tileIdx: targetIdx,
    tileRef: targetRef,
    fenceIdx: isFenceRef(targetRef) ? fenceIdxOf(gs, targetRef) : undefined,
  });

  devLog.info('[VehicleSystem.tryMove]', def.name, tileRefKey(fromRef), '→', tileRefKey(targetRef), 'path=', path.map(tileRefKey));
  markMoved(gs);

  return { ok: true, path, finalIdx: targetIdx, finalRef: targetRef };
}

/**
 * 外部调用：消耗 1 次载具使用（保留的显式 API，正常移动请走 tryMove 统一流程）
 */
export function useOnce(gs) {
  return consumeUsage(gs);
}

/**
 * WASD 走 1 格的载具判定结果（三态，禁止用同一个 falsy 混同「无载具」与「载具不允许」）：
 *   'noVehicle' —— 未装备载具 → 按徒步跋涉走
 *   'allowed'   —— 装备载具且该载具规则允许落到这 1 格 → 按使用载具结算
 *   'blocked'   —— 装备载具但该载具不允许这 1 格 → 直接阻止本次 WASD（不移动、无任何联动）
 */
export const VEHICLE_STEP_STATUS = {
  NO_VEHICLE: 'noVehicle',
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
};

/**
 * 判定「WASD 走 1 格」的载具语义。
 * @param {object} gs
 * @param {(number|object|null)} targetRef 相邻目标格（非法时为 null）
 */
export function canUseVehicleForStep(gs, targetRef) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { status: VEHICLE_STEP_STATUS.NO_VEHICLE, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { status: VEHICLE_STEP_STATUS.BLOCKED, reason: 'unknown' };
  // 随机型载具（momo 图腾）的落点由系统自选，不接受 WASD 指定目标
  if (def.movePattern === 'random') {
    return { status: VEHICLE_STEP_STATUS.BLOCKED, reason: 'randomNoWASD', def };
  }
  if (targetRef === null || targetRef === undefined) {
    return { status: VEHICLE_STEP_STATUS.BLOCKED, reason: 'badTarget', def };
  }

  const reach = canVehicleReach(gs, targetRef);
  if (reach.ok) return { status: VEHICLE_STEP_STATUS.ALLOWED, def };
  return { status: VEHICLE_STEP_STATUS.BLOCKED, reason: reach.reason, def };
}

/**
 * 判断当前装备的载具能否到达目标格（ref：外圈 idx / 生效小径格）
 * @returns {{ ok: boolean, reason?: string, def?: object }}
 */
export function canVehicleReach(gs, targetRef) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { ok: false, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { ok: false, reason: 'unknown' };

  if (def.talentExclusive && !talentOwnerInTeam(gs, def)) return { ok: false, reason: 'talentUnavailable' };
  if (def.perDayLimit && gs.vehicle.chanceUsedToday) return { ok: false, reason: 'perDayLimit' };

  const fromRef = playerRef(gs);
  if (fromRef === null) return { ok: false, reason: 'badTarget' };
  if (!isLegalStandRef(gs, targetRef)) return { ok: false, reason: 'badTarget' };
  if (refsEqual(targetRef, fromRef)) return { ok: false, reason: 'sameTile' };

  if (def.movePattern === 'directional') {
    // 轮子：同方向最多 maxRange 格。穿越栅栏/虚空合法，只要落点是合法地块。
    const p = refXY(gs, fromRef);
    const q = refXY(gs, targetRef);
    if (!p || !q) return { ok: false, reason: 'badTarget' };
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (dx !== 0 && dy !== 0) return { ok: false, reason: 'notAligned' };
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 0 || dist > (def.maxRange || 2)) return { ok: false, reason: 'outOfRange' };
    if (!landOk(gs, targetRef, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'line') {
    if (!sameRowOrCol(gs, fromRef, targetRef)) return { ok: false, reason: 'notSameRowCol' };
    if (!landOk(gs, targetRef, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'range') {
    if (gridManhattan(gs, fromRef, targetRef) > (def.maxRange || 2)) {
      return { ok: false, reason: 'outOfRange' };
    }
    if (!landOk(gs, targetRef, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'any' || def.movePattern === 'random') {
    if (!landOk(gs, targetRef, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  return { ok: false, reason: 'badPattern' };
}

/**
 * 每日开始时重置载具的 perDayLimit 标记
 */
export function onDayStart(gs) {
  ensureVehicleState(gs);
  gs.vehicle.chanceUsedToday = false;
}

export const VehicleSystem = {
  gainVehicle,
  syncTalentVehicles,
  attachVehicle,
  detachVehicle,
  tryMove,
  useOnce,
  canVehicleReach,
  canUseVehicleForStep,
  VEHICLE_STEP_STATUS,
  onDayStart,
};
