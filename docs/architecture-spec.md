# 《转盘农场》架构规范 v0.1

> **版本**：2026-10-24（Trae 产出）
> **目标**：纯前端 HTML5 SPA，部署到 Cloudflare Pages 静态托管
> **入口**：GitHub 仓库 `zengxiaohao123/html-game`，main 分支 = 自动部署
> **运行时**：ESM 模块化，无构建工具，`index.html` 直接引用 `src/main.js`
> **约束**：所有后续开发 agent 必须严格遵守本规范；新增模块/事件/hook 类型需在本文档同步更新

---

## 一、顶层目录结构

```
index.html                    # SPA 入口（模块化 script，引入 src/main.js）
src/
├── main.js                   # 入口：组装 Director + UI，启动
├── core/                     # 基础设施（无游戏逻辑，纯工具）
│   ├── EventBus.js           # 全局事件总线（发布/订阅）
│   ├── HookDispatcher.js     # 词条 Hook 分发器（10 种时机）
│   ├── GameEvents.js         # 所有事件名常量（集中管理）
│   ├── Logger.js             # devLog.info/warn/error
│   ├── Random.js             # 随机数工具（含 seed 可选）
│   ├── Distance.js           # 距离/邻居/路径计算
│   └── Assets.js             # 资源路径表 + emoji 占位表
├── state/                    # 全局状态（单一真相源）
│   ├── gameState.js          # GS 对象定义 + createInitialState()
│   ├── map.js                # 地图/外圈/栅栏的状态切片
│   └── storage.js            # localStorage 8 槽位存档读写
├── data/                     # 静态数据表（纯常量，无逻辑）
│   ├── facilities.js         # 10 种设施定义（含 hook 注册）
│   ├── resources.js          # 5 种资源类地块内容定义
│   ├── characters.js         # 3 个角色 + 精灵 + 技能定义
│   ├── creatures.js          # 生物定义（小鸡/鸡/史莱姆 7 变体）
│   ├── items.js              # 产出物品表（小麦/鸡蛋/生肉...）
│   ├── buffs.js              # 6 种 debuff/buff 定义
│   └── terrains.js           # 4 种地形定义
├── systems/                  # 游戏逻辑系统（读取/修改 GS，触发 EventBus）
│   ├── GameDirector.js       # 主循环导演（回合制 + 连携技实时窗口）
│   ├── InputManager.js       # 键鼠输入统一监听 + 路由
│   ├── TurnSystem.js         # 回合推进 + 行动力扣减 + 心力交瘁
│   ├── DaySystem.js          # 每日开始事件 + 每日限次重置
│   ├── MovementSystem.js     # 移动（WASD）+ 经过/进入触发
│   ├── BlessSystem.js        # 祈福（2 行动力 + 1 金币 + 随机祝福）
│   ├── InventorySystem.js    # 背包 + 出货箱 + 快捷栏 + 拖拽放置
│   ├── CombatSystem.js       # 伤害计算 + 闪避 + 元素免疫 + 范围
│   ├── SkillSystem.js        # 技能触发（进入时/经过时/受祝福时）
│   ├── LinkSkillSystem.js    # 连携技（解锁检测 + 3 秒窗口 + 队列）
│   ├── CreatureSystem.js     # 生物实时移动 + 投喂 + 成长 + 心情
│   └── BuildSystem.js        # 建造模式 + 放置/替换地块内容
├── ui/                       # UI 渲染层（订阅 EventBus，更新 DOM）
│   ├── UIController.js       # UI 总控（模式切换 + 页面管理）
│   ├── MapView.js            # 地图区渲染（外圈 8 格 + 中心栅栏）
│   ├── TopBar.js             # 顶部状态栏（生命/攻击/行动力/金币/容量）
│   ├── FuncBar.js            # 功能区（8 图标，从右往左）
│   ├── InfoPanel.js          # 信息区（右侧滑入，4 tab）
│   ├── HotBar.js             # 快捷物品栏（底部居中，10 格）
│   ├── SpiritArea.js         # 左侧精灵 + 祈福按钮
│   ├── LinkSkillUI.js        # 连携区（3 秒窗口小圆框 + 队列）
│   ├── panels/
│   │   ├── MainMenu.js       # 主菜单（新游戏/读档/图鉴）
│   │   ├── SettingsPanel.js  # ESC 设置（存档/读档/回主菜单）
│   │   ├── InventoryPanel.js # B 键背包（8 tab + 出货箱 2×6）
│   │   ├── RolePanel.js      # C 键角色页面（全屏）
│   │   ├── TeamPanel.js      # L 键编队页面（4 组）
│   │   ├── ForgePanel.js     # F 键合成页面
│   │   ├── VehiclePanel.js   # T 键载具页面
│   │   └── ShopPanel.js      # 商店页面（地块功能进入）
│   ├── DialogBox.js          # 剧情区（底部居中）
│   ├── Toast.js              # 中央弹窗提示（物品+1、心力交瘁等）
│   └── styles/
│       ├── base.css          # 重置 + 字体 + 基础变量
│       ├── map.css           # 地图 + 地块样式
│       ├── panels.css        # 面板通用样式
│       ├── hotbar.css        # 快捷栏样式
│       └── ui.css            # 其余 UI 通用样式
└── utils/
    ├── dom.js                # DOM 操作工具（createEl、addClass 等）
    ├── constants.js          # 全局常量（MAX_STAMINA、CAPACITY 等）
    └── helpers.js            # 通用小函数
```

---

## 二、核心模块接口

### 2.1 EventBus（事件总线）

```js
// src/core/EventBus.js
export const EventBus = {
  on(event, handler)     // 订阅
  off(event, handler)    // 取消订阅
  emit(event, payload)   // 发布
  once(event, handler)   // 一次订阅
};
```

**事件名必须在 `src/core/GameEvents.js` 集中定义**，禁止字符串字面量。

### 2.2 HookDispatcher（词条 Hook 分发器）

```js
// src/core/HookDispatcher.js
export const HookDispatcher = {
  // 注册词条：hook 类型 → 回调函数
  register(hookType, callback, context)  // context = 设施/技能/状态对象
  
  // 触发时机：遍历所有已注册的 callback，按注册顺序执行
  fire(hookType, params)
  
  // 10 种 hook 类型（常量，在 GameEvents 或独立文件）
  // 'onEnter'      —— 角色进入该格（最终停留）
  // 'onPass'       —— 角色经过该格（路径上所有格 + 最终格）
  // 'onBlessed'    —— 该格被挂上祝福状态
  // 'onDailyStart' —— 每日开始时
  // 'onSleep'      —— 睡觉时
  // 'onReplace'    —— 被替换时（用于帐篷【替换时】词条）
  // 'onUseSkill'   —— 角色使用技能时（用于豌豆架）
  // 'onEveryNTurn' —— 每 N 回合（用于豌豆架每 2 回合限 1 次）
  // 'onCreatureDefeated' —— 生物被击败时
  // 'onEventResolve'     —— 事件/选项结算时
};
```

**关键约定**：词条（【】标注的）不写死在代码 if-else 里，而是注册到 HookDispatcher。新增设施/技能只需在 `data/*.js` 里注册 hook，核心代码零改动。

### 2.3 GameEvents（事件名常量）

```js
// src/core/GameEvents.js —— 仅列出 Phase 0/1 必需的，后续批次追加
export const GE = {
  // —— 生命周期 ——
  BOOT: 'boot',
  STATE_RESET: 'state:reset',
  
  // —— 玩家操作 ——
  MOVE: 'player:move',
  MOVE_BLOCKED: 'player:moveBlocked',
  SLEEP: 'player:sleep',
  BLESS: 'player:bless',
  BLESS_DONE: 'player:blessDone',
  
  // —— 回合/时间 ——
  TURN_ADVANCE: 'turn:advance',         // 回合数 +1
  DAY_START: 'day:start',               // 新一天开始
  DAY_END: 'day:end',
  
  // —— 数值变化 ——
  STAMINA_CHANGE: 'stamina:change',
  HP_CHANGE: 'hp:change',
  GOLD_CHANGE: 'gold:change',
  ATK_CHANGE: 'atk:change',
  STAT_CHANGE: 'stat:change',           // 任意属性变化（UI 刷新用）
  
  // —— 地图 ——
  TILE_UPDATED: 'tile:updated',         // 地块内容/地形/状态变化
  TILE_CLICKED: 'tile:clicked',
  TERRAIN_DEPLETED: 'terrain:depleted',
  
  // —— 背包/放置 ——
  INVENTORY_CHANGE: 'inventory:change',
  ITEM_GAINED: 'item:gained',           // 获得物品（payload: {itemId, qty}）
  ITEM_LOST: 'item:lost',
  PLACEMENT: 'placement',
  
  // —— 生物 ——
  CREATURE_SPAWNED: 'creature:spawned',
  CREATURE_DEFEATED: 'creature:defeated',
  CAPACITY_CHANGE: 'capacity:change',
  
  // —— 战斗/技能 ——
  SKILL_TRIGGERED: 'skill:triggered',
  DAMAGE_DEALT: 'damage:dealt',
  DAMAGE_TAKEN: 'damage:taken',
  LINK_SKILL_READY: 'linkskill:ready',
  LINK_SKILL_EXPIRE: 'linkskill:expire',
  
  // —— UI ——
  UI_PANEL_OPEN: 'ui:panelOpen',        // payload: 'inventory'/'role'/...
  UI_PANEL_CLOSE: 'ui:panelClose',
  UI_MODE_CHANGE: 'ui:modeChange',      // 探索/建造
  TOAST_SHOW: 'toast:show',             // payload: {text, duration}
  
  // —— 存档 ——
  SAVE_DONE: 'save:done',
  LOAD_DONE: 'load:done',
};
```

---

## 三、全局状态 schema（GS 对象）

```js
// src/state/gameState.js
export const createInitialState = () => ({
  // === 基础 ===
  gameOver: false,
  day: 1,
  turn: 0,                    // 回合计数（移动/祈福/睡觉 +1）
  
  // === 玩家 ===
  player: {
    x: 0,                      // 外圈格索引 0~7（初始 3×3），左下家的位置
    y: 0,                      // 同上，实际渲染时用 map.getTileCoord()
    hp: 100,
    maxHp: 100,
    atk: 10,
    stamina: 8,
    maxStamina: 8,
    minStamina: -3,
    gold: 0,
    position: 'outer',         // 'outer'（外圈）或 'fence'（栅栏内，本游戏永远 'outer'）
  },
  
  // === 地图 ===
  map: {
    size: 3,                   // 3×3 初始；扩图后变 4
    outerTiles: [],            // 外圈格数组，长度 4*(size-1)
                               // 每格: { idx, x, y, terrain, terrainAmount, contentId, states: [], dailyFlags: {} }
    fence: [],                 // 栅栏内网格，size-2 行 × size-2 列
                               // 每格: { row, col, terrain, terrainAmount, creatures: [], items: [] }
    fenceRowCols: 1,           // 初始 1×1 栅栏，扩图后 2×2
  },
  
  // === 容量 ===
  capacity: {
    friendly: 4,
    danger: 4,
    extreme: 0,
    friendlyOverdue: 0,        // 超载警告期剩余天数
    dangerOverdue: 0,
    extremeOverdue: 0,
  },
  
  // === 生物 ===
  creatures: [],               // 所有生物对象: { id, kind, row, col, hp, atk, growth, mood, stage, element }
  
  // === 背包 ===
  inventory: {
    items: [],                 // [{ itemId, qty }]
    outbox: [],                // 出货箱，最多 12 格
  },
  
  // === 快捷栏 ===
  hotbar: [null, null, ...null],  // 10 格，每格 null 或 { itemId }
  
  // === 编队 ===
  team: {
    activeGroup: 0,            // 0~3
    groups: [
      { roles: ['yumo'], spirit: 'momo' },   // 第一组，余默 + momo
      { roles: [], spirit: null },
      { roles: [], spirit: null },
      { roles: [], spirit: null },
    ],
    dailyModifyCount: 0,       // 今日已修改次数，上限 3
  },
  
  // === 祝福 ===
  blessingQueue: [],           // [{ tileIdx, dayRemaining, usesRemaining }]
  
  // === 建造模式 ===
  buildMode: false,            // true = 建造模式；false = 探索模式
  
  // === 连携技 ===
  linkSkillQueue: [],          // [{ skillId, roleId, expireAtMs, cooldownTurns }]
  lastTurnLinkSkill: 0,        // 上次触发连携技的回合计数
  
  // === 每日限次计数器 ===
  dailyCounters: {},           // { [counterKey]: number }  如 'facility_home_onEnter_0': 0
  
  // === Buff/Debuff ===
  activeBuffs: [],            // [{ id, target, remainingTurns/remainingDays, params }]
  
  // === 选中/UI 状态 ===
  uiState: {
    selectedTileIdx: null,
    infoTab: 'content',        // 'content'/'state'/'unit'/'bless'
    activePanel: null,         // null / 'menu'/'inventory'/'role'/'team'/'forge'/'vehicle'/'settings'
  },
});
```

**不可变更新约定**：所有系统修改 GS 时，必须先 emit 一个 EventBus 事件（如 `GE.STAMINA_CHANGE`），再更新 GS。UI 层只订阅事件刷新 DOM，不直接读/写 GS（只读）。

---

## 四、命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 文件名 | PascalCase | `GameDirector.js`, `TurnSystem.js` |
| 变量/函数 | camelCase | `createInitialState()`, `stamina` |
| 常量 | UPPER_SNAKE_CASE | `MAX_STAMINA`, `HOOK_TYPES` |
| 数据对象 id | snake_case 小写 | `facility_home`, `creature_chick`, `item_wheat` |
| 事件名 | kebab-case 带冒号 | `'player:move'`, `'skill:triggered'` |
| Hook 类型 | camelCase on+动词 | `onEnter`, `onDailyStart` |
| CSS 类 | kebab-case | `.info-panel`, `.quick-slot` |
| CSS 变量 | kebab-case 双横杠 | `--color-primary`, `--tile-size` |

---

## 五、新增模块 checklist

开发中新增任何模块/数据/事件时，必须同步：

1. 在 `architecture-spec.md` 目录树里补一行
2. 如果新增 EventBus 事件：更新 `src/core/GameEvents.js` + 本文档 §2.3
3. 如果新增 Hook 类型：更新 `src/core/HookDispatcher.js` + 本文档 §2.2
4. 如果修改 GS schema：更新本文档 §3
5. 在对应 Phase 任务 Brief 里标注修改点

---

## 六、设计原则

1. **词条驱动**：所有【】标注的效果都通过 HookDispatcher 注册，禁止 if-else 硬编码词条名
2. **数据与逻辑分离**：`data/*.js` 只存静态表 + hook 注册，`systems/*.js` 存执行逻辑
3. **单向数据流**：GS → EventBus → UI 订阅渲染，UI 不直接修改 GS
4. **扩展零侵入**：新增设施/技能/生物 = 在 `data/` 加一张表 + 在 HookDispatcher 注册，不碰 systems 核心
5. **Emoji 占位优先**：MVP 阶段所有美术用 emoji + 色块，图片替换只改 `Assets.js` 映射表
6. **地图三属性正交**：地形 / 内容 / 状态 独立存储、独立更新、独立触发效果
7. **元素伤害体系**：7 种元素（火水雷冰草风岩）+ 物理，每种伤害带类型字段，技能注册时声明
