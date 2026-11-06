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
│   ├── Geometry.js           # 空间几何层（1 格 = 1 单位；地块/生物圆/碰撞查询/几何快照）
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
│   ├── LinkSkillSystem.js    # 连携技（解锁检测 + 8 秒窗口 + 队列）
│   ├── RealtimeClock.js      # 统一实时时钟（200ms 逻辑步 + 渲染插值 + 结算快照冻结）
│   ├── CreatureSystem.js     # 生物连续积分移动（3~6 秒/格）+ 投喂 + 成长 + 心情
│   └── BuildSystem.js        # 建造模式 + 放置/替换地块内容
├── ui/                       # UI 渲染层（订阅 EventBus，更新 DOM）
│   ├── UIController.js       # UI 总控（模式切换 + 页面管理）
│   ├── MapView.js            # 地图区渲染（外圈边长可配置；地块像素由可用区域反算）
│   ├── TopBar.js             # 顶部状态栏（生命/攻击/行动力/金币/容量）
│   ├── FuncBar.js            # 功能区（8 图标，从右往左）
│   ├── InfoPanel.js          # 信息区（右侧滑入，动态 tab：地块内容/状态/单位/祈福；按钮固定在滚动区外）
│   ├── HotBar.js             # 快捷物品栏（底部居中，10 格）
│   ├── SpiritArea.js         # 左侧精灵 + 祈福按钮
│   ├── LinkSkillUI.js        # 连携区（8 秒窗口小圆框 + 队列）
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
│   ├── ConfirmAction.js      # 统一二次确认状态机（arm/disarm/trigger + 快捷键绑定）
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
  STATE_RESET: 'state:reset',       // Storage.load() 后 emit，所有 UI 模块订阅做全量重渲染
  STORAGE_SAVE: 'storage:save',
  
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

### 2.4 Geometry（空间几何层 + 碰撞查询）

```js
// src/core/Geometry.js —— 纯函数，无状态；1 格 = 1 单位，地图左上角为原点 (0,0)
// 地块引用 ref：{ kind:'outer', idx } | { kind:'fence', row, col }

// —— 地块几何 ——
tileCenter(gs, ref)            // 地块中心点 {x,y}；外圈 (x+0.5,y+0.5)，栅栏 (col+1.5,row+1.5)
tileRect(gs, ref)              // 地块 AABB {x0,y0,x1,y1}（正方形，含外圈与栅栏）
fenceTileRect(row, col)        // 栅栏格 AABB（栅栏原点恒 (1,1)，无需 gs）
fenceRect(gs)                  // 整个栅栏区域 AABB
outerTileRef(idx) / fenceTileRef(row,col) / fenceTileIndex(gs,row,col)
allOuterTileRefs(gs) / allFenceTileRefs(gs)
computeTilePx({availW, availH, size})   // UI 由可用区域反算每格像素（3×3 常规窗口仍 80px）

// —— 生物圆 ——
creatureRadius(creatureOrKind) // 实例 radius → 生物定义 radius → 0.25（待定兜底）
creatureCircle(creature)       // 逻辑圆 {x,y,r}，读 c.pos（判定权威位置）
creatureRenderCircle(creature) // 显示圆，读 c.renderPos（插值位置，不参与判定）
creatureTileRefs(gs, creature) // 该圆当前压到的全部栅栏格（可跨多格）

// —— 碰撞查询（默认只返回存活生物，按实例 id 去重，不看外圈域） ——
circleIntersectsRect(cx, cy, r, rect)   // 圆×AABB 最近点法，相切算重叠
circleCenterDistance(a, b)              // 圆心直线距离（禁止格距）
creaturesInTileRect(gs, tileIdx)        // 单格；tileIdx 可为栅栏 ref 或栅栏线性索引
creaturesInTiles(gs, tileIdxs)          // 多格并集；跨格生物只返回一次（按实例去重）
nearestCreatureTo(gs, point, opts?)     // 默认 = 最近的存活敌人（中心点距离）
snapshotGeometry(gs)                    // 冻结逻辑圆位置/半径的快照（见下）
```

**几何口径（权威）**：

1. **地图外圈边长可配置**：初始 3×3，后续道具可扩长/扩宽。外圈边长 `size` 变化时，栅栏内区域 = `(size-2)×(size-2)` 同步变大，但**栅栏原点恒为网格 (1,1)**；`outerTiles` 长度 = `4*(size-1)`。禁止把 3×3 / 8 格 / 240px 写死。地块像素由可用区域 `computeTilePx()` 反算，扩图不挤压、不错位。逻辑层（如 `BlessSystem`）只输出逻辑坐标，像素换算只发生在 UI（`MapView` / `BlessAnimation`）。
2. **生物只属于栅栏域**：圆贴边压到外圈框不算位于外圈地块（外圈单位页只显示角色）。`fence[].creatures` 只是「主格」兼容缓存，**几何归属以 `pos` + `radius` 计算**；允许一格多只、允许完全重叠，生成不再要求整格为空（容量仍按分类软上限统计）。
3. **逻辑位置 vs 渲染位置**：`pos` 是判定权威位置；`renderPos` 是表现层插值位置。结算冻结（主动技能/回合结算）只冻结 `pos`（用 `snapshotGeometry()` 捕获），渲染层继续按 `renderPos` 插值，画面不停。阶段 2 起两者都由 `RealtimeClock` 推进：逻辑步写 `pos`，每个真实帧独立写 `renderPos`（见 §2.5）。
4. **默认索敌（全项目统一）**：任何未明确写索敌对象的技能，一律选**最近的敌人**（圆心到圆心直线距离），即 `nearestCreatureTo(gs, point)` 默认语义（`enemiesOnly: true` + 存活判定）。

### 2.5 RealtimeClock（统一实时时钟 / 渲染插值）

```js
// src/systems/RealtimeClock.js
LOGIC_STEP_MS = 200            // 固定逻辑步长（设计文档 §18.3）
new RealtimeClock(getGs)       // 每个需要时读当前 GS（读档/重开后仍指向最新对象）
clock.start() / stop()         // 唯一一个 40ms 驱动定时器
clock.advance(realDtMs)        // 浏览器由驱动调用；测试可直接传入任意 dt
clock.runSettlement(gs, fn)    // 毫秒级同步结算栈：取 snapshotGeometry 并冻结逻辑积分
clock.onStep(fn)               // 订阅 200ms 逻辑步（连携窗口 UI 进度条用），返回退订函数
clock.settling                 // 是否在同步结算栈内
getRealtimeClock() / resetRealtimeClock()  // 进程内单例 / 测试重置
```

**时钟结构（单一定时器）**：

- **只允许一个逻辑定时器**：`RealtimeClock` 的 40ms 驱动。真实 dt 进入累加器，按 `200ms` 切片执行逻辑步；不足一步的余量留到下一帧（所以 0.5s 实测位移约有 0~1 步的残差）。
- **逻辑步顺序（设计文档 §18.3）**：① 连携窗口过期 `pruneExpired` → ② 条件扫描 `periodicConditionScan` → ③ 生物连续积分 `stepCreatures` → ④ 移动后的地块效果（啃草）→ ⑤ 一次性广播（仅地块内容真的变化时 emit `TILE_UPDATED`，逐帧移动本身不广播）。
- **已合并的旧定时器**：`GameDirector` 的 1000ms 连携轮询、`CreatureSystem` 的 1000/2000ms 生物移动、`LinkSkillUI` 的 200ms 进度计时器全部移除。连携窗口 UI 改为 `clock.onStep()` 订阅；8 秒窗口仍由 `LinkSkillSystem` 用 `Date.now()` 判定，`WINDOW_MS = 8000` 与到期事件（`triggered:false`）不变。
- **渲染插值**：`advance()` 无论是否结算都调用 `CreatureSystem.advanceCreatureRendering(gs, dt)` 推进 `renderPos`；`MapView` 的 rAF 只读 `renderPos` 画像素，不写逻辑位置。
- **结算冻结边界**：`runSettlement` 必须同步调用，`settling` 只存在于毫秒级结算栈内；禁止延长到动画、飞字、淡出、面板打开期间。演出各自消费自己的快照，不持有 settle 锁。
- **运动模型**：随机游走（目标点 + 角速度上限 `2.4 rad/s` 平滑转向，到达后低概率停顿 0.3~0.9 秒），方向为任意弧度；速度 `speedPerTile` 单位为**秒/格**（3~6），只被栅栏边界裁剪（圆心 + 半径不出栅栏），生物之间不碰撞、允许完全重叠。小鸡长大半径 `1/6 → 0.25` 时圆心立即夹回合法区。

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
    size: 3,                   // 外圈边长（初始 3；道具可扩长/扩宽 → size 增大）
    outerTiles: [],            // 外圈格数组，长度 4*(size-1)；每格 { idx, terrain, terrainAmount, contentId, states: [], dailyFlags: {} }
    fence: [],                 // 栅栏内网格，fenceRowCols × fenceRowCols；每格 { row, col, terrain, terrainAmount, creatures: [], items: [] }
    fenceRowCols: 1,           // = size - 2（栅栏内随外圈同步扩大；原点恒为网格 (1,1)）
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
  creatures: [],               // 生物实例：{ id, kind, row, col, hp, atk, growth, mood, stage, element,
                               //   radius,                            // 圆半径（格），小鸡 1/6 / 鸡·史莱姆 0.25
                               //   pos: {x, y},                       // 连续逻辑坐标（判定权威；可任意小数）
                               //   renderPos: {x, y},                 // 渲染插值位置（表现层写，不参与判定）
                               //   dir,                               // 朝向弧度（任意方向，非四方向）
                               //   speedPerTile,                      // 秒/格，区间 3~6（小鸡 3.0 / 鸡 4.2 / 史莱姆 5.0）
                               //   targetPos: null,                   // 闲逛目标点（逻辑坐标）
                               //   pauseLeft, retargetLeft }          // 停顿/重取目标的剩余秒数（非墙钟，可入日初基线）
                               // row/col 仅为主格兼容缓存；几何归属以 pos+radius 计算
  
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
8. **二次确认唯一实现**：所有需要玩家二次确认的操作（睡觉、清空存档、退出等）先弹 `DialogBox` 文字弹窗（选项「取消」+ 目标动作），在弹窗内点目标动作才进入待确认态并复用 `src/ui/ConfirmAction.js`：`arm` 变底色 + 弹窗内显示「你确定这么做？」→ `trigger` 二次同一 tick 立即执行业务 → 弹窗 1.5 秒淡出；待确认文案禁止出现在图标旁 / 屏幕角落。快捷键与按钮走同一入口。禁止各面板自写 `_armed` 标志 / 计时器。取消待确认态只有一个复位入口：`ConfirmAction.disarm` 通过 `onDisarm` 通知调用方同步复位自身状态机（禁止「只改 UI 不改内部状态」），保证 arm → 点别处/ESC 取消 → 再点仍是 arm，绝不跳过待确认直接执行。例外：商店「离开」按钮保持原有"只变底色不改文字"实现；载具页的装载 / 卸下 / 替换为单击即时生效，不弹窗、不进入二次确认。

---

## 七、结算去重与延迟死亡模块（EffectBatch / PendingDeathQueue）

> 对应《空间碰撞与时序方案》§2.5 ② / ④、§3.2 ⑦c⑬、§3.4、§3.5。本轮只交付模块本体，**尚未接入** `SkillSystem` / `LinkSkillSystem` 的实际结算。

### 7.1 EffectBatch —— 一次结算一份批次

```js
import { EffectBatch } from '../systems/EffectBatch.js';
const batch = new EffectBatch(gs, { sourceSkillId, instanceKey, phase, deathQueue });
batch.damage(target, multiplier, { element, hits, realDamage, key });
batch.buff(target, buffId, { strength, duration, params });
const summary = batch.commit();   // 按登记顺序统一应用，返回摘要
```

职责：把「技能产出意图」与「真正应用效果」分开，重复意图在批次内收敛成一次。

去重口径（写死）：

| 类型 | 去重键 | 取值规则 |
|---|---|---|
| 伤害 | `instanceKey + 伤害键 + targetId`（默认伤害键 `skill:${skillId}`） | 只应用一次，倍率取**最高**（同倍率取段数更多的 `hits`），不求和 |
| buff/debuff | `targetId + buffId`（不含技能实例） | 只应用一次，强度取**最高**、时长取**最长**；与目标身上已有同名 buff 的合并仍由 `CombatSystem.applyBuff` 负责（同名取最高） |

- `hits` 在**一次应用内部**循环，不按格数放大；
- 不同技能实例 / 不同伤害键命中同一目标 → 各自独立结算，不互相吞伤害；
- 应用顺序 = 意图**首次登记顺序**（与 §3.5 的稳定顺序配合：调用方先按 `tileIdx` → `instanceKey` → `targetId` 顺序登记即可）；
- `commit()` 后批次**封存**：再登记 / 再 commit 抛错；空批次 commit 安全（`empty:true`，不调用结算函数）；
- 目标在批次中途死亡 → 同批次内该目标后续分组跳过（`summary.skippedDead`）；登记时目标已死 → 忽略（`summary.ignoredDead`）；
- 结算函数可注入（`resolveDamage` / `applyBuff`），默认 `CombatSystem.calculateDamage` / `CombatSystem.applyBuff`，便于 headless 断言。

返回摘要结构：

```js
{ batchId, sourceSkillId, instanceKey, phase, empty,
  damages: [{ targetId, key, multiplier, hits, appliedHits, damage, element, dodged, immune, isCrit, skipped }],
  buffs:   [{ targetId, buffId, strength, duration, applied, refreshed, skipped }],
  ignoredDead, skippedDead }
```

### 7.2 PendingDeathQueue —— 死亡延迟到批次末

```js
import { PendingDeathQueue } from '../systems/PendingDeathQueue.js';
const dq = new PendingDeathQueue(gs);
dq.markDead(target);   // 或 new EffectBatch(gs, { deathQueue: dq }) 在 commit 内自动入队
dq.flush();            // 批次 / 回合末统一处理
```

- `markDead(target)`：只把 `hp` 夹到 0、置 `dead = true`、按实例 id 入队；**不从任何集合删除**；
- 同一实例重复入队返回 `false`（只死一次）；已从 `gs.creatures` 移除的实例不再入队；
- `flush()`：按实例 id 升序 → 去重 → 发 `CREATURE_DEFEATED` → 从栅栏格缓存与 `gs.creatures` 移除 → 击杀掉落 → `onCreatureDefeated` 词条 hook → 天赋回调；掉落与事件**只结算一次**（已移除实例只计入 `skipped`）；
- 空队列 `flush()` 安全（`empty:true`）；
- `has(id)` / `isAlive(target)` 供结算层判定「已死实例不再被结算」；
- 依赖可注入（`grantKillDrops` / `fireDefeatedHook` / `onTalentDefeated` / `bus`），默认走真实系统。

### 7.3 接入点（下一阶段，本轮不改现有结算）

1. `SkillSystem.fireOneSkill`：把逐目标 `CombatSystem.calculateDamage` / `applyBuff` 改为 `batch.damage(...)` / `batch.buff(...)`，`commit()` 后取摘要；
2. `SkillSystem.defeatCreature` / `LinkSkillSystem` 的即时删除：改为 `deathQueue.markDead(target)`；
3. `GameDirector` 回合末（§3.2 ⑬）调用一次 `flushDeaths()`，替换现有的即时 `defeatCreature`；
4. `TurnSystem` 的燃烧 tick 同样只 `markDead`，统一在回合末 flush。

### 7.4 验收

`node tools/smoke-effectbatch.mjs`：51 条断言，覆盖重复登记取最高、同一目标被两个地块命中只结算一次、`hits` 不按格放大、同名 buff 取最高强度 + 最长时长、已存在 buff 不叠加、死亡延迟到批次末、掉落只结算一次、已死目标不被二次结算、空批次安全、commit 后复用抛错。
