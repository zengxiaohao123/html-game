// src/systems/MoveHooks.js
// 移动路径上的【经过时】/【进入时】统一结算（设计文档 v0.5 §7 / v0.6 §9.6）：
//   - 经过 = 移动途经的每一格 + 最终停留格，不含起点；每格独立触发一次。
//   - 进入 = 仅最终停留格。
// 步行与载具共用本模块：徒步真实走过每一格；载具的效果层只在终点生效，
// 模拟路径的中间格仅参与判定与路径长度，不执行任何地块/状态效果。
//
// v0.6：地块引用改为 ref（外圈 idx 或 fence ref）。生效小径格上的内容
// 与外圈格一样触发【经过时】【进入时】（用户裁定 16）。

import { HookDispatcher } from '../core/HookDispatcher.js';
import { SkillSystem } from './SkillSystem.js';
import { fenceIdxOf, tileRefKey, isFenceRef } from '../core/TileAccess.js';

function toPayload(gs, ref) {
  if (isFenceRef(ref)) {
    return { tileIdx: null, tileRef: ref, fenceIdx: fenceIdxOf(gs, ref) };
  }
  return { tileIdx: ref, tileRef: ref };
}

/**
 * 结算单格的【经过时】。
 * @param {object} gs
 * @param {(number|object)} ref
 */
export function firePassHookAt(gs, ref) {
  if (ref === null || ref === undefined) return;
  const payload = toPayload(gs, ref);
  HookDispatcher.fire('onPass', { gs, ...payload });
  SkillSystem.triggerSkillByHook('onPass', { gs, ...payload });
}

/**
 * 按顺序结算一条移动路径上的【经过时】。
 * @param {object} gs
 * @param {Array<(number|object|null)>} path 不含起点的地块序列
 */
export function firePassHooksAlong(gs, path) {
  const seen = new Set();
  for (const ref of path || []) {
    if (ref === null || ref === undefined) continue;
    const key = tileRefKey(ref);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    firePassHookAt(gs, ref);
  }
}

/**
 * 结算最终停留格的【进入时】。
 * @param {object} gs
 * @param {(number|object)} finalRef
 */
export function fireEnterHooks(gs, finalRef) {
  if (finalRef === null || finalRef === undefined) return;
  const payload = toPayload(gs, finalRef);
  HookDispatcher.fire('onEnter', { gs, ...payload });
  SkillSystem.triggerSkillByHook('onEnter', { gs, ...payload });
}
