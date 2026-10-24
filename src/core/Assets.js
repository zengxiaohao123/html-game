// src/core/Assets.js
// 资源路径表 + emoji 占位表
// MVP 阶段所有美术用 emoji；图片替换只改本文件，其他代码零改动。
// 未来加图片资源时，每条目可扩展为 { emoji, image: 'assets/xxx.png' } 格式。

export const Assets = {
  // ── 设施（Phase 0 先放最基础几样，后续 Phase 2 再补全 10 种）──
  facilities: {
    facility_home: '🏠',
    facility_tent: '⛺',
    facility_wheat: '🌾',
    facility_potato: '🥔',
    facility_chicken_house: '🐔',
    facility_slime_house: '🟢',
  },

  // ── 地形 ──
  terrains: {
    none: '🟫',       // 虚空 / 初始无地形
    grass: '🟩',
    water: '🌊',
    mud: '🟟',
  },

  // ── UI 图标（状态栏/功能区/emoji 占位）──
  ui: {
    hp: '❤️',
    atk: '⚔️',
    stamina: '🔷',
    gold: '🪙',
    capacity_friendly: '🐣',
    capacity_danger: '👹',
    capacity_extreme: '💀',
    settings: '❌',
    sleep: '🛌',
    role: '👤',
    team: '👥',
    forge: '⚒️',
    build: '🛠️',
    inventory: '🎒',
    vehicle: '🚗',
    player: '🧑',
    spirit: '👻',
  },

  // ── 物品占位（Phase 2 补全）──
  items: {
    item_wheat: '🌾',
    item_egg: '🥚',
    item_raw_meat: '🍖',
    item_wheel: '🚗',
  },

  // ── 生物占位 ──
  creatures: {
    chick: '🐣',
    chicken: '🐔',
    slime_fire: '🔥',
    slime_water: '💧',
    slime_grass: '🟢',
    slime_thunder: '⚡',
    slime_ice: '🧊',
    slime_rock: '🪨',
    slime_wind: '🌪️',
  },

  /**
   * 查表：从 Assets 各分组里按 id 取 emoji
   * @param {string} group 'facilities'|'terrains'|'ui'|'items'|'creatures'
   * @param {string} id
   * @returns {string} 找不到时返回 '❓'
   */
  getEmoji(group, id) {
    const g = Assets[group];
    if (!g) return '❓';
    return g[id] ?? '❓';
  },
};
