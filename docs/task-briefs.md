# 《转盘农场》开发阶段规划与任务 Briefs

> **版本**：2026-10-24（Trae 产出）
> **执行顺序**：Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5（严格串行，每 Phase 在上一 Phase 跑通后叠加）
> **部署链路**：所有代码推送到 `zengxiaohao123/html-game` 的 main 分支 → Cloudflare Pages 自动部署到 `https://html-game-ap9.pages.dev/`
> **仓库现状**：已有骨架（`src/{core,data,state,systems,ui}`），之前是另一个游戏的代码，需清空重置；`index.html` 保留但改 title

---

## Phase 总览

| Phase | 名称 | 核心产出 | 依赖 | 验收效果 |
|-------|------|----------|------|----------|
| 0 | 基础设施 | EventBus/HookDispatcher/GS schema/存储工具 | 无 | 浏览器 Console 里能 `import { GS } from './src/state/gameState.js'` 拿到状态对象，HookDispatcher.fire('onEnter', ...) 能触发已注册的回调 |
| 1 | 核心循环 | WASD 移动 + 行动力系统 + 睡觉换日 + 经过/进入触发 | Phase 0 | 页面上画出 3×3 地图（外圈 8 格 + 中心 1×1 栅栏），余默在格上，按 WASD 走格扣行动力，走到家（左下）或按 P 睡觉换日 |
| 2 | 设施+产出+背包 | 10 种设施 hook 注册 + 祈福 + 背包 8tab + 出货箱 + 快捷栏 + 建造模式 | Phase 1 | 10 种设施全部能触发词条（麦田日开始产小麦、家经过进获得金币），背包能拖物品到地块放置，祈福有动画，建造模式可用 |
| 3 | 战斗+技能+角色+生物 | 技能触发 + 伤害计算 + 元素免疫 + 生物实时移动 + 投喂成长 + 三容量惩罚 | Phase 2 | 余默的 3 个进入时技能能打生物（鸡、史莱姆），史莱姆有元素免疫，生物在栅栏内随机游走，饥饿会影响成长 |
| 4 | UI 全套页面+连携技 | 20 个 UI 分区 + 所有快捷键面板 + 连携技 3 秒窗口 | Phase 3 | 主界面完整 UI（顶部状态栏、功能区、右侧信息区 4 tab、底部快捷栏 10 格、左侧精灵、连携区小圆框）、ESC/B/C/L/F/T 全部可切面板 |
| 5 | 存档+事件+剧情+待补充 | 8 槽位存档 + 自动存档 + 事件池 + 图鉴占位 | Phase 4 | 主菜单三按钮完整可玩（新游戏/读档/图鉴）、每日开始自动存到 1 号位、ESC 打开设置面板存读档 |

---

## Phase 0 Brief —— 基础设施层

### 任务分配
- **派发对象**：指定给"基础架构 agent"
- **必须先读**：
  - [architecture-spec.md](file:///C:/Users/10436/game/docs/architecture-spec.md)（本架构规范）
  - [转盘农场_设计文档_v0.3.md](file:///C:/Users/10436/game/docs/转盘农场_设计文档_v0.3.md) §1-5（概述/地图/地块/数值）
- **⚠️ 素材策略**：
  - Phase 0 **只使用 emoji 占位**，严禁尝试下载/上传/映射任何图片资源
  - 仓库现有 `assets/` 目录是另一款游戏的精灵图（史莱姆、敌人、旧 terrain tile），**不要动、不要引用、不要删除**，留着即可
  - 本地路径 `C:\Users\10436\Downloads\DemonLordJustABlock_Assets` 是另一款独立游戏素材，**不要上传到仓库**、不要映射到 Assets.js
  - emoji 占位对照表见仓库 `docs/emoji-placeholder-report.md`（Phase 0 的 Assets.js 只需要最基础的几样，不用全表）

### 需新增/修改的文件

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `index.html` | 改 | `<title>转盘农场</title>`；改字体引用（去掉旧的"在成为勇者之前"）；保留 `<div id="app">`、toast-layer、fx-layer；script type="module" src="./src/main.js" |
| `src/main.js` | 重写 | 极简入口：import createInitialState、import HookDispatcher、注册几个演示 hook、console.log('转盘农场启动 ✓') |
| `src/core/EventBus.js` | 新建 | 纯对象：{ on, off, emit, once } 四方法，用 Map 存 handler 数组 |
| `src/core/GameEvents.js` | 新建 | 导出 `GE = { ... }` 常量对象，完整列表见 architecture-spec §2.3 |
| `src/core/HookDispatcher.js` | 新建 | 导出 `HookDispatcher = { register(hookType, cb, ctx), fire(hookType, params), clearAll() }`；内部用 Map 存 hookType → [{cb, ctx}] |
| `src/core/Logger.js` | 新建 | 导出 `devLog = { info(...args), warn(...args), error(...args) }`；加开关 `devLog.enabled`，生产环境可关 |
| `src/core/Random.js` | 新建 | 导出 `Random = { rand(min, max), chance(p), pick(arr), weightedPick(pairs) }` |
| `src/core/Distance.js` | 新建 | 外圈邻居计算（3×3 外圈 8 格，每格 4 邻居，转角共享）+ 栅栏内 row/col 邻居 + 相邻判断 |
| `src/core/Assets.js` | 新建 | 导出 `Assets = { emoji: { facility_home: '🏠', facility_tent: '⛺', ... }, terrains: { grass: '🟩', water: '🌊', none: '🟫' }, ui: { hp: '❤️', atk: '⚔️', ... } }` —— 完整 emoji 映射见 emoji-placeholder-report.md |
| `src/state/gameState.js` | 新建 | 导出 `createInitialState()` 工厂函数，schema 见 architecture-spec §3；地图初始 3×3，外圈 8 格全为无地形/虚空，左下 idx=6 自动放【家】 |
| `src/state/storage.js` | 新建 | 导出 `Storage = { save(slot, gs), load(slot), autoSave(gs), listSlots(), clearSlot(slot) }`；slot 1 为自动存档（key='wheelfarm_autosave'），slot 2-8 手动存；**save 时必须 `JSON.parse(JSON.stringify(gs))` 深克隆**，GS 对象不得包含任何函数或循环引用；load 失败返回 null |
| `src/utils/constants.js` | 新建 | 导出常量：`MAX_STAMINA = 8`, `MIN_STAMINA = -3`, `FENCE_ROW_COLS_INITIAL = 1`, `CAPACITY_FRIENDLY_INITIAL = 4`, `CAPACITY_DANGER_INITIAL = 4`, `SLOTS_MAX = 8` |

### 验收标准
1. 打开 `https://html-game-ap9.pages.dev/` 页面 Console 能看到"转盘农场启动 ✓"（或本地临时测试也行，最终必须推 main 分支自动部署）
2. Console 里执行 `import('./src/state/gameState.js').then(m => console.log(m.createInitialState()))` 能打印完整 GS 对象
3. 注册 demo hook（如 `HookDispatcher.register('onEnter', () => console.log('enter!'))`）然后 `HookDispatcher.fire('onEnter')` 能触发
4. `Storage.save(1, gs)` + `Storage.load(1)` 能正常 round-trip
5. Console 里无 404 错误、无 SyntaxError、无 TypeError

### ⚠️ 部署验证（agent 完成后必须请用户亲自做）
- agent push main 后，**必须等待 Cloudflare Pages 自动部署完成**（一般 30-60 秒）
- 打开 `https://html-game-ap9.pages.dev/`，按 F12 看 Console：
  - ✅ 能看到"转盘农场启动 ✓" + demo hook 输出
  - ✅ Console 里 `import('./src/state/gameState.js').then(m => m.createInitialState())` 能打印完整 GS
  - ❌ 不能有 404 错误、SyntaxError、TypeError
- 这一步由**用户（你本人）亲自验证**，不要委托 agent 去看——agent 没法真的点浏览器
- 通过后才能进入 Phase 1

### 禁止事项
- 禁止写任何 UI 渲染代码（纯 DOM 操作也不行）
- 禁止引入任何构建工具（Vite/webpack/parcel 都不要）
- 禁止使用 TypeScript（纯 ES module）

---

## Phase 1 Brief —— 核心循环

### 前置条件
Phase 0 验收全部通过。agent 必须基于 main 分支最新代码继续开发。

### 必须先读
- architecture-spec.md（架构规范）
- 设计文档 §1-9（概述/地图/地块/数值/时间/移动/祈福/背包）
- ui-mockup-main.html（主界面 HTML 原型，理解地图渲染方式）

### 需新增/修改的文件

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `src/main.js` | 改 | 组装 GameDirector + 初始 UI（地图骨架渲染） |
| `src/systems/GameDirector.js` | 新建 | 主循环导演类：constructor(deps)，start()，每帧（或每次操作后）检查连携技窗口、生物移动 tick |
| `src/systems/InputManager.js` | 新建 | 监听 WASD/P/Tab/B/C/F/L/T/ESC/1~0/空格/E；统一路由到 Director；用 event.key 匹配，大小写/shift 兼容 |
| `src/systems/TurnSystem.js` | 新建 | `advanceTurn(gs, cost=1)`：turn++，stamina -= cost； stamina < 0 → 挂上【心力交瘁】（buff）； stamina <= -3 → 强制 sleep |
| `src/systems/DaySystem.js` | 新建 | `startNewDay(gs)`：turn=0，day++，fire HookDispatcher('onDailyStart') 让所有设施触发每日效果，重置 dailyCounters 全为 0，stamina 回复一半（向上取整）+ 检查心力交瘁 debuff |
| `src/systems/MovementSystem.js` | 新建 | `move(gs, direction)`：Direction.neighbor(gs.player.x, direction) → 检查邻居有效性 → 扣 1 stamina → 触发 onPass + onEnter hook → GS.player.x 更新；不可移动返回 null 不扣 stamina |
| `src/systems/SleepSystem.js` | 新建 | `sleep(gs)`：DaySystem.startNewDay()；stamina 按设施规则回复（家/帐篷 = 回满）；心力交瘁检查；金币 10% 惩罚（行动力到 -3 强制睡时） |
| `src/utils/Direction.js` | 新建 | **方向工具**：4 方向枚举（UP='up' DOWN='down' LEFT='left' RIGHT='right'）+ opposite()；**邻居计算不要放这里**——Phase 0 已创建 `src/core/Distance.js`，里面应该有 Distance.neighbor(gs.player.x, direction, mapSize)，Phase 1 agent 调 Distance.js 的函数就行；**如果 Distance.js 里没有 neighbor 方法，就在 Direction.js 里实现并导出**，但优先扩展已有 Distance.js |
| `src/data/facilities.js` | 新建 | **Phase 1 极简版**（只注册 home + wheat 两种设施作为 demo）。每个设施一个对象 `{ id, name, emoji, hooks: { onEnter, onPass, onDailyStart, ... } }`。export function registerFacilities() { FacilityHome.register(); FacilityWheat.register(); } —— FacilityHome 注册 onEnter/onPass 触发获得 1 金币；FacilityWheat 注册 onDailyStart 触发添加小麦到背包。**完整 10 种设施 Phase 2 再补全** |
| `src/ui/MapView.js` | 新建 | 纯 DOM 渲染：外圈 8 格（3×3 初始）用绝对定位回字形摆；中心栅栏 1×1 用深灰描边；每格显示 emoji 占位；玩家用 🧑 绝对定位在当前格中心 |
| `src/ui/TopBar.js` | 新建 | 顶部状态栏：❤️ hp/maxHp、⚔️ atk、🔷 stamina/maxStamina、🪙 gold、🐣 友善 cap/current、👹 危险 cap/current |
| `src/ui/FuncBar.js` | 新建 | 功能区：从右往左 8 图标（❌ 设置、🛌 睡觉、👤 角色、👥 编队、⚒️ 合成、🛠️ 建造、🎒 背包、🚗 载具），点击 emit GE.UI_PANEL_OPEN 或直接触发 |
| `src/ui/HotBar.js` | 新建 | 快捷栏：底部居中 10 格，显示 emoji + 数量（右下小字）；选中格加黄色边框 |
| `src/ui/SpiritArea.js` | 新建 | 左侧精灵：初始 🧑‍🎤 余默 + 👻 momo 头像；点击 emit GE.UI_INFO_PANEL 打开祈福 tab |
| `src/ui/SettingsPanel.js` | 新建 | **极简版**：ESC 打开，两个按钮"存档 slot 1"、"读档 slot 1"、"回主菜单"；存档按钮调 Storage.save(1, gs) 再弹 Toast 提示；读档按钮调 Storage.load(1) 再 emit GS 重新渲染 |
| `src/ui/Toast.js` | 新建 | 中央弹窗：GE.TOAST_SHOW → 2 秒自动消失；用于"你感到心力交瘁"、金币变化等提醒 |
| `src/ui/dom.js` | 新建 | 工具函数：createEl(tag, {class, id, text, style}), qs, qsa 等 |

### 验收标准
1. **地图可视化**：页面上能看到 3×3 外圈 8 格（回字形）+ 中心栅栏，左下格自动放了家 🏠
2. **WASD 移动**：按 W/A/S/D，余默 🧑 在相邻格间移动，每动一步 stamina -1
3. **行动力不足**：stamina 到 0 继续走会变成负数（界面提示"你感到心力交瘁"，不弹窗），继续走到 -3 时自动睡觉换日并扣 10% 金币
4. **睡觉**：点击功能区 🛌 或按 P，行动力 >0 时弹确认；确定后换日、触发 onDailyStart、行动力按家规则回满
5. **新一天开始**：day++，所有麦田 🟡 自动产小麦进入背包（emoji 占位也行）
6. **存档能 round-trip**：ESC → 存 slot 1 → 刷新 → ESC → 读 slot 1，回到之前的地图状态

### 边界说明
- Phase 1 只做 10 种设施里的**每日开始触发**（麦田产小麦）和**进入时触发**（家进获得金币）——完整词条注册留到 Phase 2
- 祈福/建造模式/背包详情页先画骨架，交互留到 Phase 2
- 生物系统留到 Phase 3，栅栏内暂时空着
- 连携技留到 Phase 4

---

## Phase 2 Brief —— 设施 + 产出 + 背包 + 祈福 + 建造模式

### 前置条件
Phase 1 验收通过。

### 必须先读
- 设计文档 §9-11（背包、设施 10 种、资源 5 种）
- architecture-spec.md HookDispatcher 章节

### 需新增/修改的文件

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `src/data/facilities.js` | 新建 | 10 种设施定义表，每设施含：id、name、emoji、dailyStartHook、onEnterHook、onPassHook、onBlessedHook、sleepHook、replaceHook（帐篷专用）。**每种设施在 `export function registerAllFacilities()` 里调用 `HookDispatcher.register`** |
| `src/data/resources.js` | 新建 | 5 种资源类地块内容定义：event、reward、hunt、shop、bus；注册 hook |
| `src/data/items.js` | 新建 | 产出物品表：wheat、rice_straw、potato、tulip_value_N、strawberry、pea、egg、golden_egg、raw_meat、slime_gel、wheel；每物品：id、name、emoji、category、value |
| `src/data/terrains.js` | 新建 | 4 种地形：grass(elementAmount=10)、water(elementAmount=10)、none(elementAmount=0)、mud(elementAmount=10) |
| `src/systems/BlessSystem.js` | 新建 | `bless(gs)`：stamina -= 2、gold -= 1；Random.pick(gs.map.outerTiles 中随机 1 格)；挂上 'blessed' 状态（含剩余次数） |
| `src/systems/InventorySystem.js` | 新建 | `addItem(gs, itemId, qty)`、`removeItem(gs, itemId, qty)`、`addToOutbox(gs, itemId, qty)`、`loadFromOutbox(gs)`（每日开始时自动）、`moveItemBetween(gs, from, to, qty, mode)`（左键 1 / 右键 half / Shift+LMB 5 / Alt+LMB 25） |
| `src/systems/BuildSystem.js` | 新建 | `enterBuildMode(gs)`、`exitBuildMode(gs)`、`placeContent(gs, tileIdx, contentId)`：检查合法 → 替换（帐篷旧内容回背包，其他消失）→ emit TILE_UPDATED |
| `src/ui/InventoryPanel.js` | 新建 | B 键打开：全屏大面板；顶部 8 tab（总览/设施/资源/技能/地形/产物/道具/杂物）；左侧物品列表（emoji 无文字）；右侧选中详情；右下出货箱 12 格（2×6）；拖拽放置支持 |
| `src/ui/InfoPanel.js` | 新建 | 点击地块滑入（右侧 1/4 屏宽）；4 tab：地块内容（词条行+滑动条+功能按钮）/ 状态（地形+buff）/ 单位（外圈=余默、栅栏内=生物列表）/ 祈福；点击空白处滑出 |
| `src/ui/styles/*.css` | 新建 | 基础样式表（base.css/map.css/panels.css/hotbar.css/ui.css），采用 ui-mockup-main.html 里的配色和布局 |

### 验收标准
1. **10 种设施词条全部注册**：每种设施的所有【】词条都能触发（麦田日开始产小麦、土豆田储存土豆、家经过获得金币、鸡舍进入生小鸡、史莱姆屋日开始生史莱姆等）
2. **背包 8 tab**：打开后能看到分类物品；选中后能拖到地图放置
3. **出货箱 12 格**：物品放进去，次日开始自动换成金币
4. **祈福**：左侧点精灵 → 右侧滑出祈福面板 → 按"请 momo 帮忙"→ 随机选 1 格挂上祝福状态
5. **建造模式**：按 Tab 切换；选中快捷栏物品 → 点击空地块放置 → 替换旧内容（帐篷旧的回背包）
6. **替换规则**：家（唯一+永恒）不可替换；其他设施替换时旧内容消失；帐篷替换时旧内容回背包

---

## Phase 3 Brief —— 战斗 + 技能 + 角色 + 生物

### 前置条件
Phase 2 验收通过。

### 必须先读
- 设计文档 §12（角色/精灵/技能/编队/战斗附加机制）、§13（生物系统）、§14（Debuff）

### 需新增/修改的文件

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `src/data/characters.js` | 新建 | 3 角色（yumo/xiayang/luyouyou）+ 3 精灵 + 所有技能定义表；每技能含 id、name、element、damageMultiplier、range、onEnterHooks、onPassHooks、onBlessedHooks、cooldown、isLinkSkill |
| `src/data/creatures.js` | 新建 | 小鸡/鸡 + 史莱姆 7 元素变体；每生物：kind、friendly/danger/extreme、hp、atk、elementImmune、element、growth、mood |
| `src/data/buffs.js` | 新建 | 6 种 debuff：粘液（onEnter → hp-5 stamina-1 然后移除）、燃烧（每回合开始流失 3% hp 可致死）、虚弱（造成伤害 -X%）、易伤（受到伤害 +X%）、心力交瘁（sleep 固定回一半，所有睡觉增益失效）、蓄力（敌人专属） |
| `src/systems/CombatSystem.js` | 新建 | `calculateDamage(attacker, defender, skill)`：基础 = atk × multiplier；元素免疫检查；闪避乘算；范围伤害；真实伤害绕过闪避 |
| `src/systems/SkillSystem.js` | 新建 | `triggerSkillByHook(hookType, params)`：遍历所有 onEnter/onPass/onBlessed 注册的技能 → 选合法目标（默认离技能格最近的敌人）→ CombatSystem.calculateDamage |
| `src/systems/CreatureSystem.js` | 新建 | 生物实时移动（requestAnimationFrame tick，每 2 秒换方向走 1 格）；投喂逻辑（鸡舍生成小鸡时关联；日开始消耗稻草/小麦/草元素量）；成长值/心情值；产蛋；容量警告期与惩罚（友善=收益归 0、危险=真实伤害、极度危险=拆地块） |
| `src/systems/LinkSkillSystem.js` | 新建 | 连携技解锁检测（条件达成 → 入队）；3 秒实时窗口（requestAnimationFrame 轮询，倒计时 display；按 E 触发）；队列排序（解锁顺序 → 角色排序）；冷却按回合 |

### 验收标准
1. **余默 3 个进入时技能**（斩击、拼命、开拓）能在走到该格时打生物
2. **元素免疫**：史莱姆·火免疫火元素伤害
3. **闪避**：生物有闪避率，多个来源乘算
4. **生物移动**：栅栏内 🐣🐔🟢 随机游走；饥饿时 mood -1
5. **容量超载惩罚**：友善超载警告 2 天后收益归 0；危险超载每日开始扣真实伤害

---

## Phase 4 Brief —— UI 全套页面 + 连携技实时窗口

### 前置条件
Phase 3 验收通过。

### 必须先读
- 设计文档 §15（UI 布局全部 20 个分区）
- ui-mockup-main.html（参考主界面布局）

### 需新增/修改的文件

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `src/ui/UIController.js` | 重写 | 统一 UI 总控：管理 5 种模式（menu/explore/build/shop/event）；面板 open/close 互斥逻辑 |
| `src/ui/panels/MainMenu.js` | 新建 | 全屏主菜单：标题 + 三按钮（新游戏/读取存档/图鉴） |
| `src/ui/panels/SettingsPanel.js` | 新建 | ESC 打开：存档/读档/返回主菜单；8 槽位网格 |
| `src/ui/panels/RolePanel.js` | 新建 | C 键：全屏；顶部角色头像切换；左 tab（技能展示/羁绊等级）；右属性栏 |
| `src/ui/panels/TeamPanel.js` | 新建 | L 键：4 组编队；右下角快捷编队/启用按钮；每日上限 3 次修改 |
| `src/ui/panels/ForgePanel.js` | 新建 | F 键：非全屏居中；6 tab；左物品格；右详情+合成条 |
| `src/ui/panels/VehiclePanel.js` | 新建 | T 键：非全屏；载具独立格子（同种不叠放） |
| `src/ui/panels/ShopPanel.js` | 新建 | 商店：地块功能进入；每日打折商品 |
| `src/ui/LinkSkillUI.js` | 重写 | 屏幕中央偏右：主技能圆框（金色发光 + "E" 键提示）+ 后续技能小框；3 秒倒计时进度条；窗口超时自动消失 |
| `src/ui/DialogBox.js` | 新建 | 剧情区：底部居中；事件标题/角色名；跳过按钮；选项模式（浅绿底选中 → 淡金底确认） |
| `src/ui/styles/*.css` | 补全 | 所有面板样式；建造模式/探索模式切换指示灯；选中地块高亮；信息区滑入滑出动画 |

### 验收标准
1. **20 个 UI 分区全部可见**（参考 ui-main.png）
2. **所有快捷键**：ESC/P/C/L/F/T/B/Tab/1~0/E/空格/WASD 全部工作
3. **连携技小圆框**：技能可用时出现，3 秒窗口倒计时，按 E 使用或超时消失
4. **面板互斥**：打开背包时其他面板关闭；ESC 先关二级面板再一级再回主界面

---

## Phase 5 Brief —— 存档 + 事件/剧情 + 图鉴 + 后续待补充

### 前置条件
Phase 4 验收通过。

### 必须先读
- 设计文档末尾"待补充"列表

### 需新增/修改的文件
（待 Phase 4 完成后再细化，当前粗略列出）

| 文件路径 | 操作 | 核心内容 |
|----------|------|----------|
| `src/state/storage.js` | 扩展 | 8 槽位完整 UI；事件中存档以触发点为准；返回主菜单自动存 1 号位 |
| `src/data/events.js` | 新建 | 事件池（每日限 1 次的【进入时】事件） |
| `src/data/rewards.js` | 新建 | 奖励池（随机奖励 + 祝福高价值提升） |
| `src/data/quests.js` | 新建 | 核心任务列表（设计文档待补充） |
| `src/data/vehicles.js` | 新建 | 载具具体效果 + 每格 UI 配图 |
| `src/data/processing.js` | 新建 | 加工/合成设施 |
| `src/data/bondage.js` | 新建 | 羁绊等级/好感度系统 |

### 验收标准
1. **主菜单完整**：三按钮可用，新游戏 → 完整开局流程（初始 8 个地块内容放置）
2. **存档 8 槽位**：自动存档（1 号位，每日开始+返回主菜单触发）+ 手动存档（2-8 号位）
3. **图鉴占位**：点击后显示所有已发现设施/技能/角色列表（空项目显示"未发现"）

---

## 统一提交流程（所有 agent 必须遵守）

1. **拉最新**：`git pull origin main`
2. **开发**：在 main 分支上提交（不要用 feature 分支，简化流程）
3. **提交信息**：`git commit -m "feat(phase0): EventBus + HookDispatcher + GS schema"` （conventional commit 格式，带 phase 编号）
4. **推送**：`git push origin main` → 等待 Cloudflare Pages 自动部署（约 30-60 秒）
5. **验证**：打开 `https://html-game-ap9.pages.dev/` 检查 Console 无报错
6. **返回报告**：告知我：修改了哪些文件、新引入了哪些 schema/事件名、验收是否通过、有没有发现架构规范需要补的地方

---

## Agent 返回信息模板（给我的汇报）

```
【Phase X 完成汇报】
- 修改文件清单：...
- 新增 schema/事件/hook 类型：...（需要同步到 architecture-spec 的我会标注）
- 验收状态：✅通过 / ❌有问题（说明）
- 部署验证：https://html-game-ap9.pages.dev/ Console 无报错 / 有报错（贴出来）
- 架构规范补注建议：（如果有）
```
