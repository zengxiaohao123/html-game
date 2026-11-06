// src/systems/MoveHooks.js
// 移动路径上的【经过时】/【进入时】统一结算（设计文档 v0.5 §7）：
//   - 经过 = 移动途经的每一格 + 最终停留格，不含起点；每格独立触发一次。
//   - 进入 = 仅最终停留格。
// 步行（MovementSystem）与载具（VehicleSystem）共用本模块，
// 避免两套结算逻辑分叉导致载具漏触发/顺序错乱。

import { HookDispatcher } from '../core/HookDispatcher.js';
import { SkillSystem } from './SkillSystem.js';

/**
 * 按顺序结算一条移动路径上的【经过时】。
 * 跳过 null（载具穿越的栅栏中心/虚空），同一格只触发一次。
 * @param {object} gs
 * @param {(number|null)[]} path 不含起点的格子序列
 */
export function firePassHooksAlong(gs, path) {
  const seen = new Set();
  for (const idx of path || []) {
    if (idx === null || idx === undefined) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    HookDispatcher.fire('onPass', { gs, tileIdx: idx });
    SkillSystem.triggerSkillByHook('onPass', { gs, tileIdx: idx });
  }
}

/**
 * 结算最终停留格的【进入时】。
 * @param {object} gs
 * @param {number} finalIdx
 */
export function fireEnterHooks(gs, finalIdx) {
  if (finalIdx === null || finalIdx === undefined) return;
  HookDispatcher.fire('onEnter', { gs, tileIdx: finalIdx });
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: finalIdx });
}
