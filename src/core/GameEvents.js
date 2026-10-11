/**
 * core/GameEvents.js —— 全局事件名常量
 * 系统间通信用这些符号，禁止散落魔法字符串。
 */
export const GE = Object.freeze({
  // 顶层状态机
  STATE_CHANGE: 'state:change',          // { from, to }

  // 探索
  EXPLORE_MOVE: 'explore:move',          // { from, to, cost }
  EXPLORE_TILE_CLICK: 'explore:tileClick',
  EXPLORE_NEW_DAY: 'explore:newDay',     // { day }
  EXPLORE_AP_CHANGE: 'explore:apChange',
  EXPLORE_CONTENT: 'explore:content',    // 地块 content 触发
  BUILD_TILE: 'build:tile',
  BUILD_FACILITY: 'build:facility',
  EXPLORE_LOG: 'explore:log',            // 行动记录区文本

  // 战斗
  BATTLE_START: 'battle:start',
  BATTLE_END: 'battle:end',              // { result }
  BATTLE_ROUND: 'battle:round',
  BATTLE_UNIT_TURN: 'battle:unitTurn',
  BATTLE_DAMAGE: 'battle:damage',
  BATTLE_HEAL: 'battle:heal',
  BATTLE_SHIELD: 'battle:shield',
  BATTLE_AURA: 'battle:aura',            // 附着变化
  BATTLE_REACTION: 'battle:reaction',    // 元素反应
  BATTLE_SKILL: 'battle:skill',
  BATTLE_CHAIN_PROMPT: 'battle:chainPrompt',
  BATTLE_INTENT: 'battle:intent',
  BATTLE_LOG: 'battle:log',

  // 背包 / 资源
  INV_CHANGE: 'inv:change',
  GOLD_CHANGE: 'gold:change',
  HEALTH_CHANGE: 'health:change',
  ITEM_TOAST: 'item:toast',

  // 角色 / 编队
  PARTY_CHANGE: 'party:change',
  XP_GAIN: 'hero:xp',
  HERO_LEVELUP: 'hero:levelup',
  AFFINITY_CHANGE: 'affinity:change',

  // 时间/全局
  MENTAL_CHANGE: 'mental:change',

  // UI
  UI_PANEL_OPEN: 'ui:panelOpen',
  UI_TOAST: 'ui:toast',
  UI_FX: 'ui:fx',
});
