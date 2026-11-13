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
│   ├── events.js             # 事件节点表 EVENT_DEFS（选项驱动 / 多级状态机数据源）
│   └── terrains.js           # 4 种地形定义
├── systems/                  # 游戏逻辑系统（读取/修改 GS，触发 EventBus）
│   ├── GameDirector.js       # 主循环导演（回合制 + 连携技实时窗口）
│   ├── InputManager.js       # 键鼠输入统一监听 + 路由
│   ├── TurnSystem.js         # 回合推进 + 行动力扣减 + 心力交瘁（onTurnStart 唯一触发点）
│   ├── DaySystem.js          # 每日开始事件 + 每日限次重置
│   ├── FieldEffects.js       # 田块通用工具：数量统计 / 四方向连通块 / 仓廪实视同 / 庆丰收・黄金浪・春光好取数
│   ├── MovementSystem.js     # 移动（WASD）+ 经过/进入触发
│   ├── BlessSystem.js        # 祈福（按下即结算：2 行动力 + 1 金币 + 随机祝福；动画仅演出）
│   ├── InventorySystem.js    # 背包 + 出货箱 + 快捷栏 + 拖拽放置
│   ├── GoldSystem.js         # 金币唯一写入口：区间 [-999999, 999999] 统一夹取 / 允许负债
│   ├── CropHarvest.js        # 拆除 / 替换储存类·采摘类地块内容（含鸡舍存蛋）前的统一自动采摘
│   ├── CombatSystem.js       # 伤害计算 + 闪避 + 元素免疫 + 范围
│   ├── SkillSystem.js        # 技能触发（进入时/经过时/受祝福时）
│   ├── LinkSkillSystem.js    # 连携技（解锁检测 + 8 秒窗口 + 队列）
│   ├── RealtimeClock.js      # 统一实时时钟（200ms 逻辑步 + 渲染插值 + 结算快照冻结）
│   ├── CreatureSystem.js     # 生物连续积分移动（3~6 秒/格）+ 投喂 + 成长 + 心情
│   ├── CapacitySystem.js     # 容量上限即时同步（栅栏面积 → 友善/危险上限 +1/格）
│   ├── EventEffects.js       # 事件选项结算唯一入口（金币/物品/行动力/治疗/地形/buff/生物）
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
│   ├── DialogBox.js          # 确认弹窗（含剧情跳过确认，z 9100）
│   ├── StoryUI.js            # 剧情区 + 选项区（§18.2，z 5700/5750，结果态不改层级）
│   ├── ConfirmAction.js      # 统一二次确认状态机（arm/disarm/trigger + 快捷键绑定）
│   ├── Toast.js              # 中央弹窗提示（物品+1、心力交瘁等）
│   └── styles/
│       ├── base.css          # 重置 + 字体 + 基础变量
│       ├── map.css           # 地图 + 地块样式
│       ├── panels.css        # 面板通用样式
│       ├── hotbar.css        # 快捷栏样式
│       ├── story.css         # 剧情区 + 选项区样式
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
  
  // hook 类型（常量，以 HookDispatcher.HOOK_TYPES 为准）
  // 'onEnter'      —— 角色进入该格（最终停留）
  // 'onPass'       —— 角色经过该格（路径上所有格 + 最终格）
  // 'onBlessed'    —— 该格被挂上祝福状态
  // 'onTurnStart'  —— 回合开始时（TurnSystem.advanceTurn：turn+1 之后、
  //                   buff tick / 冷却递减 / 心力交瘁判定之前，每次推进只 fire 一次）
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
  BLESS_START: 'player:blessStart',
  BLESS_DONE: 'player:blessDone',       // 结算完成（祈福按下瞬间触发）
  BLESS_FINISH: 'player:blessFinish',   // 动画结束（只解锁 blessing，不再结算）
  
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
  MAP_EXPANDED: 'map:expanded',         // 农场扩建完成（payload: {gs, axis, rows, cols, idxMap, remap}），UI 需全量重排
  
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

  // —— 剧情 / 事件（§16.5）——
  STORY_SHOW:  'story:show',            // payload: {script, ctx}
  STORY_START: 'story:start',           // payload: {id, title}
  STORY_NODE:  'story:node',            // payload: {id, nodeKey}
  STORY_END:   'story:end',             // payload: {id, reason}
  
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
3. **逻辑位置 vs 渲染位置**：`pos` 是判定权威位置，只由「速度 × 时间」连续积分推进；`renderPos` 是表现层插值位置，只在「上一步 `pos` → 当前 `pos`」之间插值（不独立模拟、不超前）。结算冻结（主动技能/回合结算）只冻结 `pos`（用 `snapshotGeometry()` 捕获），插值在最后一段内收敛后保持不动，画面不漂移、不回拉（见 §2.5）。
4. **默认索敌（全项目统一）**：任何未明确写索敌对象的技能，一律选**最近的敌人**（圆心到圆心直线距离），即 `nearestCreatureTo(gs, point)` 默认语义（`enemiesOnly: true` + 存活判定）。

### 2.4.1 MapExpandSystem（农场扩建）

```js
// src/systems/MapExpandSystem.js
EXPAND_AXIS = { LENGTH: 'length', WIDTH: 'width' }   // 长度=列数+1，宽度=行数+1
expandMapInPlace(gs, axis)   // 原地扩建，返回 { ok, axis, before, after, playerFollowed, idxMap, remap }
expandMap(gs, axis)          // 同步容量上限并广播 GE.MAP_EXPANDED（不写日初基线）
getLastExpandRemap()         // 最近一次扩建的旧→新映射（只读查询，不入存档）

// remap 形状（expandMapInPlace 返回值与 GE.MAP_EXPANDED payload.remap 同构）
{
  axis, before: {rows, cols, fenceRows, fenceCols}, after: {…},
  outerIdx:  Map<旧外圈 idx, 新外圈 idx>,  outerIdxInv: Map<新, 旧>,
  fenceIdx:  Map<旧栅栏线性 idx, 新>,       fenceIdxInv: Map<新, 旧>,
  fenceRow:  Map<旧栅栏 row, 新 row>,       fenceCol: Map<旧 col, 新 col>,
  addedOuterIdx: number[],                  addedFenceIdx: number[],
}
// 便捷键：payload.idxMap === payload.remap.outerIdx（旧外圈 idx → 新 idx）
```

**实现口径（权威，对应设计文档 §2.1.1）**：

- **方向固定，不做玩家选择**：I 型（`item_farm_expand_length` / `expand_map_length`）恒向右扩 1 列；II 型（`item_farm_expand_width` / `expand_map_width`）恒向上扩 1 行。
- **I 型（列 +1）**：原最右列（`x = cols-1`）整体右移 1 格到 `x = cols`，腾空的 `x = cols-1` 生成新列——上下端为外圈格，中间为栅栏格；`fenceCols + 1`，新栅栏列追加在末尾。
- **II 型（行 +1）**：原最上行（`y = 0`）保持，`y ≥ 1` 整体下移 1 行（`y → y+1`），腾空的 `y = 1` 生成新行——左右端为外圈格，中间为栅栏格；`fenceRows + 1`（旧行下移、新行插在最前），栅栏格行索引 `+1`。
- **跟随规则**：角色恰好站在被移动地块上时随之平移（`player.x/y` 同步重算），该位移**不视为移动**，不触发任何技能/地块效果。
- **内容保留与索引重映射**：重建 `map.outerTiles` 时按新的环形顺序排布，地块对象（含 `contentId / contentState / terrain / states / dailyFlags`，即设施、资源、技能卡、地形与商店状态）随「同一块地」搬到新 idx；并产出完整 `remap`（外圈 `outerIdx`、栅栏 `fenceIdx`、栅栏 `fenceRow/fenceCol`，含反向表与新增格列表，见上）。扩建同时重映射扩建自己持有的裸索引引用：`player.x`（角色/载具所在格，跟随不视为移动）、`player.visitedTodayIdx`、`creatures[].pos/renderPos/targetPos/renderFrom` 与主格缓存 `row/col`（II 型世界原点下移 1 行）、`fence[].creatures` 缓存（统一存生物 id）、`linkSkillCounters` / `linkSkillCooldowns` 的 `tileIdx|skillId` 键、连携队列的 `tileIdx`/`key`、`uiState.selectedTileIdx`、生物归属 `creatures[].sourceTileIdx`。
- **归属稳定化（配合 CreatureSystem）**：重映射 `sourceTileIdx` 时同步补 `sourceTileUid`（= 目标地块 `tile.uid`，缺失则生成 `tile_exp_*`）；消费方优先按 uid 判归属，因此扩建后鸡舍/史莱姆屋的归属生物不会退化成野生，且订阅方不会对同一份映射二次重映射。其它系统按裸索引保存位置的引用（如 UI 面板的 `currentTileIdx/currentFenceIdx`）应订阅 `GE.MAP_EXPANDED` 并使用 `payload.remap` 自行重映射，扩建侧不改其文件。
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
- **逻辑步顺序（设计文档 §18.3）**：① 连携窗口过期 `pruneExpired` → ② 条件扫描 `periodicConditionScan` → ③ 生物连续积分 `stepCreatures` → ④ 移动后的地块效果（啃草）→ ⑤ 一次性广播（仅地块内容真的变化时 emit `TILE_UPDATED`，逐帧移动本身不广播；地形被啃空时另行 emit 带索引的 `TILE_TERRAIN_CHANGED`）。
- **已合并的旧定时器**：`GameDirector` 的 1000ms 连携轮询、`CreatureSystem` 的 1000/2000ms 生物移动、`LinkSkillUI` 的 200ms 进度计时器全部移除。连携窗口 UI 改为 `clock.onFrame()` 订阅，每帧推进外圈计时环；8 秒窗口仍由 `LinkSkillSystem` 用 `Date.now()` 判定，`WINDOW_MS = 8000` 与到期事件（`triggered:false`）不变。
- **连携窗口计时环实现（`src/ui/LinkSkillUI.js`）**：窗口边界用 SVG `<circle>` 画白色圆环（`stroke-dasharray` 长度 = 剩余比例 × 周长，`rotate(-90°)` 从 12 点钟起画），只有队列第一位计时、弧长在 8 秒内按逆时针回收，排队条目恒为满圈。环画布与 72px 窗口等大（`viewBox 72×72`），白色环宽 6px 画在边界内侧，外径 = 窗口直径、正好压在窗口可视边界上，无外扩无缝隙；窗口底板无外边框并 `overflow:hidden` 裁在环内，序号角标、图标与技能名都收在环内侧。该更新只读 `expireAtMs` 与 `Date.now()`，不改队列、冷却、解锁与到期逻辑。
- **渲染插值**：`stepCreatures` 每步把步前的 `pos` 记为 `renderFrom` 并重置 `renderT`；`advanceCreatureRendering(gs, dt)` 只在该步时长内做 `renderFrom → pos` 的线性插值（不再按 `dir` 独立模拟）。`MapView` 的 rAF 只读 `renderPos` 画像素，不写逻辑位置。两个端点都是同一次连续积分的合法位置，因此插值不越界、不漂移、不会在停机时"吸回 pos"；结算栈期间没有新逻辑步，画面停在当前 `pos`（毫秒级，不产生假位移）。
- **结算冻结边界**：`runSettlement` 必须同步调用，`settling` 只存在于毫秒级结算栈内；禁止延长到动画、飞字、淡出、面板打开期间。演出各自消费自己的快照，不持有 settle 锁。
- **运动模型（以走为主、偶尔停下的走走停停状态机，2026-11-07 修订）**：每只生物维护 `behaviorState = 'idle' | 'walk'`。
  - `Idle`：**真正静止**（`pos` 完全不变），时长为长站或短停二选一——走完一次后按 `shortPauseChance` 进短停，否则进长站；静止期间可按 `idleTurnChance` 发生一次小幅转头（`idleTurnMaxRad`），不产生位移。60s 采样静止占比目标：小鸡 30~40% / 成鸡 40~50% / 史莱姆 50~60%（Idle 只是"偶尔停一下"，不是常态）。
  - `Walk`：朝 `targetPos` 走，方向为任意弧度，按 `maxTurnRate`（弧度/秒）平滑转向（不会瞬间反向）；速度 `speedPerTile` 单位为**秒/格**（3~6）；到达 `arriveEps` 后按 `chainWalkChance` **立刻接下一段**（连续多段位移后再停）或回 `Idle`；安全超时同样走该分支。
  - 目标点：常规走 `walkDistMin~Max` 格、方向沿当前朝向 ± `walkAngleJitter`；按 `longWalkChance` 偶尔换成全随机方向的 `longWalkDistMin~Max` 长走。距离取 `min(期望距离, 该方向射线到栅栏内边界的可达距离)`——目标永远在合法区内且可达，不再出现"目标夹到墙上、每一步都推不动"。
  - **连续速度积分（禁止瞬移 / 禁止吸附，2026-11-07 观感修订）**：实例维护速度向量 `vx/vy`（格/秒）。Walk 每步只做 `pos += v × dt`：`integrateMotion` 沿速度求「到栅栏内边界的时间」，最多走到边界**接触点**即停止，绝不允许越过边界再被 `clamp` 覆盖（那就是肉眼看到的"瞬移/被吸住"）。单步位移恒 ≤ `速度 × 200ms`。
  - **撞墙真实回弹 + 回弹后重决策**：撞到任一面栅栏的那一步，位置停在边界内侧接触点；速度按法线反射并衰减（法线 × `bounceRestitution`，切向 × `bounceTangentialKeep`），进入 `bounceS` 秒回弹（速度按 `bounceDamping` 指数衰减）。回弹结束（或速度已不可见）后**再做一次**二选一决策——① 按 `wallHitIdleChance` 进 `Idle`；② 换成满足 `wallFreeDistance = max(wallFreeMinDist 0.5 格, wallFreeHorizonS 1.5s / speedPerTile)` 的新方向。
    - `lastWallDecision`：接触当步为 `'bounce'`，回弹结束后变为 `'idle' | 'walk'`；测试断言要求「每次撞墙必先回弹，且在 bounceS+1 个逻辑步内完成决策」。
    - 候选方向在 0~2π 全角度采样（先试朝合法区中心），不限于上下左右；采样不到可行方向 → 直接进 `Idle`，并按 `wallFailExtraIdleS` 随连续失败次数延长静止（最多叠加 3 次）。
    - 任何时刻不允许"`Walk` 却零位移"；撞墙/回弹全程圆心都在合法区内。计数器 `wallHits` / `lastWallDecision` 只用于测试断言，不参与玩法。
  - **平滑起步 / 平滑停车**：Walk 的速度大小按 `startAccelS` 从当前值平滑加速到巡航速度（回弹后恢复也走这条路，不瞬跳）；进 `Idle` 时按 `stopDecelS` 线性刹车到 0，刹车期间位置仍连续积分（允许刹停后 `brakeLeft > 0`），不会速度瞬间归零。
  - **窄栏加成**：合法圆心区跨度小于 `narrowPenRefSpan`（1.5 格）时 Idle 按比例缩短（下限 `narrowPenIdleMinScale` 0.55），保证 1×1 栅栏（合法圆心区 0.5×0.5）仍以走为主。
  - **所有时长/距离/转向/概率参数集中在 `src/data/creatureBehavior.js` 的 `BEHAVIOR_PROFILES` 表**（小鸡/成鸡/史莱姆三套预设 + 通用默认），逻辑层不写死数值；实例可用 `behaviorOverride` 临时覆盖（测试/特殊个体）。
  - 只被栅栏边界裁剪（圆心 + 半径不出栅栏），生物之间不碰撞、允许完全重叠。小鸡长大半径 `1/6 → 0.25` 时圆心立即夹回合法区并重置为 `Idle`。
  - **静止不刷 DOM**：刹停后 `renderPos` 已收敛到 `pos` 并不再变化；`CreatureView` 缓存上次 `transform` 字符串，位置未变则不写样式（逐帧插值只在有逻辑位移的步内产生 5 帧小位移，停下后完全不写）。

**放牧进食与设施开关门（2026-11-07）**：

- **草食限定与每日上限**：`consumeGrassOnEnter(gs, creature, fenceCell)` 先按数据标记 `feedByGrass` 判定物种，**只有小鸡 / 成鸡会吃草，史莱姆等非草食生物直接返回 `false`、不扣任何元素量**。草食生物用实例字段 `grassFedDay` 记录当日已消耗的日号，每只每日至多扣 1 点草元素量（`GRASS_ELEMENTS_PER_CREATURE_PER_DAY`），当日达成（含日初 `lastFed=true`）后跳过，跨日自动重置；扣减直接改 `fence[].terrainAmount`，不走背包。元素量归零时地形写 `terrain_none`，并 emit `TILE_TERRAIN_CHANGED { row, col, fenceIdx }` + `FENCE_TILE_UPDATED`，MapView 只就地重绘该格地形背景，不再依赖无索引 `TILE_UPDATED` 兜底。
- **归属键（扩建安全）**：主键为设施实例稳定 uid `creature.sourceTileUid`（`ensureTileUid(tile)` 就地分配，地块对象被扩建搬运时 uid 不变）；`creatureOwnedByTile(gs,c,tile)` / `creatureOwnerTile` / `facilityOwnedCreatures` 统一走该判定，裸索引 `sourceTileIdx` 仅作旧存档回退。`spawnCreature` 写入 `sourceTileIdx` + `sourceTileUid`，狩猎等野生来源两者皆空。`CreatureSystem` 在模块加载时订阅 `MAP_EXPANDED`：若事件带 `idxMap` 则直接复用，否则按 `axis` + 扩建后 `rows/cols` 反推旧尺寸与搬运规则（最右列右移 / 最上行上移）生成映射；对生物重映射 `sourceTileIdx` 并给旧生物补 `sourceTileUid`，同时把 `fence[].creatures` 缓存统一修正为 id 数组。连续多次扩建幂等（uid 命中即跳过）。
- **开关门**：`setFacilityDoorOpen(gs, tileIdx, open)`（仅 `DOOR_FACILITIES`：鸡舍 / 史莱姆屋）。关门对归属生物置 `housed=true`、移出 `fence[].creatures` 缓存、速度与行为状态清零；开门随机放回 `fenceInner(gs, radius)` 合法区并重建主格缓存。`stepCreatures` / `advanceCreatureRendering` / `CreatureView.paint` / `Geometry.isAlive` 全部跳过 `housed`，所以收纳生物不可见、不移动、不参与空间查询与命中；`gs.creatures` 不删，容量统计（`countByCategory`）与归属不变。门状态存于 `tile.contentState.doorOpen`（缺省视为开门）。开关门不消耗行动力、不占回合。
- **关门期间新生成**：`spawnCreature` 末尾检查来源设施 `doorOpen === false` 时直接 `housed`（如史莱姆屋每日生成），不再落进栅栏可见区。
- **粘液**：`dailyTick` 喷吐前检查目标格 `states` 是否已有 `type='slime'`，有则跳过（同名不叠加，一格至多 1 层）；玩家进入后由 `MovementSystem` 结算生命 -5 / 行动力 -1 并立即移除。信息区「状态」行按物品库 `GLOSSARY` 词条逐字展示含义，一次性状态不显示「持续」。
- **生物类设施拆除 / 替换清理（2026-11-07）**：统一入口 `CreatureSystem.removeCreaturesOwnedByTile(gs, tile, { reason })`，**不写死设施 id**，按 `creatureOwnedByTile`（uid 优先、裸索引回退）筛出该地块实例归属的全部生物（含 `housed` 收纳中的）；先把 `fence[].creatures` 缓存统一收敛为 id 数组并剔除被删 id，再从 `gs.creatures` 删除，实例标记 `hp=0 / dead=true / housed=false`。随后按 `getCreatureDef(kind).category` 聚合发 `GE.CAPACITY_CHANGE { category, newCount, reason }`（容量条 / TopBar 实时重绘），并对每只生物发 `GE.CREATURE_DEFEATED { creature, source, noReward: true }`。**不调用 `PendingDeathQueue`、`grantKillDrops`、`onCreatureDefeated` 钩子**，因此没有金币 / 物品 / 经验，也不走击杀结算。野生生物 `sourceTileUid` 与 `sourceTileIdx` 皆空，判定为无归属，不受影响；非生物设施无归属生物，直接返回 `{ ok:false, removed:[] }`。接入点只有两个：`BuildSystem.placeContent` 的旧内容替换分支（`reason='facilityReplaced'`）与 `BuildSystem.clearContent` 清空 `contentId` 之前（`reason='facilityCleared'`）。UI 的拆除主路径是「替换」（`MapView._handleBuildTileClick` 与拖拽都走 `placeContent`），只经过一个入口，不会二次结算；若某生物已被 `PendingDeathQueue` 排入待死队列，flush 时按 `gs.creatures` 存在性判 `already-removed` 跳过，不重复发事件 / 掉落。幂等：无归属生物返回 `{ ok:false, removed:[] }`，空格拆除返回 `reason:'empty'`；渲染层 `CreatureView.paint` 每帧按 `gs.creatures` 对账，删除后 DOM 自动消失。

---

### 2.6 MapView 单格地块视觉层级（UI 实现）

> 对应设计文档 §16.3「单格地块的视觉层级」。只影响 UI 呈现，不改任何物品/地形效果逻辑。

- **层级自底向上**：
  1. 几何边框/底色：`tileEl` 本体，100%（中性底色 `#f5f0e1`，只负责让人看出这是一格）。
  2. 地形背景层 `.tile-terrain-bg`：边长 `TERRAIN_FILL_SIDE = 0.975`（按格子边长的**像素口径**计算，即 0.975 × tileSize），面积约 95%，以格子边界为基准居中铺开，相对格子中心偏移恒为 0；素材走 `Assets.getIcon('terrains', id)`，有 PNG 用 `background-image`，无 PNG 回退地形底色。**地形不再画成右下角小图标**（旧实现的 `tile-terrain` 小图标正好占用了放置型道具标志的槽位，是本次修正的根因）。
  3. 地块内容图标 `.tile-content`：~60~70%，居中，`z-index: 2`。
  4. 角色图标：MapView 根层 `player-avatar`（`z-index: 10`），居中。
  5. 放置型道具标志 `.tile-flags` / `.tile-flag`：`z-index: 3`，贴右下角、沿底边向左。
- **标志数据驱动**：只读 `tile.contentState.placedItems`，按 `POTIONS[itemId].useEffect.type` 以 `placed_` 开头（或显式 `placement === true`）判定「放置型道具」，不写死 `item_trap` / `item_incense`；新增放置型道具自动出标志。
- **排列与尺寸**：容器 `right/bottom` 贴边 + `flex-direction: row-reverse`（第一个标志在右下角，后续向左）；单个占比 `clamp(0.20 / max(1, n*0.5), 0.06, 0.20)`，1 个时接近 20%，数量增多逐步缩到 6% 附近，互不重叠且不溢出格子。
- **覆盖层不被遮挡**：技能高亮（`tile-hl-red/gold/gold-flash` 的 outline + 外发光）、受祝福边框（`.blessed-tile`）、道具指向高亮（`.tile-aim-ok`）都是地块自身的 outline / box-shadow 覆盖样式，绘制在子层之上。
- **栅栏内地块同一口径**：有地形时同样渲染 `.tile-terrain-bg` 背景层，不再画中心小图标；尺寸与定位基准与外圈格完全一致（同像素口径、同格心居中）。栅栏容器自身 4px 边框会让绝对定位子节点以 padding box 为基准，栅栏格的 `left/top` 已扣减该边框宽度，保证与外圈格落在同一逻辑网格上。
- **验收**：`node tools/smoke-ui.mjs` 的「§16.3 地块视觉层级」「§16.3b2 地形层基准一致」用例（地形面积占比、外圈/栅栏地形层相对各自格子偏移一致且像素尺寸相同、标志顺序、不重叠、无道具无标志、新增 placed_ 数据自动出标志）。

---

### 2.6.1 UI 实时刷新契约（2026-11-07）

> 用户默认契约：**几乎全部 UI 都必须实时更新**；不实时更新属于例外，需在设计文档显式说明。

- **触发链**：写入点改完数据后必须发「带索引」的专用事件；组件订阅该事件后就地重绘受影响的子节点。禁止「只在打开时渲染一次」或依赖玩家后续操作（移动 / 再点一次 / 重开面板）刷新。
- **地块内容**：外圈与栅栏内的新增/移除/替换/地形改变都必须发 `TILE_CONTENT_CHANGED` / `TILE_TERRAIN_CHANGED`（栅栏内带 `fenceIdx`）；`MapView` 只重建受影响格的 `.tile-terrain-bg` / `.tile-content` / `.tile-flags`，不整图重建，并复用 `TILE_UPDATED {terrainOnly|contentOnly}` / `FENCE_TILE_UPDATED` 广播给信息区、高亮、任务、连携技窗口。
- **裸索引缓存**：UI 里缓存的旧地块索引（`InfoPanel.currentTileIdx/currentFenceIdx`、`TileHighlight.headIdx`/瞬时高亮键）必须在 `MAP_EXPANDED` 中按 `payload.remap`（`outerIdx` / `fenceIdx` 正反映射）迁移，禁止扩建后继续用旧索引显示别的格子。
- **放置型道具的 3 条等价入口**：地块内容（facility_/resource_/skill_/terrain_）与放置型消耗道具（`useEffect.type` 以 `placed_` 开头）都必须支持三条等价路径：背包拖拽 → 落点松开、背包点选 → 功能选项「选择地块放置」→ 点地块、背包 / 功能区既有使用入口。拖拽与点选共用 `ItemTargeting.useAtTile` 的合法性判定、失败提示与结算（`useItem`），拖拽只增加输入路径，不改变可放地块 / 层数 / 消耗规则；非法落点（栅栏内、同名重复等）拒绝且不消耗道具。拖拽复用同一套指向模式（高亮 / 落点提示 / ESC 取消），放置成功后 `TILE_CONTENT_CHANGED` 驱动标志层、背包与信息区即时刷新。
- **验收**：`tools/smoke-ui.mjs` §17「UI 通用实时契约」的 `realtime()` 断言器——只改数据 + 发对应事件，不做任何额外操作，直接断言 DOM 已是新状态（覆盖顶部 HUD、信息区单位 tab、连携技窗口、编队、角色页、商店金币灰化、扩建索引迁移）；§16.23 覆盖放置型道具 3 条路径等价、非法落点拒绝不扣道具、放置后标志层 / 信息区即时刷新。

---

### 2.7 载具移动 / WASD 等价语义（2026-11-07）

> 对应设计文档 §7「WASD 在载具允许时等价于使用载具」。只收敛「走 1 格」的执行路径，不改载具数值。

- **唯一 1 格入口**：`MovementSystem.moveStep(gs, direction)` → `{ ok, finalIdx, byVehicle, blocked }`；
  `MovementSystem.move(gs, direction)` 仅作兼容包装（返回 `finalIdx | null`）。`GameDirector.move` 使用 `moveStep`。
  - 点击相邻格「前往」（无载具）仍换算方向后走 `director.move`，与 WASD 同一条入口。
- **载具三态判定**：`moveStep` 先取相邻 1 格 `stepIdx`（不含冰面滑行的多格路径），再调
  `VehicleSystem.canUseVehicleForStep(gs, stepIdx)` → `{ status: 'noVehicle' | 'allowed' | 'blocked', reason }`。
  **禁止用同一个 falsy 混同「无载具 → 徒步」与「载具不允许 → 拦截」**：
  - `noVehicle`：未装备载具（含次数耗尽自动卸下 / 主动卸下）→ 徒步正常结算；
  - `allowed`：`canVehicleReach` 允许落该格（同方向 / 同行列 / 射程 / `landFilter` 全部参与）→
    `VehicleSystem.tryMove(gs, { targetIdx: stepIdx, wasdStep: true })`，`byVehicle: true`；
  - `blocked`：已装备载具但不允许这 1 格（`landFilter` / 随机型 `movePattern='random'` /
    该方向无相邻格 / tryMove 未生效）→ `blocked: true`，`GameDirector.move` 收到后直接返回 `null`：
    不移动、不扣行动力、不推进回合、不记冷却、不扣次数、不卸载、不发 `MOVE` / `MOVE_BLOCKED` / `TOAST`、
    不触发任何钩子。
- **载具结算口径不变**：`wasdStep` 只把目标固定为这一格，后续仍走原有的路径模拟（本场景即最短路径 1 格）、
  `landOk`、消耗 1 次使用、终点 `firePassHookAt` + `fireEnterHooks`、`MOVE { byVehicle:true, distance, path }`。
  模拟路径只用于【经过时】判定与路径长度，不触发沿途地块/状态效果。
- **回合只推进一次**：`byVehicle` 的回合推进、`onMoveEnd`、天赋、`LinkSkillSystem.onVehicleMoved`（移形）
  全在原 `GE.MOVE` 订阅里完成；`GameDirector.move` 见到 `byVehicle` 直接返回，不再重复 `advanceTurn`。
- **徒步语义**：仅 `noVehicle`（未装载 / 次数耗尽已卸下 / 主动卸下）时 `moveStep` 走徒步：
  正常扣行动力、推进回合、发不带 `byVehicle` 的 `MOVE`；载具相关联动一律不触发。
  `blocked` 不做徒步兜底，整键拦截。
- **验收**：`node tools/smoke-wasd-vehicle.mjs`（载具 1 格 → 次数 -1 + 移形解锁；徒步 → 正常移动但不解锁；
  地形/落点限制、方向越界、随机型载具 → 位置/行动力/回合/次数/装备全不变且无事件无提示；次数耗尽后 → 徒步语义）。

---

### 2.8 StoryUI（剧情区 + 选项区，2026-11-08）

> 对应设计文档 §16.5 / §16.5.1。剧情与事件共用同一套 UI；UI 不写死任何文案。

- **文件**：`src/ui/StoryUI.js`（`StoryUI` 类）、`src/ui/styles/story.css`、`src/data/stories.js`、
  `src/data/events.js`（事件节点表）、`src/systems/EventEffects.js`（选项结算执行器）。
- **两个分区**（2026-11-13 第二轮修订，比例逐块量自 `docs/_art-references/事件ui点击前.jpg` / `事件ui一次点击.jpg`，1920×868，两图一致）：
  - 剧情区 `.story-panel`：**屏幕左下、无卡片外框 / 无底板**，只靠全屏单色薄纱 + 文字暗影；
    **参考图底部那条信息栏本作没有，整块下移 `7vh`**：`left 22.5vw / top 79.2vh / width 37.5vw / min-height 14vh`，顶边不随文本行数浮动。
    左侧 `.story-emblem` 圆形徽记（`min(8.6vw,17.2vh)`，圆心约 `(14.7vw,85.1vh)`，深绿渐变 + 细金环 + 反光），
    右侧 `.story-body`：`.story-title` 松林青绿 `#afe4c9` / `2.65vh`（墨迹约 `79.7vh`）；
    `.story-text` 暖米白 `#f4f1e8` / `2.3vh` / 行高 `1.38` / 行距约 `3.17vh`，
    **高度按整行裁切 `max-height: calc(4 * 1.38 * max(13px, 2.3vh))`**（只显示完整 4 行，绝不切掉半行；超出块内滚动，无底部渐隐）。
    `.story-skip`（`跳过 ✕` 胶囊）在**文本块右上角**：`right:40vw`（右缘 `60vw`）+ `top:79.2vh`，**不贴屏幕右缘**（右侧整列属于选项）。
    **没有推进提示**：不显示「继续」「请选择」。
  - 选项区 `.option-area`：右侧竖排（`left:65.3vw / right:5.6vw`，不再为跳过预留右侧空间），
    **`display:flex` + `justify-content:flex-end` 自下而上排布**，`bottom` 由 `_syncOptionBottom()` 按正文 rect 动态写入
    （`bottom = innerHeight - textEl.bottom`），因此**最后一项卡片底边 === 事件文本块最底部**；正文换行 / 窗口 resize 时重算。
    每个 `.story-option` 是**不透明深松林青绿卡片**（`#2e4844→#243a37→#1c2f2d` 纵向渐变 + 暖色顶部薄高光 + 1px 竖纹 + 茶金细边 + 左侧茶金内条），
    `min-height:17.6vh`、间距 `3vh`（参考节距 `20.6vh`）；四项时 `.option-area.is-four` 收到 `16vh` / `2.2vh`，整列最上沿约 `22%H`。
    卡内：`.story-option-bar` 标题行（`2.8vh / 700 / #f8f3e3` 暖白 + 茶金细分隔线）+ `.story-option-desc` 描述（`2.2vh / #d7e2d3`，`sub / detail` 全部常驻，不渲染数字徽章）。
  - 确认行 `.story-option-confirm-row`：描述下方**始终占位**的 `3.6vh` 行（`margin-top:auto` 贴卡底），内含「你确定这么做？」与圆形印章；
    出现时不压字、不顶开描述、不推移其它选项。
- **背景无暗斑**：`.story-mask` 只有一层 `rgba(14,20,24,.34)` 平铺色；旧的 `.story-wash` 与 `.option-scrim`（径向渐变椭圆暗斑）**已删除**。
- **快捷栏让位**：`StoryUI.show()` 给 `document.body` 加 `story-active`，`_hide()` 移除；`story.css` 中 `body.story-active .hotbar-wrapper{display:none}`
  （快捷栏根 `.hotbar` 带 inline `display:flex`，所以隐藏外层 wrapper）。原因：文本块已下移到屏幕底部，快捷栏正压在该区域，且事件期间快捷栏本就被输入封锁。
- **数据驱动**：`STORY_SHOW {script, ctx}` 播放；`script = {id,title,start,nodes,onEnd}`，
  `nodes[key] = {text,options?,next?,end?,onEnter?}`，`Option = {id,label,sub,detail,disabled,disabledReason,effects,next,end,onSelect}`。
  事件点（RES-001）由 `buildEventStory(entry)` 生成脚本：条目带 `nodes` 时直接使用节点表（`src/data/events.js`），
  否则退化为通用三选项结构。UI 不写死任何文案。
- **多级状态机**：`option.next` 可指向任意节点，目标节点可再次带 `options`，深度不限；
  节点 / 选项 id 与层级关系**只存在于数据**，不上屏（选项区只渲染 `label/sub/detail`，数字键 `1~4` 只作隐藏快捷键）。
  没有 `options` 且没有 `next` 的节点是终止节点：正文即为结果文本，进入结果态，点击屏幕任意处关闭事件（`result-dismiss`）。
- **描述与选项同屏**：事件首节点直接带 `options`，不得新增「你打算怎么做？」类过渡问句节点；
  选项确认后直接落到下一层描述（同样带 `options`），中间不再插一层需要点击的文本。
- **选项驱动结算**：事件**进入不结算**；只有选项确认时，`StoryUI._settleOption(opt)` 调
  `applyEventEffects(gs, opt.effects, ctx)`，在确认的同一 tick 执行，同一事件内同一 `option.id` 只执行一次。
  效果词表：`gold / item / stamina / heal / terrain / buff / creature`；执行器内部复用
  `InventorySystem` / `StaminaSystem` / `HealSystem` / `CreatureSystem` / 地形写入及既有 EventBus 事件，
  不新建平行数值系统。跳过、推进正文、静默关闭均不结算。
- **公共 API**：`show(script, ctx)` / `advance()` / `skip()` / `requestSkip()` / `refresh()` / `closeSilently(reason)`；
  只读 `visible` 供 InputGate 使用。`refresh()` 不重建待确认 / 淡出中的选项，避免打断玩家手势。
- **推进**：`advance()` 在选项节点直接返回 `false`（不可越过选择）；节点 `end` 或无 `next` → 结束。
  结束统一走 `_finish(reason)`，先 `_hide()` 再广播 `STORY_END {id,reason}`，最后调 `script.onEnd(ctx)`。
- **二次确认**：`StoryUI` 自带 `_armedIndex` 状态机，**不再复用 `ConfirmAction` 的全局 `pointerdown` 拦截**
  （旧实现按整卡外的描述会先被判定为「点到别处」而解除待确认，导致「点很多次也确认不了」）。
  **整张选项卡（标题行 + 描述 + 确认行）都是点击目标**：第一次点击 → 待确认（`_arm`），第二次点击同一张卡任意位置 → `_applyOption` 同 tick 生效；
  `document` 的 `click` 守卫只在 `card.contains(target)` 为假时才 `_disarm()`，因此卡内任意按下 / 抬起组合都稳定生效。
  **所有选项（包括「离开」）一律二次确认**，没有单击即生效的例外（`Option.safe` 已移除）。
  `detail` 常驻显示，禁止在点击后才展开（卡片高度不得突变）。
  确认后**业务先于动画**：`effects` 结算 + `onSelect` + 正文切换同一 tick 完成，卡片 1.5 秒淡出，淡出期整块选项区 `pointer-events:none`。
  键盘：`1~4` 与鼠标同入口（同样需要两次按键），ESC 在待确认时只取消待确认、不开跳过弹窗。
- **跳过**：`.story-skip`（文本块右上角 `right:40vw / top:79.2vh` 的胶囊，右缘 `60vw`）/ ESC → `DIALOG_SHOW` 二次确认；`skip()` 沿 `next` 前进，
  遇到 `options` 节点停下（选项节点上跳过被拒绝并 Toast 提示），无后续节点则结束；跳过永不执行 `effects`。
- **键盘**：空格 / 回车 / 点剧情区或空白薄纱 = 推进；结果态点任意处 = 关闭；`1~4` = 选项（与鼠标同入口）；
  ESC = 跳过入口；`DialogBox.visible` 时让渡键盘（跳过确认期间不拦截）。
- **输入门控（§18.3）**：`InputGate` 读 `director.storyUI?.visible` → `INPUT_BLOCK.STORY`，
  移动 / 祈福 / 睡觉 / 数字键 / 快捷栏停用；`STORY_END` 后自动恢复（门控每次按键实时计算，无缓存）。
  - `InputManager`：面板快捷键白名单 `STORY_VIEW_PANELS = inventory/role/task/codex`；编队 / 合成 / 载具拒绝；
    `buildMode` 增加 `isStoryBlocked()` 守卫；`settings`（ESC）仍归剧情跳过。
  - `FuncBar`（`z 5760`，高于事件层、低于面板）：事件期间只放行 `openSettings / toggleInventory / openRole / openTask`，
    其余（睡觉 / 编队 / 合成 / 建造 / 载具）Toast 拦截 —— 存读档走设置入口，是数据侧唯一例外。
  - `InventoryPanel`：事件期间 `_renderActionZone()` 直接返回（不渲染放置 / 使用 / 出货箱等改数据按钮），只保留查看。
  - `InfoPanel`：`_isStoryLocked()` 时拒绝 `selectTile / showBlessTab / TILE_CLICKED / FENCE_TILE_CLICKED`；
    信息区一禁，经信息区进入的商店自然不可达。
  - `StoryUI.show()`：进入剧情时若 `director.openPanels` 里还有白名单之外的界面（如 `info`），立即发 `UI_PANEL_CLOSE` 收起，
    只保留 `inventory / role / task / codex / settings`，避免旧面板盖在选项区之上。
- **层级**：薄纱 `.story-mask` **5700**、剧情区 / 选项区 **5750**（高于地图 / 快捷栏 5600 / 信息区 100，
  低于面板 6000 与设置 6200）；**结果态不改变层级与薄纱浓度**（避免把剧情区一起压暗），
  点击任意处关闭由 `5700` 薄纱 + 剧情区点击共同承接；`DialogBox` **9100** 始终最高。
- **受祝福预览**：`facilities.resolveEventTile(gs, idx, true)` 不再发中央 Toast，只写
  `contentState.eventPreviewId / eventPreviewName`；信息区「地块内容」展示事件名；真正进入时复用同一条目并消费预览。
- **生命周期**：`STATE_RESET` / `BOOT` → `closeSilently()`，静默关闭且**不**结算 `onEnd`（读档 / 重开不重复结算）；
  事件中途状态不入存档，读档视为事件未发生（设计文档 §18.5）。
- **验收**：`node tools/smoke-story.mjs`（无选项旁白、有选项、选项回调、二次确认、禁用态、
  详情常驻 / 无键位徽章 / 无「继续·请选择」提示、结果态点任意处关闭、层级 5700/5750（结果态不抬层级）、
  推进到底关闭、跳过只停在选项处、期间输入封锁、结束后恢复、数据驱动与 `refresh()` 实时刷新）；
  `node tools/smoke-event-flow.mjs`（进入不结算、描述与选项同屏、不同选项不同结果、两层直落选项、
  选项文本不泄露编号、跳过不越过分支、无选项节点终止、效果只生效一次、结算词表、静默打断）。

---

### 2.9 商店直接售卖技能（2026-11-08）

> 对应设计文档 §11.2 / §14.1 / §19.5。**技能石概念已整体删除**，不再存在「买技能石 → 使用技能石 → 获得技能」的链路。

- **货架来源**：`ShopSystem.SHOP_SKILLS` 提供魔法商店技能货架（`skill_zongheng` 10 金、`skill_link_shift` 20 金，沿用旧版售价）。技能 id 复用物品库现有技能条目，名称 / 图标 / 描述全部取 `ITEMS[id]`。
- **商品槽**：魔法商店 10 格中「技能」占 2~3 格；`generateStock` 对 `pool === 'SHOP_SKILL'` 走 `drawShopSkills`，每个货位独立等权抽取，允许同一技能重复上架（同名技能允许持有多份）。`POOL-11` 已停用，不再读写。
- **购买链路**：`ShopSystem.buy` 直接 `InventorySystem.addItem(gs, skillId, 1)`，购买成功即背包出现该技能物品，**没有二次「使用」步骤**；该货位按既有规则标记 `sold`。技能未放置前就是普通物品，可在背包 / 信息区直接放置。
- **不可出售**：`ShopSystem.isSellable` 增加二级分类 `技能` 拦截，技能与魔导书 / 收藏品 / 载具一样不可出售。
- **随机池 / 掉落**：`POOL-12` 等随机池不得再包含技能石条目；技能只从角色解锁或魔法商店获得，不进入随机掉落。
- **旧档迁移**：`migrateGS` 的 `migrateLegacySkillStones` 把旧档背包、出货箱、快捷栏、商店库存里的技能石条目换算为对应技能物品（1→1，库存同步名称 / 图标 / 分组），迁移后存档内不保留技能石条目。
- **技能逻辑不变**：触发器、判定、连携、冷却等技能实现零改动；本次仅改获取与售卖口径。
- **普通商店不售卖技能（2026-11-13）**：`SHOP_KINDS.shop` 四类货架（载具 / 设施资源 / 作物 / 收藏品）不含 `SHOP_SKILL`，`generateStock('shop')` 不会产出二级分类＝技能的条目；技能只在魔法商店直售。回归断言见 `tools/smoke-economy-crops.mjs`。

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

- **`roleId` 必须是真实角色 id，绝不用技能 id 冒充**：调用方显式传入；未传时由 `createSettlement` 用 `skillId` 查 `SKILLS[skillId]` 并 `resolveSkillOwnerId(gs, skillDef)` 兜底（`roleId` 非空返回自身，`roleId: null` 返回当前 1 号位）。`EffectBatch` 只做 `opts.roleId ?? null`，不再有 `opts.skillId` 回退。
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
| `party` 我方 | `gs.player` **共用实体** | 不会变成场上多个带 hp / 坐标的实体。生命、攻击力等属性完全共用；不同角色只体现在**技能倍率与技能归属者**。通用技能（`roleId: null`）的归属者 = **当前队伍 1 号位角色**（`getLeadRoleId(gs)`：`activeGroup.roles` 中第一个非空角色，见 `src/data/characters.js`）；换人、改编队、启用组切换后即时按新 1 号位结算。归属只影响结算（倍率、天赋加成、焚灭计数、汲取、风息、屏息、比翼、连携技归属与 UI 展示），**不改变技能可放置性，也不会因换人拆卡或失效**。外圈使用余默模型只是 UI 表现，不影响战斗数据 |
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

---

## 十、土豆 / 郁金香魔导书系统（2026-11-08）

### 10.1 新增模块

| 文件 | 职责 | 对外 API |
|---|---|---|
| `src/systems/PotatoSystem.js` | 土豆储存容量 / 共用池 / 收获 / 地雷伤害口径 | `potatoCapacity` `potatoTotalStored` `addPotatoStored` `harvestPotato` `potatoMineDamage` `hasPotatoHardship` `hasFriesQuartet` |
| `src/systems/TulipSystem.js` | 郁金香初始价值 / 波动 / 叠放 / 显示值 / 结算 / 强制拆除 | `tulipInitialValue` `initTulipTile` `stackTulip` `applyTulipFluctuation` `settleTulipValue` `tulipDisplayValue` `tulipSettleValue` `pickTulip` `maybeForceRemoveTulip` |
| `src/systems/MineSystem.js` | 土豆地雷场上实体：埋设 / 倒计时 / 碰撞 / 爆炸 / 消耗 | `plantMine` `tickMines` `stepMineCollisions` `explodeMine` `ensureMines` |
| `src/systems/CropGrimoireHooks.js` | 魔导书 hook 接线（onDailyStart / onTurnStart / onPlace / MAP_EXPANDED / RealtimeClock.onStep） | `initCropGrimoires(getGS)` `rewireCropGrimoires()` |
| `src/ui/MineView.js` | 地雷渲染层（zIndex 18，低于生物层 20） | `new MineView(layer).paint(gs, tileSize)` |

**复用约定**：【每回合开始时】统一使用 `HookDispatcher.onTurnStart`（`TurnSystem` 已提供），不新建第二套回合 hook；碰撞判定使用 `Geometry.circleCenterDistance` 的圆-圆重叠，不新建第二套碰撞。

### 10.2 GS 字段（`createInitialState`）

```js
mines: [],        // 场上实体：{ id, sourceTileIdx, x, y, radius, blastRadius, turnsLeft, surfaced }
minesNextId: 1,   // 地雷 id 自增序号（逻辑值，入日初基线）
```

- 田地字段沿用 `tile.contentState`：土豆 `potatoStored`；郁金香 `tulipValue` / `tulipStacks` / `tulipInit`。
- `DayBaseline.capture` 为整份 `gs` 深拷贝，`mines` / `minesNextId` 自动入档；`migrate.js` 对旧档补 `mines=[]`、`minesNextId=1`、`tulipStacks=0`、`tulipInit=true`（旧价值不追溯补初始值）。
- 经济上行的 +6 **只作用于「初始价值」基线**（`tulipInitialValue(gs)` 动态计算，追溯所有郁金香田块含旧档），当前 `tulipValue` 不变；叠放增量按当前基线计算。

### 10.3 新增 buff

`buffs.js` 新增 `stunned`（晕眩，debuff，target `creature`）：描述逐字取自词条字典「该单位无法行动，持续对应回合数。」
- 生效：`CreatureSystem.isCreatureStunned(c)`，`stepCreatures` 逻辑步内跳过移动（渲染插值冻结）。
- 内部计数：`remainingTurns = 2` + `params.displayTurns = 1`，保证跨过一次回合结算后仍覆盖「下一个回合」；UI 显示 1 回合。**对外比较一律用 `displayTurns`，不得直接用 `remainingTurns` 与设计值比对。**

### 10.4 事件与 UI

- 复用既有 `GE.GOLD_CHANGE` / `GE.TILE_UPDATED` / `GE.TILE_CONTENT_CHANGED` / `GE.INVENTORY_CHANGE` / `GE.DAMAGE_DEALT` / `GE.TOAST_SHOW`；未新增事件。
- `MapView` 新增 `mineLayer`（zIndex 18）并在既有 rAF 循环内 `MineView.paint`，地雷状态（埋藏 / 探出）逐帧实时可见。
- `InfoPanel` 实时显示：土豆「已储存 / 容量」（薯道难显示共用池）、郁金香「当前价值（无《泡沫》显示 max(0, 值)）/ 叠放层数 / 初始价值基线（叠放增量）」、金币变化；不新增手动「使用技能」入口。

### 10.5 伤害 / 阵营口径

- **易伤**：`CombatSystem.vulnerableMultiplier(target)` 为唯一实现（同名取最高，返回 `1 + max(strength)`）。角色技能、地块投掷（`applyElementalDamageToCreature`）与土豆地雷（`MineSystem.explodeMine`）统一调用，最后一步 `floor`。
- **地雷阵营**：`MineSystem.isEnemy` 使用 `data/factions.js` 的 `isHostileTo(FACTION.PARTY, factionOf(c))`，只对敌对生物触发 / 造成伤害；友善生物踩雷不触发、在爆炸半径内也不吃伤害。
- 地雷伤害仍不走暴击 / 闪避 / 角色天赋，保留「伤害量 = 土豆数量」字面口径；元素免疫先生效（免疫只晕眩）。

### 10.6 验收脚本

`node tools/smoke-crop-grimoire.mjs`（入库）：容量 30/40、薯道难共用池与一次取走、地雷上限 5 / 5 回合探出、敌对触发 / 友善不触发 / 友善在范围内不受伤、易伤同名取最高与 floor、晕眩仅命中敌人、郁金香初始 3/9、经济上行追溯基线、×1.5 取整、叠放与波动倍率、三日负价值示例、无《泡沫》夹 0 / 有《泡沫》扣金币、强制拆除（读显示值：无《泡沫》内部 -150 不拆 / 有《泡沫》拆）。

### 10.7 经济与拆除口径（2026-11-13）

| 项 | 实现 | 验收 |
|---|---|---|
| 拆除前自动采摘 | `CropHarvest.harvestCropBeforeRemove` 在 `BuildSystem.clearContent` / `placeContent` 的最前面调用；覆盖土豆 / 草莓 / 豌豆 / 郁金香 / 蒲公英 / 幽怜草 / 鸡舍（`eggStored` + `eggStoredGolden`），结算口径与手动采摘完全一致 | `tools/smoke-economy-crops.mjs` §1 |
| 郁金香显示 / 结算 | 内部真实值（可为负，绝不中途夹 0）；`tulipDisplayValue` 无《泡沫》→ max(0, v)；`tulipSettleValue` 先按真实值 ×1.5，再按《泡沫》决定负值是否生效 | 同上 §2 + `smoke-crop-grimoire` |
| 郁金香强制拆除 | `maybeForceRemoveTulip` 读**显示值**：无《泡沫》显示值恒 ≥ 0 → 永不触发；有《泡沫》显示值=真实值 → `< -100` 触发。与结算的 `|v| > 50 → ×1.5`（读真实值）是两条独立判定 | 同上 §2 + `smoke-crop-grimoire` |
| 史莱姆黏液 | 黏液是史莱姆**击杀掉落**（BIO-003 `drops` → `item_slime_gel`，经 `grantKillDrops` 进背包），史莱姆屋不储存黏液、拆除不结算 | 同上 §1（回归断言） |
| 金币区间 | `GoldSystem.addGold/setGold/clampGold`，常量 `GOLD_MIN=-999999` / `GOLD_MAX=999999`；读取与读档同样夹取；事件扣款最多扣到 0，不会在负金币时反向加钱 | 同上 §3 |
| 地形可出售 | 物品库地形 `value=1`（回收价）；`ShopSystem.SHOP_TERRAINS`（`{ id, price }`）维护购买价，当前为空；`SHOP_TERRAIN` 货架通路已预留 | 同上 §4 |
| 普通商店无技能 | `SHOP_KINDS.shop` 无 `SHOP_SKILL`；魔法商店保留 | 同上 §5 |
| 初始金币 | `constants.INITIAL_GOLD = 0`；`createInitialState({ gold })` 仅测试覆盖 | 同上 §6 |

**旧存档兼容**：地形原本就有 `value`（物品库）与 `price`（商店池）两个字段，无需迁移；旧档 `player.gold` 若越界，`migrateGS` 会夹取到新区间。原有负价值郁金香物品的 `value` 不改写（只有拥有《泡沫》才可能产生负值物品）。
