// src/core/Assets.js
// 资源路径表 + emoji 占位表 + icon PNG 映射表（阶段 1 新增）
// 说明：
//   * facilities / resources / terrains / ui / items / creatures 六组保持扁平 emoji 字符串结构——
//     现有 20+ UI 文件直接取 emoji 字符串渲染，阶段 1 不动这些调用点。
//   * icons 组为并行的 PNG 路径映射；只有仓库里实际存在的 PNG 才登记。
//   * getEmoji() 保留原语义；getIcon(group, id) 新增，返回路径字符串或 null。
//     未来 UI 层切换：凡是现在渲染 emoji 的地方，先查 getIcon，有 PNG 就用 <img src>，
//     没有再回退 emoji——数据层改动就到此为止。

export const Assets = {
  // ── 设施（16 种，对齐物品库 FAC-001 ~ FAC-016）──
  facilities: {
    facility_home: '🏠',
    facility_tent: '⛺',
    facility_wheat: '🌾',
    facility_rice: '🌱',
    facility_potato: '🥔',
    facility_tulip: '🌷',
    facility_strawberry: '🍓',
    facility_pea: '🫛',
    facility_henhouse: '🐔',
    facility_slimehouse: '🟢',
    facility_corn: '🌽',
    facility_cabbage: '🥬',
    facility_wild_seed: '🌱',
    facility_dandelion: '🌼',
    facility_ghost_grass: '🌙',
    facility_mugwort: '🍃',
  },

  // ── 资源类地块内容（6 种，对齐 RES-001 ~ RES-006）──
  resources: {
    resource_event: '🎲',
    resource_reward: '🎁',
    resource_hunt: '⚔️',
    resource_shop: '🏪',
    resource_bus: '🚌',
    resource_magic_shop: '🔮',
  },

  // ── 地形（键与物品库 terrain_* 一致；后 4 个为旧 id 别名，兼容旧存档）──
  terrains: {
    terrain_none: '⬜',
    terrain_grass: '🟩',
    terrain_water: '🌊',
    terrain_ice: '🧊',
    // 旧 id 别名
    none: '⬜',
    grass: '🟩',
    water: '🌊',
    mud: '⬜',
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
    task: '📋',
    day: '📅',
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

  // ── 物品（完整 9 种产出）──
  items: {
    item_wheat: '🌾',
    item_rice_straw: '🌾',
    item_potato: '🥔',
    item_strawberry: '🍓',
    item_pea: '🫛',
    item_egg: '🥚',
    item_raw_meat: '🍖',
    item_slime_gel: '🟢',
    item_wheel: '⚙️',
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

  // ── icon PNG 路径映射（阶段 1 新增）──
  // 只有仓库里 **真实存在** 的 PNG 才登记；其余条目 getIcon 返回 null，UI 层应回退 emoji。
  // 美术按 art-icon-manifest.md 补齐 assets/images/icons/*.png 后，
  // 把对应 id 加进来（路径同 manifest）或直接在数据文件的 icon 字段填好即可。
  icons: {
    facilities: {},
    resources: {},
    terrains: {
      terrain_none: 'assets/images/terrain/tile_none.png',
      terrain_grass: 'assets/images/terrain/tile_grass.png',
      terrain_water: 'assets/images/terrain/tile_water.png',
      terrain_ice: 'assets/images/terrain/tile_ice.png',
    },
    // 第 6 批美术接入：docs/_art-references 可匹配素材（只接线，不新增创作）
    ui: {
      task: 'assets/images/icons/ui_task.png',           // ← 任务.png
      build: 'assets/images/icons/ui_build.png',         // ← 建造.png
      inventory: 'assets/images/icons/ui_inventory.png', // ← 背包.png
      gold: 'assets/images/icons/ui_gold.png',           // ← 金币.png
      player: 'assets/images/characters/hero.png',       // ← 主角小人模型.png（主角占位同用主角立绘）
    },
    items: {},
    creatures: {
      slime_fire:  'assets/images/enemies/slime_fire.png',
      slime_water: 'assets/images/enemies/slime_water.png',
      slime_grass: 'assets/images/enemies/slime_grass.png',
      slime_thunder:'assets/images/enemies/slime_thunder.png',
      slime_ice:   'assets/images/enemies/slime_ice.png',
      slime_rock:  'assets/images/enemies/slime_rock.png',
      slime_wind:  'assets/images/enemies/slime_wind.png',
    },
  },

  /**
   * 查表：从 Assets 各分组里按 id 取 emoji
   */
  getEmoji(group, id) {
    const g = Assets[group];
    if (!g) return '❓';
    return g[id] ?? '❓';
  },

  /**
   * 查表：返回真实 PNG 路径，若仓库里没有则返回 null。
   * UI 层可先查此方法，有 PNG 就 <img src>，没有回退 emoji。
   * @param {string} group 'facilities'|'resources'|'terrains'|'ui'|'items'|'creatures'
   * @param {string} id
   * @returns {string|null}
   */
  getIcon(group, id) {
    const g = Assets.icons[group];
    if (!g) return null;
    const p = g[id];
    return p || null;
  },
};
