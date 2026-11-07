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
│   ├── CapacitySystem.js     # 容量上限即时同步（栅栏面积 → 友善/危险上限 +1/格）
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
│   ├── FenceTerrainDrop.js   # 地形拖拽进栅栏内的捕获阶段桥接（设施/技能仍限外圈）
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
  FENCE_TILE_UPDATED: 'fence:tile_updated', // 栅栏内地块状态变化（地形放置等）
  TILE_CLICKED: 'tile:clicked',
  TERRAIN_DEPLETED: 'terrain:depleted',
  MAP_EXPANDED: 'map:expanded',         // 农场扩建完成（payload: {gs}），UI 需全量重排
  
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
mapDims(gs)                     // → { rows, cols }（地图行数/列数；旧存档缺字段时回退 map.size）
computeTilePx({availW, availH, rows, cols})   // UI 由可用区域反算每格像素：min(availW/cols, availH/rows)（3×3 常规窗口仍 80px）

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

1. **地图为矩形，行/列可独立变化**：初始 3×3。权威尺寸字段是 `map.rows`（行数 = 设计文档里的“宽度”）与 `map.cols`（列数 = “长度”）；`map.size` 仅作为旧存档回退（`rows ?? size`）。栅栏内区域 = `(rows-2)×(cols-2)`，**栅栏原点恒为网格 (1,1)**，栅栏线性索引 = `row*fenceCols+col`。外圈总格数 = `2rows+2cols-4`（上边 `cols-1`、右边 `rows-1`、下边 `cols-1`、左边 `rows-1`；上边不含右上角、右边含两角、下边不含左下角、左边含左下角）。禁止把 3×3 / 8 格 / 240px 写死。地块像素由可用区域 `computeTilePx({rows, cols})` 反算，扩图不挤压、不错位。逻辑层（如 `BlessSystem`）只输出逻辑坐标，像素换算只发生在 UI（`MapView` / `BlessAnimation`）。
   - 旧存档缺少 `rows/cols/fenceRows/fenceCols` 时，`Distance.mapDimsOf` / `fenceDimsOf` 一律回退 `size` / `fenceRowCols`，按 3×3 正常工作，不崩溃。
   - 索引换算统一走 `Distance.outerIdxToXY` / `outerXYToIdx` / `outerNeighbors`（入参可为 `gs.map` 或 `{rows, cols}`），不允许再传裸 `size`；越界一律返回 `null`，环形邻居不跨圈回绕。
2. **生物只属于栅栏域**：圆贴边压到外圈框不算位于外圈地块（外圈单位页只显示角色）。`fence[].creatures` 只是「主格」兼容缓存，**几何归属以 `pos` + `radius` 计算**；允许一格多只、允许完全重叠，生成不再要求整格为空（容量仍按分类软上限统计）。
3. **逻辑位置 vs 渲染位置**：`pos` 是判定权威位置；`renderPos` 是表现层插值位置。结算冻结（主动技能/回合结算）只冻结 `pos`（用 `snapshotGeometry()` 捕获），渲染层继续按 `renderPos` 插值，画面不停。阶段 2 起两者都由 `RealtimeClock` 推进：逻辑步写 `pos`，每个真实帧独立写 `renderPos`（见 §2.5）。
4. **默认索敌（全项目统一）**：任何未明确写索敌对象的技能，一律选**最近的敌人**（圆心到圆心直线距离），即 `nearestCreatureTo(gs, point)` 默认语义（`enemiesOnly: true` + 存活判定）。

### 2.4.1 MapExpandSystem（农场扩建）

```js
// src/systems/MapExpandSystem.js
EXPAND_AXIS = { LENGTH: 'length', WIDTH: 'width' }   // 长度=列数+1，宽度=行数+1
expandMapInPlace(gs, axis)   // 原地扩建，返回 { ok, axis, before:{rows,cols}, after:{rows,cols}, idxMap }
expandMap(gs, axis)          // 在 expandMapInPlace 之上同步日初基线并广播 GE.MAP_EXPANDED
```

**实现口径（权威，对应设计文档 §2.1.1）**：

- **方向固定，不做玩家选择**：I 型（`item_farm_expand_length` / `expand_map_length`）恒向右扩 1 列；II 型（`item_farm_expand_width` / `expand_map_width`）恒向上扩 1 行。
- **I 型（列 +1）**：原最右列（`x = cols-1`）整体右移 1 格到 `x = cols`，腾空的 `x = cols-1` 生成新列——上下端为外圈格，中间为栅栏格；`fenceCols + 1`，新栅栏列追加在末尾。
- **II 型（行 +1）**：原最上行（`y = 0`）保持，`y ≥ 1` 整体下移 1 行（`y → y+1`），腾空的 `y = 1` 生成新行——左右端为外圈格，中间为栅栏格；`fenceRows + 1`（旧行下移、新行插在最前），栅栏格行索引 `+1`。
- **跟随规则**：角色恰好站在被移动地块上时随之平移（`player.x/y` 同步重算），该位移**不视为移动**，不触发任何技能/地块效果。
- **内容保留与索引重映射**：重建 `map.outerTiles` 时按新的环形顺序排布，并产出 `idxMap`（旧外圈 idx → 新外圈 idx）；同时重映射 `player` 坐标、`creatures[].pos/renderPos/targetPos`、`fence[].creatures` 缓存、`linkSkillCounters` / `linkSkillCooldowns` 的 `tileIdx|skillId` 键、连携队列的 `tileIdx`/`key`、`uiState.selectedTileIdx`。地块 `tile.idx` 全部改写为新 idx。
- **地形**：新外圈格与新增栅栏格都走 §4 地形权重（50/40/10）掷骰并写入 `terrainAmount`；初始 3×3 已有的栅栏格保持 `terrain_none`，不回溯。
- **无上限、无消耗**：不设扩建次数硬上限（受地图可容纳格数与性能约束），不消耗行动力/体力、无冷却。物品数量扣减由 `UseItemSystem` 的通用道具扣减逻辑完成。
- **存档关系**：扩建属于「当天内的世界变化」，`expandMap` **不写日初基线**；只在正常采集点（`SleepSystem.sleep` 末尾 `DayBaseline.capture`）随实时状态入档。跨日后尺寸保留、道具数量按已用数量入档；当天回档（读档回本日开始时）时尺寸与扩建道具一起复原。`map.rows/cols/fenceRows/fenceCols` 随存档序列化，读档后正确恢复。
- **容量上限即时同步**：`expandMap` 在结构变更后立刻调用 `CapacitySystem.syncCapacityLimits(gs)`（上限 = 4 + 栅栏格数 - 1，友善/危险各自计算，高危恒 0），并广播 `GE.CAPACITY_CHANGE` → `TopBar._renderAll` 在同一帧内重绘容量条，不依赖玩家的后续操作。读档侧由 `migrateGS` 在 `DayBaseline.capture` 之前调用 `applyCapacityLimits(gs)`（只写上限不广播），因此读档进入扩建后的存档时容量 UI 首帧即为新值，旧档也能按实际栅栏面积校正。
- **容量与惩罚解耦**：`syncCapacityLimits` 只改上限与计数，不推进超载警告期；超载计时/惩罚仍只在日结算的 `updateCapacityAndPunish` 中处理。`CreatureSystem` 与 `CapacitySystem` 的上限公式必须保持一致（栅栏每多 1 格：友善 +1、危险 +1）。
- **UI 重排**：`MapView` 订阅 `GE.MAP_EXPANDED`，重新按新 `rows/cols` 计算 tile 像素、重画所有地块/栅栏/角色/生物层，不产生幽灵格或错位。

### 2.4.2 栅栏内地形放置（2026-11-07）

```js
// src/systems/BuildSystem.js
placeFenceTerrain(gs, row, col, terrainId) // 栅栏内行/列号（0 起）→ { ok, fenceIdx?, reason? }
```

- **地形允许进栅栏**：栅栏格与外围格一样有 `terrain / terrainAmount`；`placeFenceTerrain` 校验栅栏行列范围、库存后写入地形并扣 1 个道具，广播 `GE.FENCE_TILE_UPDATED`。重复施加同种地形 = 回满元素量（与 `placeTerrain` 同口径）。
- **设施/资源/技能仍限外圈**：`placeContent` 只接受外圈 `tileIdx`；`placeFenceTerrain` 只接受 `terrains.js` 里登记的地形 id，传入 `facility_*` / `skill_*` 一律按 `unknownTerrain` 拒绝。
- **拖拽入口**：`MapView` 的 drop 只认外圈坐标，栅栏内拖拽由独立模块 `src/ui/FenceTerrainDrop.js` 在容器捕获阶段接管（只处理 `terrain_` 前缀并 `stopPropagation`，避免误弹"只能放在外圈"）；放置成功后调用 `mapView.renderFence(gs)` 局部重绘栅栏背景层。设施/技能等其它内容仍走 `MapView` 原逻辑被拒绝。
- **信息区**：`InfoPanel` 订阅 `GE.FENCE_TILE_UPDATED`，正在查看该栅栏格时重渲染「地块内容 / 状态」tab。
- **验收**：`node tools/smoke-expand.mjs` 的 X2/X5（新栅栏格随机地形、初始格不回溯）与 X10（地形可放置、扣减、回满、越界拒绝、设施/技能不可）。

### 2.5 RealtimeClock（统一实时时钟 / 渲染插值）

```js
// src/systems/RealtimeClock.js
LOGIC_STEP_MS = 200            // 固定逻辑步长（设计文档 §18.3）
new RealtimeClock(getGs)       // 每个需要时读当前 GS（读档/重开后仍指向最新对象）
clock.start() / stop()         // 唯一一个 40ms 驱动定时器
clock.advance(realDtMs)        // 浏览器由驱动调用；测试可直接传入任意 dt
clock.runSettlement(gs, fn)    // 毫秒级同步结算栈：取 snapshotGeometry 并冻结逻辑积分
clock.onStep(fn)               // 订阅 200ms 逻辑步，返回退订函数
clock.onFrame(fn)              // 订阅 40ms 渲染帧（视觉表现用，结算栈内也触发），返回退订函数
clock.settling                 // 是否在同步结算栈内
getRealtimeClock() / resetRealtimeClock()  // 进程内单例 / 测试重置
```

**时钟结构（单一定时器）**：

- **只允许一个逻辑定时器**：`RealtimeClock` 的 40ms 驱动。真实 dt 进入累加器，按 `200ms` 切片执行逻辑步；不足一步的余量留到下一帧（所以 0.5s 实测位移约有 0~1 步的残差）。
- **逻辑步顺序（设计文档 §18.3）**：① 连携窗口过期 `pruneExpired` → ② 条件扫描 `periodicConditionScan` → ③ 生物连续积分 `stepCreatures` → ④ 移动后的地块效果（啃草）→ ⑤ 一次性广播（仅地块内容真的变化时 emit `TILE_UPDATED`，逐帧移动本身不广播）。
- **已合并的旧定时器**：`GameDirector` 的 1000ms 连携轮询、`CreatureSystem` 的 1000/2000ms 生物移动、`LinkSkillUI` 的 200ms 进度计时器全部移除。连携窗口 UI 改为 `clock.onFrame()` 订阅，每帧推进外圈计时环；8 秒窗口仍由 `LinkSkillSystem` 用 `Date.now()` 判定，`WINDOW_MS = 8000` 与到期事件（`triggered:false`）不变。
- **连携窗口计时环实现（`src/ui/LinkSkillUI.js`）**：窗口边界用 SVG `<circle>` 画白色圆环（`stroke-dasharray` 长度 = 剩余比例 × 周长，`rotate(-90°)` 从 12 点钟起画），只有队列第一位计时、弧长在 8 秒内按逆时针回收，排队条目恒为满圈。环画布与 72px 窗口等大（`viewBox 72×72`），白色环宽 6px 画在边界内侧，外径 = 窗口直径、正好压在窗口可视边界上，无外扩无缝隙；窗口底板无外边框并 `overflow:hidden` 裁在环内，序号角标、图标与技能名都收在环内侧。该更新只读 `expireAtMs` 与 `Date.now()`，不改队列、冷却、解锁与到期逻辑。
- **渲染插值**：`advance()` 无论是否结算都调用 `CreatureSystem.advanceCreatureRendering(gs, dt)` 推进 `renderPos`；`MapView` 的 rAF 只读 `renderPos` 画像素，不写逻辑位置。
- **结算冻结边界**：`runSettlement` 必须同步调用，`settling` 只存在于毫秒级结算栈内；禁止延长到动画、飞字、淡出、面板打开期间。演出各自消费自己的快照，不持有 settle 锁。
- **运动模型（以走为主、偶尔停下的走走停停状态机，2026-11-07 修订）**：每只生物维护 `behaviorState = 'idle' | 'walk'`。
  - `Idle`：**真正静止**（`pos` 完全不变），时长为长站或短停二选一——走完一次后按 `shortPauseChance` 进短停，否则进长站；静止期间可按 `idleTurnChance` 发生一次小幅转头（`idleTurnMaxRad`），不产生位移。60s 采样静止占比目标：小鸡 30~40% / 成鸡 40~50% / 史莱姆 50~60%（Idle 只是"偶尔停一下"，不是常态）。
  - `Walk`：朝 `targetPos` 走，方向为任意弧度，按 `maxTurnRate`（弧度/秒）平滑转向（不会瞬间反向）；速度 `speedPerTile` 单位为**秒/格**（3~6）；到达 `arriveEps` 后按 `chainWalkChance` **立刻接下一段**（连续多段位移后再停）或回 `Idle`；安全超时同样走该分支。
  - 目标点：常规走 `walkDistMin~Max` 格、方向沿当前朝向 ± `walkAngleJitter`；按 `longWalkChance` 偶尔换成全随机方向的 `longWalkDistMin~Max` 长走。距离取 `min(期望距离, 该方向射线到栅栏内边界的可达距离)`——目标永远在合法区内且可达，不再出现"目标夹到墙上、每一步都推不动"。
  - **撞墙即时重决策（卡墙修复）**：撞到**任何一面**栅栏的**同一个逻辑步内**立即二选一——① 按 `wallHitIdleChance` 进 `Idle`；② 换成满足 `wallFreeDistance = max(wallFreeMinDist 0.5 格, wallFreeHorizonS 1.5s / speedPerTile)` 的新方向，并在同一步内产生真实位移。
    - 候选方向在 0~2π 全角度采样（先试朝合法区中心），不限于上下左右；采样不到可行方向 → 直接进 `Idle`，并按 `wallFailExtraIdleS` 随连续失败次数延长静止（最多叠加 3 次）。
    - 任何时刻不允许"`Walk` 却零位移"；撞墙瞬间圆心被夹回合法区，绝不穿出栅栏。计数器 `wallHits` / `lastWallDecision` 只用于测试断言，不参与玩法。
  - **窄栏加成**：合法圆心区跨度小于 `narrowPenRefSpan`（1.5 格）时 Idle 按比例缩短（下限 `narrowPenIdleMinScale` 0.55），保证 1×1 栅栏（合法圆心区 0.5×0.5）仍以走为主。
  - **所有时长/距离/转向/概率参数集中在 `src/data/creatureBehavior.js` 的 `BEHAVIOR_PROFILES` 表**（小鸡/成鸡/史莱姆三套预设 + 通用默认），逻辑层不写死数值；实例可用 `behaviorOverride` 临时覆盖（测试/特殊个体）。
  - 只被栅栏边界裁剪（圆心 + 半径不出栅栏），生物之间不碰撞、允许完全重叠。小鸡长大半径 `1/6 → 0.25` 时圆心立即夹回合法区并重置为 `Idle`。
  - **静止不刷 DOM**：`Idle` 时 `renderPos` 对齐 `pos`，`CreatureView` 缓存上次 `transform` 字符串，位置未变则不写样式（`advanceCreatureRendering` 对 Idle 也直接跳过位移）。

---

### 2.6 MapView 单格地块视觉层级（UI 实现）

> 对应设计文档 §16.3「单格地块的视觉层级」。只影响 UI 呈现，不改任何物品/地形效果逻辑。

- **层级自底向上**：
  1. 几何边框/底色：`tileEl` 本体，100%（中性底色 `#f5f0e1`，只负责让人看出这是一格）。
  2. 地形背景层 `.tile-terrain-bg`：边长 `TERRAIN_FILL_SIDE = 0.975`，即面积约 95%，居中铺开；素材走 `Assets.getIcon('terrains', id)`，有 PNG 用 `background-image`，无 PNG 回退地形底色。**地形不再画成右下角小图标**（旧实现的 `tile-terrain` 小图标正好占用了放置型道具标志的槽位，是本次修正的根因）。
  3. 地块内容图标 `.tile-content`：~60~70%，居中，`z-index: 2`。
  4. 角色图标：MapView 根层 `player-avatar`（`z-index: 10`），居中。
  5. 放置型道具标志 `.tile-flags` / `.tile-flag`：`z-index: 3`，贴右下角、沿底边向左。
- **标志数据驱动**：只读 `tile.contentState.placedItems`，按 `POTIONS[itemId].useEffect.type` 以 `placed_` 开头（或显式 `placement === true`）判定「放置型道具」，不写死 `item_trap` / `item_incense`；新增放置型道具自动出标志。
- **排列与尺寸**：容器 `right/bottom` 贴边 + `flex-direction: row-reverse`（第一个标志在右下角，后续向左）；单个占比 `clamp(0.20 / max(1, n*0.5), 0.06, 0.20)`，1 个时接近 20%，数量增多逐步缩到 6% 附近，互不重叠且不溢出格子。
- **覆盖层不被遮挡**：技能高亮（`tile-hl-red/gold/gold-flash` 的 outline + 外发光）、受祝福边框（`.blessed-tile`）、道具指向高亮（`.tile-aim-ok`）都是地块自身的 outline / box-shadow 覆盖样式，绘制在子层之上。
- **栅栏内地块同一口径**：有地形时同样渲染 `.tile-terrain-bg` 背景层，不再画中心小图标。
- **验收**：`node tools/smoke-ui.mjs` 的「§16.3 地块视觉层级」用例（地形面积占比、标志顺序、不重叠、无道具无标志、新增 placed_ 数据自动出标志）。

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
    x: 0,                      // 外圈格索引 0~(2rows+2cols-5)（初始 3×3 为 0~7），左下家的位置
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
    // 新开局只写 size/fenceRowCols；rows/cols/fenceRows/fenceCols 在首次扩建时写入，
    // 读取一律经 Distance.mapDimsOf / fenceDimsOf（缺字段回退 size / fenceRowCols）
    rows: 3,                   // 行数（= 设计文档“宽度”）；扩建 II 型 +1
    cols: 3,                   // 列数（= 设计文档“长度”）；扩建 I 型 +1
    size: 3,                   // 兼容字段：初始 3，扩建后 = Math.max(rows, cols)
    outerTiles: [],            // 外圈格数组，长度 2rows+2cols-4；每格 { idx, terrain, terrainAmount, contentId, states: [], dailyFlags: {} }
    fence: [],                 // 栅栏内网格，fenceRows × fenceCols；每格 { row, col, terrain, terrainAmount, creatures: [], items: [] }
    fenceRows: 1,              // = rows - 2（栅栏内行数；原点恒为网格 (1,1)）
    fenceCols: 1,              // = cols - 2（栅栏内列数；线性索引 = row*fenceCols+col）
    fenceRowCols: 1,           // 兼容字段：初始 = size - 2；扩建后 = fenceRows
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
                               //   radius,                            // 圆半径（米，1 格边长 = 1 米），小鸡 1/6 / 鸡·史莱姆 0.25
                               //   pos: {x, y},                       // 连续逻辑坐标（判定权威；可任意小数）
                               //   renderPos: {x, y},                 // 渲染插值位置（表现层写，不参与判定）
                               //   dir,                               // 朝向弧度（任意方向，非四方向）
                               //   speedPerTile,                      // 秒/格，区间 3~6（小鸡 3.0 / 鸡 4.2 / 史莱姆 5.0）
                               //   behaviorState, stateLeft,          // 'idle' | 'walk'；当前状态剩余秒数
                               //   targetPos, idleTurnLeft }          // 行走目标点 / 下次小幅转头倒计时（秒，非墙钟）
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
  
  // === 建造模式（设计文档 v0.5 §16.14） ===
  // 写入点唯一：BuildSystem.applyMode（enterBuildMode / exitBuildMode / forceModeByStory）。
  // 玩家侧只有「建造图标按钮（FuncBar）」与「Tab（InputManager）」两条切换途径；
  // 打开 / 关闭任何页面或面板都不得改变该字段；读档与旧档迁移只在会话边界复位为 false。
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

---

## 八、技能结算流水线（SkillResolve，阶段 3 已接线）

> 对应《空间碰撞与时序方案》§2.8（judgeMode）、§3.2 ⑦c、§3.5、§3.6、§12.3。
> 实现：`src/systems/SkillResolve.js`；接线：`SkillSystem.fireOneSkill` / `LinkSkillSystem.resolveLinkSkill` / `TurnSystem` 燃烧 tick。

### 8.1 judgeMode —— 每个技能必填，禁止混合模式

技能定义（`src/data/characters.js`）必须声明 `judgeMode: 'tile' | 'target'`：

- `tile` 型额外声明 `anchor` + `areaShape`（+ `circle` / `line` 的 `areaRadius`）；
- `target` 型只声明 `targetCount` / `targetSelection`（默认 `nearest`）。

`judgeModeOf(skill)` 缺失 / 非法直接抛错（不做兜底猜模式）；`validateSkillJudgeModes()` 返回 `{ total, tile, target, issues }` 供数据巡检与冒烟。

当前 20 条技能：**target 15 条 / tile 5 条**（tile = 开拓、爆炸狂欢、合纵连横、焚灭、风暴眼）。

### 8.2 结算作用域：一次结算一份快照

```js
import { createSettlement, commitSettlement, registerDamage } from '../systems/SkillResolve.js';

const settlement = createSettlement(gs, { skillId, instanceKey, phase, roleId, attackerRoleId });
// settlement = { snapshot, batch, deathQueue, friendlyAsEnemyToday, committed }
const targets = skill.areaShape === 'circle'
  ? circleTargetsOf(settlement, skill, anchorPoint)           // 圆-圆重叠（只读 snapshot）
  : tileTargetsOf(settlement, skill, tileRefs);               // 地块集合 + 碰撞框（只读 snapshot）
registerDamage(settlement, targets, { multiplier, element, hits, key });
commitSettlement(settlement);   // batch.commit() → deathQueue.flush()
```

- 结算入口先 `snapshotGeometry(gs)`，整批判定（距离 / 覆盖 / 索敌 / 范围）只读该快照；
  快照不跨回合、不跨帧复用（每次技能触发 / 连携技 / 回合 tick 各自新建）。
- HP / buff 等状态按最新值读取（集合先定，效果后算）。
- `settling` 只存在于同步结算调用栈内；本模块不持有异步状态，不延伸进动画 / 飞字 / 面板。

### 8.3 tile 流水线

`tile` 型按形状分两种命中口径；命中集合最终都登记进同一个 EffectBatch → commit → flush。

| 形状 | 命中口径 |
|---|---|
| `circle` | **圆-圆重叠**：`dist(锚点, 生物中心) ≤ areaRadius + 该生物 radius`（取等命中，单位：米）。锚点为生物时取其**连续中心点**，不吸附格心；**不枚举地块**，斜对角格里的生物只要碰撞圆伸进半径圆同样命中，圆完全不接触则不命中 |
| `rowColumn` | 技能所在外圈格 → 栅栏行 + 列；贴外圈时越界轴自动略去；再按碰撞框取格内生物 |
| `row` / `column` | 锚点所在行 / 列的地块集合；再按碰撞框取格内生物 |
| `line` | 地块中心点到线段（玩家格中心 → 锁定目标中心）距离 ≤ `areaRadius`（线带半宽，单位：米）；再按碰撞框取格内生物 |

长度单位统一为**米**（1 格边长 = 1 米），`areaRadius` / `tier1Radius` / `tier2Radius` 的数值即米数。

`circle` 型命中集合由快照条目保证按生物实例唯一；`row / column / rowColumn / line` 的跨两格生物由 `creaturesInTiles` 按实例去重；`EffectBatch` 键对两类都做二次兜底，不叠伤害。

口径变化（相对旧实现）：`circle` 不再按格枚举，改为圆-圆重叠（爆炸狂欢半径 1 米，贴边的斜对角生物也可能命中）；`开拓 0.3 米` 同样走圆-圆重叠。

### 8.4 target 流水线

- 参照点：主动技能 = 技能所在地块中心；连携技 = 实例所在地块中心（§12.3）。
- 未明确索敌的技能一律 `nearestCreatureTo` 语义：中心点直线距离最近存活敌人，并列按栅栏格线性下标升序、再按实例 id；
- 明确「随机」的（风止、风暴眼锁定）保留随机；
- 明确集合的（炽燃 = 燃烧集合内最近 3、弱点击破 = 蓄力集合内最近）先定集合并按距离排序；
- 方位（左侧 / 右侧）= 比较生物**中心点 x**（`isSourceLeftOfTarget`），不用格索引 / 行列入参；
- 圆-圆接触（追猎弹射）：`dist(圆心, 锚点) ≤ 半径 + 该生物半径`。

### 8.5 死亡延迟改造点（阶段 3）

| 位置 | 改造 |
|---|---|
| `SkillSystem.fireOneSkill` | 删除 `defeatCreature`；击杀由 `EffectBatch.commit()` → `deathQueue.markDead()`，`commitSettlement` 统一 `flush()` |
| `LinkSkillSystem.resolveLinkSkill` | 删除 `dealLinkSkillDamage` 的即时删除与掉落；同一批次 commit + flush |
| `TurnSystem.advanceTurn` 燃烧 tick | 遍历 `gs.creatures.slice()`，hp 归零只 `markDead`，循环结束后 `flush()`（修复遍历中途删对象导致的漏算 / 重复掉落） |

### 8.6 验收

`node tools/smoke-skill-geometry.mjs`：80 条断言，覆盖行/列跨两格只结算一次、两格命中不叠加、相邻两格各一只都命中、circle 圆-圆重叠（斜对角近端命中 / 远端不命中 / 边界取等命中 / 多格不重复）、line 与行列车仍按地块集合、最近敌人与并列次序、方位按中心点 x、批次中途死亡后续分组跳过 + 掉落一次、`SkillSystem` / `LinkSkillSystem` / 回合 tick 三条真实接线、judgeMode 全覆盖（20 = 15 + 5）与非法定义抛错、爆炸狂欢参数锁定（倍率 1.5 / 命中 3 / areaRadius 1 / 死配置已删 / 文案为「半径 1 米」）。

---

## 九、阵营合法性与目标选择

> 实现：`src/data/factions.js`（唯一真相源）+ `SkillResolve.enemyPool`（几何/结算层第一层过滤）。
> 数据：`characters.js` 的 `targetSide` / `ignoreFaction`；`creatures.js` 的 `category`。

### 9.1 三个阵营

| 阵营 | 代表 | 说明 |
|---|---|---|
| `party` 我方 | `gs.player` **共用实体** | 不会变成场上多个带 hp / 坐标的实体。生命、攻击力等属性完全共用；不同角色只体现在**技能倍率与技能归属者**。通用技能（`roleId: null`）的归属者视为「我方角色」。外圈使用余默模型只是 UI 表现，不影响战斗数据 |
| `friendly` 友善 | 小鸡 / 鸡 | **不攻击、不追人**；也不会被默认索敌选中 |
| `hostile` 危险 / 高危 | 史莱姆等 | **不会普通攻击**；若其拥有「攻击倾向的技能」，则按该技能自己的逻辑使用技能进行攻击 |

敌对关系矩阵（`factions.js` 的 `HOSTILE_TO`）：

```
party    → hostile
hostile  → party
friendly → （无）
```

判定函数：`factionOf(entity)`（显式 `faction` 优先 → `category` → 有 `kind` 的生物按 hostile → 其余按 party）、`isHostileTo(attacker, target)`。

### 9.2 两层过滤顺序

技能选目标固定为**先阵营、后几何/条件**：

1. **阵营过滤**：`enemyPool(snapshot, { attackerFaction = 'party' })` 只保留 `isHostileTo` 为真的生物。
   - 我方技能 → 只可能选中危险 / 高危；**友善生物默认永远不在池内**。
   - 危险 / 高危的技能（预留）→ 只可能选中我方共用实体，不攻击友善生物。
2. **距离 / 随机 / 条件集合**：最近 N、随机 N、燃烧集合、蓄力集合等都在第一层结果上做。

默认索敌（最近敌人）与阵营过滤的衔接：`selectSkillTargets` → `selectNearestEnemies` → `enemyPool`（先过滤再排序），因此「最近的友善生物」不会被误选。

`tile` / `circle` 流水线同样先取 `enemyPool` 白名单再与地块/圆范围求交，不会因范围覆盖到友善生物而命中。

### 9.3 `targetSide` / `ignoreFaction`

| 字段 | 取值 | 语义 |
|---|---|---|
| `targetSide` | `'enemy'`（默认） | 只选阵营合法的敌方生物 |
| | `'self'` | 自身 / 我方共用实体，不选生物目标（鼓舞、屏息瞄准、汲取） |
| | `'ally'` | 我方共用实体；当前与 `self` 等价（我方不按角色拆分实体） |
| `ignoreFaction` | `true` | **【不分敌我】**：该技能不受阵营过滤限制 |

`targetSide !== 'enemy'` 的技能在没有敌人时也会正常触发（不再被「无合法目标则 return」挡住）；`enemy` 技能保持「无阵营合法目标不触发、不空放冷却」。

治疗 / 增益类（鼓舞、屏息瞄准、汲取）走 `targetSide: 'self'`，直接作用于共用的 `gs.player` / `gs.team`，不会被「敌人过滤」误伤。

### 9.4 「生物对角色造成伤害」的正规条目

| 来源 | 时机 | 数值口径 | 伤害类型 | 现状 |
|---|---|---|---|---|
| 危险 / 高危容量超载惩罚 | **每一日开始时**（`CreatureSystem.dailyTick` → `updateCapacityAndPunish`） | 该类型**全部存活生物**逐只结算一次，每只 = **100% 当前攻击力**（实例运行期 `c.atk`，含增益 / 减益后的瞬时值；不是种族面板基础值） | **真实伤害**（`CombatSystem.applyTrueDamageToPlayer`，每只一条独立结算事件） | 已实现。警告期 2 天，第 2 次结算仍超载即进入超载期；超载期间每日对**该类型所有生物**各扣一次 |
| 史莱姆【粘液喷吐】 | 每一日开始时，5%（危险超容量时 15%） | 对随机 1 格施加【粘液】debuff | 非直接伤害 | 已实现，**只作用于地块**，不造成伤害；也没有目标选择，不经过阵营过滤 |
| 玩家踩上【粘液】格 | 移动并停留在该格时（`MovementSystem`） | hp **-5**、行动力 -1，随后移除 | **真实伤害**（`applyTrueDamageToPlayer`，reason `slime_hit`） | 已实现。属于**地块 debuff 结算**，不是生物命中判定 |
| 生物普通攻击 | — | — | — | **不存在**：生物 `atk` 只被上述超载真伤消费 |
| 生物攻击型技能 | — | — | — | **目前没有任何生物攻击型技能生效**：史莱姆粘液只作用于地块；`creatureBehavior.js` 只做移动；全代码库没有「生物对角色结算技能伤害」的入口 |

> 口径（2026-11-07 裁定）：某类型超容量并进入超载期后，**该类型的所有生物**各自结算一次真伤，
> 不再只算「超出容量上限的那几只个体」；每只按 100% **当前攻击力**（含增益 / 减益）独立结算，
> 多只即多次独立结算（各自一条 `DAMAGE_TAKEN` 事件，携带 `creatureId`）。

### 9.5 伤害类型口径

- 未特殊说明的一律为**常规伤害**（走 `CombatSystem.calculateDamage` 完整结算：暴击 / 闪避 / 易伤 / 元素免疫）。
- 元素未说明则默认**物理**（`element: 'physical'`）。
- **真实伤害必须在技能描述中明确写出**；当前 20 条技能**没有**任何真实伤害技能（`realDamage` 未在技能数据中使用）。
- 核对结论：现有代码不存在把普通技能伤害错判成真实伤害的分支（20 条技能均未使用 `realDamage`）。
- 文案待补：地块【粘液】是真实伤害，但 `buffs.js` 描述仍写「生命 -5」，未写明「真实伤害」。
  该文案由物品库生成（`generated/library.js` + `check-text.mjs` 锁定），本轮不改生成物，记录待办。

### 9.6 【不分敌我】（未来词条）

【不分敌我】词条**存在**于设计口径：出现时该技能不受阵营过滤限制（可命中友善生物 / 我方）。
当前技能库中为 **0 条**；代码已预留 `skill.ignoreFaction = true` 通路（`enemyPool` 直接放行），暂无数据使用。

### 9.7 验收（`tools/smoke-faction.mjs`）

- 友善生物不会被任何默认技能选中（主动技能 + 8 条连携技逐条）；
- 我方共用实体不会进入快照、不会被自己的技能打死；
- 自身技能（鼓舞 / 屏息瞄准）在**没有敌人**时也能触发；
- 危险 / 高危生物的阵营只能指向我方，不会指向友善；
- 【不分敌我】当前技能库计数为 0。
