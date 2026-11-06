// src/systems/MoveHooks.js
// 移动路径上的【经过时】/【进入时】统一结算（设计文档 v0.5 §7）：
//   - 经过 = 移动途经的每一格 + 最终停留格，不含起点；每格独立触发一次。
//   - 进入 = 仅最终停留格。
// 步行与载具共用本模块：徒步真实走过每一格；载具的效果层只在终点生效，
// 模拟路径的中间格仅参与判定与路径长度，不执行任何地块/状态效果。

import { HookDispatcher } from '../core/HookDispatcher.js';
import { SkillSystem } from './SkillSystem.js';

/**
 * 结算单格的【经过时】。
 * 载具的模拟路径中间格只参与判定/长度，不执行效果，因此载具仅对终点调用本函数。
 * @param {object} gs
 * @param {number} tileIdx
 */
export function firePassHookAt(gs, tileIdx) {
  if (tileIdx === null || tileIdx === undefined) return;
  HookDispatcher.fire('onPass', { gs, tileIdx });
  SkillSystem.triggerSkillByHook('onPass', { gs, tileIdx });
}

/**
 * 按顺序结算一条移动路径上的【经过时】。
 * 用于徒步：真实走过的每一格都结算（含冰面滑行经过的中间格）。
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
    firePassHookAt(gs, idx);
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
