// src/core/GameEvents.js
// 所有 EventBus 事件名常量集中管理，禁止直接使用字符串字面量。
// 新增事件时请同步更新 architecture-spec.md §2.3。

export const GE = {
  // ── 生命周期 ──
  BOOT: 'boot',
  STATE_RESET: 'state:reset',

  // ── 玩家操作 ──
  MOVE: 'player:move',
  MOVE_BLOCKED: 'player:moveBlocked',
  SLEEP: 'player:sleep',
  BLESS: 'player:bless',
  BLESS_START: 'player:blessStart',   // Phase 2B 新增：抽奖动画开始（已扣消耗、已选候选）
  BLESS_DONE: 'player:blessDone',     // 动画结束、状态已挂、hook 已 fire

  // ── 回合 / 时间 ──
  TURN_ADVANCE: 'turn:advance',
  DAY_START: 'day:start',
  DAY_END: 'day:end',

  // ── 数值变化 ──
  STAMINA_CHANGE: 'stamina:change',
  HP_CHANGE: 'hp:change',
  GOLD_CHANGE: 'gold:change',
  ATK_CHANGE: 'atk:change',
  STAT_CHANGE: 'stat:change',

  // ── 地图 ──
  TILE_UPDATED: 'tile:updated',
  TILE_CLICKED: 'tile:clicked',
  TERRAIN_DEPLETED: 'terrain:depleted',

  // ── 背包 / 放置 ──
  INVENTORY_CHANGE: 'inventory:change',
  ITEM_GAINED: 'item:gained',
  ITEM_LOST: 'item:lost',
  PLACEMENT: 'placement',

  // ── 生物 ──
  CREATURE_SPAWNED: 'creature:spawned',
  CREATURE_DEFEATED: 'creature:defeated',
  CAPACITY_CHANGE: 'capacity:change',

  // ── 战斗 / 技能 ──
  SKILL_TRIGGERED: 'skill:triggered',
  DAMAGE_DEALT: 'damage:dealt',
  DAMAGE_TAKEN: 'damage:taken',
  ELEMENT_IMMUNE_HIT: 'element:immuneHit',   // Phase 3：元素免疫命中
  LINK_SKILL_READY: 'linkskill:ready',
  LINK_SKILL_EXPIRE: 'linkskill:expire',

  // ── Debuff / Buff ──
  BUFF_APPLIED: 'buff:applied',              // Phase 3
  BUFF_REMOVED: 'buff:removed',              // Phase 3

  // ── UI ──
  UI_PANEL_OPEN:  'ui:panel:open',
  UI_PANEL_CLOSE: 'ui:panel:close',
  UI_MODE_CHANGE: 'ui:mode:change',
  TOAST_SHOW:     'toast:show',
  HOTBAR_SELECT_SLOT: 'hotbar:selectSlot',

  // ── Phase 4 —— 角色 / 编队 / 合成 / 商店 / 载具 / 连携技 / 任务 ──
  DIALOG_SHOW:        'dialog:show',
  SHOP_OPEN:          'shop:open',
  SHOP_BUY:           'shop:buy',
  FORGE_COMPLETE:     'forge:complete',
  VEHICLE_ATTACH:     'vehicle:attach',
  CHARACTER_SELECTED: 'character:selected',
  TEAM_CHANGE:        'team:change',
  LINK_SKILL_QUEUE:   'linkSkill:queue',
  TASK_COMPLETE:      'task:complete',
  TASK_OPEN:          'task:open',

  // ── 存档 ──
  SAVE_DONE: 'save:done',
  LOAD_DONE: 'load:done',
};
