// src/data/potions.js
// v0.5 §14.1 消耗道具定义（道具 → 消耗道具）
// 消耗道具在背包中，玩家主动使用时触发效果
// Agent 3 的 InventorySystem / UseItemSystem 读取此文件执行使用逻辑

import { ITEMS } from './items.js';
export const POTIONS = {
  item_herb: {
    id: 'item_herb',
    itemId: 'item_herb',
    name: '草药',
    emoji: '🌿',
    description: ITEMS.item_herb.description,
    useEffect: {
      type: 'hp_regen',
      amount: 20,
      cooldownTurns: 5,
    },
  },

  item_fertilizer: {
    id: 'item_fertilizer',
    itemId: 'item_fertilizer',
    name: '初级肥料',
    emoji: '💩',
    description: ITEMS.item_fertilizer.description,
    useEffect: {
      type: 'facility_trigger_twice',
      triggerCount: 2,
      // 目标判定见 UseItemSystem.hasDailyStartTrait()：检索物品库触发时点是否含
      // 【每一日开始时】，不维护名单；不含该时点的地块无效，且不返还已消耗的道具。
      invalidNoReturn: true,
    },
  },

  // ── ITM-CON-003 啤酒 🍺 ──
  item_beer: {
    id: 'item_beer',
    itemId: 'item_beer',
    name: '啤酒',
    emoji: '🍺',
    description: ITEMS.item_beer.description,
    useEffect: {
      type: 'stamina_and_buff',
      stamina: 3,
      buffChance: 0.3,
      buffId: 'grumpy',
      buffAtkBonus: 0.25,
      buffDays: 1,
    },
  },

  // ── ITM-CON-004 感恩节的晚餐 🍗 ──
  item_dinner: {
    id: 'item_dinner',
    itemId: 'item_dinner',
    name: '感恩节的晚餐',
    emoji: '🍗',
    description: ITEMS.item_dinner.description,
    useEffect: {
      type: 'friendly_as_enemy',
      durationDays: 1,
      // 效果与持续时间不可叠加；我方单位含所有角色（及其技能）、精灵以及能发动攻击的设施
    },
  },

  // ── ITM-CON-005 陷阱 🪤（放置型）──
  item_trap: {
    id: 'item_trap',
    itemId: 'item_trap',
    name: '陷阱',
    emoji: '🪤',
    description: ITEMS.item_trap.description,
    useEffect: {
      type: 'placed_daily_roll',
      chance: 0.10,
      resourceChance: 0.30,
      pool: 'POOL-12',
      // 多个陷阱各自独立计算
    },
  },

  // ── ITM-BK-003 农场扩建I型 📏（使用型，无目标）──
  item_farm_expand_length: {
    id: 'item_farm_expand_length',
    itemId: 'item_farm_expand_length',
    name: '农场扩建I型',
    emoji: '📏',
    description: ITEMS.item_farm_expand_length.description,
    useEffect: {
      type: 'expand_map_length',
      // 农场的长度（列数）增加 1 列；见 MapExpandSystem
    },
  },

  // ── ITM-BK-004 农场扩建II型 📐（使用型，无目标）──
  item_farm_expand_width: {
    id: 'item_farm_expand_width',
    itemId: 'item_farm_expand_width',
    name: '农场扩建II型',
    emoji: '📐',
    description: ITEMS.item_farm_expand_width.description,
    useEffect: {
      type: 'expand_map_width',
      // 农场的宽度（行数）增加 1 行；见 MapExpandSystem
    },
  },

  // ── ITM-CON-006 艾草熏香 🪔（放置型）──
  item_incense: {
    id: 'item_incense',
    itemId: 'item_incense',
    name: '艾草熏香',
    emoji: '🪔',
    description: ITEMS.item_incense.description,
    useEffect: {
      type: 'placed_sleep_heal',
      healAmount: 30,
    },
  },
};

export const ALL_POTION_IDS = Object.keys(POTIONS);
