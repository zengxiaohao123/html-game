// src/systems/MovementSystem.js
// 移动系统：WASD 驱动，外圈 8 格回字形地图
// 核心约定：
//   1. Direction → Distance 邻居映射：dirToIndex(direction) → outerNeighbors 返回数组下标
//   2. 不可移动时返回 null，不扣 stamina、不触发 hook、不更新 GS
//
// Phase 3 扩展：
//   - onPass / onEnter HookDispatcher.fire 之后，再调 SkillSystem.triggerSkillByHook
//     （让角色技能自动攻击栅栏内的危险生物）
//   - 额外：粘液 debuff 检查（若 tile 有粘液 state → hp -5 stamina -1 然后移除）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Distance } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { devLog } from '../core/Logger.js';
import { SkillSystem } from './SkillSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { VehicleSystem } from './VehicleSystem.js';

/**
 * 尝试移动玩家
 * @param {object} gs 全局状态（会被直接修改）
 * @param {string} direction 'up' | 'right' | 'down' | 'left'
 * @returns {number|null} 移动成功返回目标格 idx，失败返回 null
 */
export function move(gs, direction) {
  const dirIdx = Direction.dirToIndex(direction);
  if (dirIdx === -1) {
    devLog.warn('[MovementSystem] 非法方向:', direction);
    return null;
  }

  // === 装备载具时：严格走载具规则 ===
  // WASD 只是方向式载具的快捷键，等价于"点击方向上可达格 → 前往"
  // 若方向上找不到合法落点（极端特殊载具），WASD 也会失败
  if (gs.vehicle?.current) {
    const vehResult = VehicleSystem.tryMove(gs, { type: 'direction', direction });
    if (!vehResult.ok) {
      devLog.info('[MovementSystem] 载具方向', direction, '无合法落点:', vehResult.reason);
      EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: gs.player.x });
      return null;
    }

    // 载具移动后的附加逻辑：粘液 debuff（目标格）+ 蹁跹天赋
    const targetIdx = vehResult.finalIdx;
    const targetTile = gs.map.outerTiles[targetIdx];
    if (targetTile && Array.isArray(targetTile.states)) {
      const slimeStateIdx = targetTile.states.findIndex(s => s.type === 'slime');
      if (slimeStateIdx >= 0) {
        CombatSystem.applyTrueDamageToPlayer(gs.player, 5, { reason: 'slime_hit_by_vehicle' });
        gs.player.stamina -= 1;
        EventBus.emit(GE.STAMINA_CHANGE, {
          newValue: gs.player.stamina, delta: -1, maxStamina: gs.player.maxStamina,
        });
        targetTile.states.splice(slimeStateIdx, 1);
        EventBus.emit(GE.TOAST_SHOW, { text: '🟢 粘液：hp -5 stamina -1', duration: 1500 });
        devLog.info('[MovementSystem] slime state triggered (vehicle) → removed');
      }
    }
    TalentSystem.onMoveEnd(gs);

    return targetIdx;
  }

  const neighbors = Distance.outerNeighbors(gs.map.size, gs.player.x);
  const targetIdx = neighbors[dirIdx];

  // 栅栏中心 / 不可通行：返回 null，不扣 stamina、不触发 hook
  if (targetIdx === null || targetIdx === undefined) {
    devLog.info('[MovementSystem] 方向', direction, '不可通行, neighbors:', neighbors);
    EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: gs.player.x });
    return null;
  }

  // === 可行走：执行移动 ===
  const fromIdx = gs.player.x;

  // 1. 扣 stamina（芋圆 nextMoveNoStamina = true 时免行动力消耗 —— 设计文档 §12.2）
  const isFreeMove = !!gs.player.nextMoveNoStamina;
  if (isFreeMove) {
    gs.player.nextMoveNoStamina = false; // 用掉即清，不可叠加
    devLog.info('[MovementSystem] 芋圆免行动力触发，本次移动不扣 stamina');
  } else {
    gs.player.stamina -= 1;
    EventBus.emit(GE.STAMINA_CHANGE, {
      newValue: gs.player.stamina,
      delta: -1,
      maxStamina: gs.player.maxStamina,
    });
  }

  // 2. 触发 onPass：仅目标格（起点不算经过 —— 设计文档 §7）
  HookDispatcher.fire('onPass', { gs, tileIdx: targetIdx });

  // Phase 3：技能 onPass 触发
  SkillSystem.triggerSkillByHook('onPass', { gs, tileIdx: targetIdx });

  // 3. 更新玩家位置
  gs.player.x = targetIdx;

  // 4. 粘液 debuff 检查（tile.states 里 type==='slime'）
  const targetTile = gs.map.outerTiles[targetIdx];
  if (targetTile && Array.isArray(targetTile.states)) {
    const slimeStateIdx = targetTile.states.findIndex(s => s.type === 'slime');
    if (slimeStateIdx >= 0) {
      CombatSystem.applyTrueDamageToPlayer(gs.player, 5, { reason: 'slime_hit' });
      gs.player.stamina -= 1;
      EventBus.emit(GE.STAMINA_CHANGE, {
        newValue: gs.player.stamina, delta: -1, maxStamina: gs.player.maxStamina,
      });
      targetTile.states.splice(slimeStateIdx, 1);
      EventBus.emit(GE.TOAST_SHOW, { text: '🟢 粘液：hp -5 stamina -1', duration: 1500 });
      devLog.info('[MovementSystem] slime state triggered → removed');
    }
  }

  // 5. 触发 onEnter：最终停留的目标格
  HookDispatcher.fire('onEnter', { gs, tileIdx: targetIdx });

  // Phase 3：技能 onEnter 触发（这是核心触发入口）
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: targetIdx });

  // 6. 广播 MOVE 事件
  EventBus.emit(GE.MOVE, { fromIdx, toIdx: targetIdx, direction });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  // 7. Agent 3：天赋 蹁跹 onMoveEnd（+6HP）
  TalentSystem.onMoveEnd(gs);

  devLog.info('[MovementSystem] 移动成功:', fromIdx, '→', targetIdx, direction);
  return targetIdx;
}

export const MovementSystem = {
  move,
};
