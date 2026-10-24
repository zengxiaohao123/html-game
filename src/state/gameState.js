// src/state/gameState.js
// 全局状态（单一真相源）—— GS 对象 schema
// 完整结构定义见 architecture-spec.md §3
//
// 不可变更新约定：
//   所有系统修改 GS 前先 EventBus.emit(GE.XXX_CHANGE, payload)，再直接改 GS 属性。
//   UI 层只订阅事件刷新 DOM，不直接读/写 GS（只读）。

import { FENCE_ROW_COLS_INITIAL, CAPACITY_FRIENDLY_INITIAL, CAPACITY_DANGER_INITIAL } from '../utils/constants.js';

/**
 * 创建初始 GS 对象
 * 地图初始 3×3，外圈 8 格全为 'none' 地形/虚空/无内容，
 * 左下 idx=6 自动放【家】(facility_home)。
 * 玩家初始位置在左下（家的位置 idx=6）。
 */
export function createInitialState() {
  const size = 3;
  const ring = size - 1; // = 2
  const outerTiles = [];
  for (let idx = 0; idx < 4 * ring; idx++) {
    outerTiles.push({
      idx,
      terrain: 'none',        // Phase 0 默认无地形
      terrainAmount: 0,
      contentId: null,        // Phase 0 默认无内容
      states: [],             // 祝福/debuff 等临时状态
      dailyFlags: {},         // 每回合/每日限次标记，格式如 { 'facility_home_onEnter_0': 0 }
    });
  }

  // 左下 idx=6 放家
  const HOME_IDX = 6;
  outerTiles[HOME_IDX].contentId = 'facility_home';

  // 栅栏内初始化（初始 1×1）
  const fenceRowCols = FENCE_ROW_COLS_INITIAL; // = 1
  const fence = [];
  for (let r = 0; r < fenceRowCols; r++) {
    for (let c = 0; c < fenceRowCols; c++) {
      fence.push({
        row: r,
        col: c,
        terrain: 'none',
        terrainAmount: 0,
        creatures: [],
        items: [],
      });
    }
  }

  return {
    // ── 基础 ──
    gameOver: false,
    day: 1,
    turn: 0,

    // ── 玩家 ──
    player: {
      x: HOME_IDX,          // 初始在家（左下）
      y: 0,                 // 外圈格索引模式下 y 暂不使用
      hp: 100,
      maxHp: 100,
      atk: 10,
      stamina: 8,
      maxStamina: 8,
      minStamina: -3,
      gold: 0,
      position: 'outer',
    },

    // ── 地图 ──
    map: {
      size,                 // 3
      outerTiles,
      fence,
      fenceRowCols,
    },

    // ── 容量 ──
    capacity: {
      friendly: CAPACITY_FRIENDLY_INITIAL,   // 4
      danger: CAPACITY_DANGER_INITIAL,       // 4
      extreme: 0,
      friendlyOverdue: 0,
      dangerOverdue: 0,
      extremeOverdue: 0,
    },

    // ── 生物 ──
    creatures: [],

    // ── 背包 ──
    inventory: {
      items: [],            // [{ itemId, qty }]
      outbox: [],           // 出货箱 12 格
    },

    // ── 快捷栏 ──
    hotbar: Array(10).fill(null), // 10 格，每格 null 或 { itemId }

    // ── 编队 ──
    team: {
      activeGroup: 0,
      groups: [
        { roles: ['yumo'], spirit: 'momo' },   // 第一组：余默 + momo
        { roles: [], spirit: null },
        { roles: [], spirit: null },
        { roles: [], spirit: null },
      ],
      dailyModifyCount: 0,
    },

    // ── 祝福 ──
    // Phase 2A 说明：全局 blessingQueue 已废弃，blessed 状态统一挂 tile.states[]（tile 级真相源）
    blessingQueue: [],  // 保留字段兼容存档，但已不参与游戏逻辑

    // ── 建造模式 ──
    buildMode: false,

    // ── 连携技 ──
    linkSkillQueue: [],
    lastTurnLinkSkill: 0,

    // ── 每日限次计数器 ──
    dailyCounters: {},

    // ── Buff/Debuff ──
    activeBuffs: [],

    // ── 选中 / UI 状态 ──
    uiState: {
      selectedTileIdx: null,
      infoTab: 'content',
      activePanel: null,
    },
  };
}
