# 架构与规则实现索引

> 读者：后续接手的开发者 / AI。玩法权威是设计文档 v0.8（项目所有者持有），
> 本文是**代码侧地图**：讲清每条规则落在哪个文件、关键不变量在哪里保证。

## 1. 分层

```
core   纯工具，不依赖 state/data 之外的业务：
       EventBus(发布订阅) Rng(可种子随机) Const(枚举/常量) Logger(双日志)
       Storage(8槽存档) Assets(资源) Audio(WebAudio)
data   声明式数据（无副作用）：items/facilities/recipes/loot/skills/buffs/enemies/battleNodes
state  可变世界状态：GameState(根) / GameMap / Inventory / Party
systems 规则解释器：ExploreSystem / CombatEngine / GameDirector / Permanent / ShopCraft
ui     只读渲染 + 收集输入：MenuScreen / ExploreScreen / BattleScreen / Panels / UIController
```

依赖方向：ui → systems → state → data / core；data、core 不反向依赖。

## 2. 顶层状态机（设计 §2）

`GameDirector.topState ∈ {EXPLORE, COMBAT}`。
- EXPLORE→COMBAT：ExploreSystem 踩到 作战/紧急作战 → `hooks.onBattle` → Director 选节点 → CombatEngine.startBattle。
- COMBAT→EXPLORE：`BATTLE_END` 后 UI 弹结算 → `Director.finishBattle()`（发奖/扣健康/清地块）→ 回探索。
- 事件/剧情是探索态的**暂停覆盖层**（本期剧情未接入，事件格暂回落空地）。

## 3. 探索态（§3）—— ExploreSystem

- 地图 `GameMap.tiles: Map<"x,y", Tile>`；Void=未记录。四方向相邻；冰面连锁滑动。
- AP：移动成功 -1，撞阻 0；建造/设施/面板 0；睡觉回满。
- 每日刷新 `_onNewDay`：设施格/主角格强制空地，其余按 40/20/15/15/10 roll。
- 空地搜索 `_searchEmpty`：三档独立 50/40/20，区域过滤换物不减量；《愧怍》补偿。
- 建造地块（Void+视口+材料）/设施（占用 entity，相邻交互，拆除 ceil(0.5)）。
- 森林/矿脉 HP=2（徽章-50%→1），主动技能攻击，日限 2 次。

## 4. 战斗态（§4）—— systems/battle/

- `BattleSession`：左右各 5 格；leader 在 ally pos2；队友不占格无 HP；召唤物占格。
- base（进场快照）与 stats（动态）严格分离；队友只有 atk。
- 行动节点 `_unitTurnStart`：护盾清零→防御重建→状态计时→燃烧等回合开始效果→地形附着。
- **伤害公式** `dealDamage`：atk×倍率×(1−抗性clamp[-100,95%])×各乘区×暴击2。
  - 先闪避（乘算综合率）后格挡；真实伤害/流失生命不触发闪避格挡；护盾可挡真实伤害但不挡 DOT。
  - 虚弱（施法方）/易伤、减伤（目标）为独立乘区；同名取最高。
- **元素三件套**：elementProperty 只伤害不附着；elementReact 先 applyAura→反应→再吃伤害。
- **反应**：ReactionEngine 用**显式队列**（禁止递归）处理中断/扩散连锁/感电弹跳；
  反应后清空附着；第三种附着被禁止（单附着不变量在 applyAura 保证）。
  - 蒸发/融化顺序敏感，给施法者单次增伤；燃烧/冻结/感电/超载/扩散/结晶/绽放/激化/超导均已实现。
  - 超导为**绑定地块**抗性 debuff（`S.meta.tiles`），公式 max(R×0.4,0.10)。
- **技能**：data/skills.js 用 effects DSL，CombatEngine `_execEffect` 解释。
  - 主动每角色每回合 1 次；整队主动槽 ≤4（Party.skillSet）；数字键 1-4 释放。
  - 元素手牌每回合从探索元素池 shuffle 抽 5，用后弃；战斗结束 pool 不变。
  - 连携：满足条件入队，队首 2 秒倒计时，E 释放，释放时不校验条件，进冷却；FIFO。
- **敌人 AI**：data/enemies.js intent（always/random/script/special）；special（冰雾/镖客/熊/机关/铁疙瘩）在 `_specialIntent`。
  - 天赋（新手之友/元素亲和/自爆/狗友/成长/冬眠狂躁/稀有记忆…）在 `_onEnemySpawn/_applyGlobalGrowth/_killUnit`。
- 逃跑 `tryFlee`：clamp((主角speed − max(hpPct×敌speed))/100,0,1)，失败主角本回合封技能。
- 胜利=原生敌人全灭（召唤物/火史莱姆残留不计）；失败=主角 hp≤0（健康-1，hp 置 1）。
- 结束清理：buff/护盾清除；**附着不清**（回写 heroAura 跨战斗）；连携冷却重置。

## 5. 外围系统

- Inventory：6 分类，无限堆叠；elements 即元素池探索态视图。
- Party：编队（主角必在，1..3）、好感/羁绊（每 10 好感+1，只升不降）、
  主角 0→999 级（20 经验起，每 5 级需求+5；升级五选二）、心理压力（每日抑郁判定）。
- Permanent：永久物品获得后 `recomputePermanent` 聚合到 `gs.permAgg`。
- ShopCraft：固定商店（买/卖=ceil(买入×0.5)）、合成（明心浆/永久物品成本递增）、篝火烹饪。
- Storage：8 槽，0=自动（睡觉/进战斗前），localStorage，带版本号。

## 6. 存档序列化

每个 state 类都有 `serialize()/static deserialize()`；GameState 为根。
**新增需要持久化的字段时，必须同时改这两个方法**，否则读档丢失。

## 7. UI 约定（中文 UI）

- 无框架，`ui/dom.js` 的 `h(tag,attrs,children)` 构造；样式分 base/components/explore/combat/panels。
- 所有玩家可见文案必须中文；【】词条与文学性浅蓝字段遵循设计文档。
- 探索快捷键 WASD 移动，J/B/E/Q/C/L/V 面板，空格在战斗中结束回合，E 放连携。

## 8. 美术素材

素材来源：本地 `DemonLordJustABlock_Assets`（sprites 2335 / textures 2146 / audio 156 / fonts 6）。
- 原素材的 text/ 是旧游戏文本，**不可用于本作内容**；只用图片与音频。
- 使用前必须**识图核对**风格再挑选，复制进 `assets/` 时按用途规范重命名（不改本地原名）。
- 已纳入：7 张元素史莱姆（敌人）。人物立绘、地块、UI 图标、BGM 待按模块挑选。
- 禁止用 emoji/纯文字替代本应有美术的元素。

## 9. 测试与推送

- 逻辑冒烟（无 DOM）：`node tools/smoke.mjs`（初始化/移动/刷新/存档/一场完整战斗）。
- 单文件语法：`node --check <file>`。
- 推送到 GitHub：本机 github.com:443 被阻断但 api.github.com 可达，
  使用 `tools/gh-push.mjs`（Git Data REST API：blob→tree→commit→ref），
  manifest 见 `tools/manifest.example.json`。
- 真实浏览器验证由项目所有者在本机进行（不要依赖 file:// 或仅静态检查）。

## 10. 待办（当前里程碑之后）

- 剧情/事件系统接入（旧开场原案仅参考）。
- 连携触发钩子在各结算点的完整接线（applyAura/扩散计数/蓄力）与 2 秒计时 UI 驱动。
- 探索态主动技能/连携、地形对设施附着（篝火点燃熄灭）完整化。
- 任务系统内容、地块奖励放置交互、更多美术与音频接入、动画与特效。
