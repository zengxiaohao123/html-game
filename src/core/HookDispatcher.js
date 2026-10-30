// src/core/HookDispatcher.js
// 词条 Hook 分发器：所有【】标注的效果都通过 HookDispatcher 注册触发。
// 关键约定：
//   - 核心 systems 代码不出现 "onEnter"/"onDailyStart" 等硬编码词条名
//   - data/*.js 中的设施/技能/状态对象在初始化时调用 HookDispatcher.register()
//   - systems 层在合适时机只做 HookDispatcher.fire(hookType, params)
//
// 10 种 hook 类型（新增时同步到 architecture-spec §2.2）：
//   onEnter             角色进入某格（最终停留）
//   onPass              角色经过某格（路径上所有格 + 最终格）
//   onBlessed           某格被挂上祝福状态
//   onDailyStart        每日开始时
//   onSleep             睡觉时
//   onReplace           地块内容被替换（帐篷专用：旧内容回背包）
//   onUseSkill          角色使用技能时（用于豌豆架）
//   onEveryNTurn        每 N 回合（用于豌豆架每 2 回合限 1 次）
//   onCreatureDefeated  生物被击败时
//   onEventResolve      事件/选项结算时

export const HOOK_TYPES = [
  'onEnter',           // 进入时：仅最终停留格
  'onPass',            // 经过时：路径上每一格（含终点，不含起点）
  'onBlessed',         // 受祝福时
  'onDailyStart',      // 每一日开始时
  'onDailyEnd',        // 每一日结束时（穗粒满：小麦田额外 +1）
  'onSleep',           // 睡觉时
  'onReplace',         // 替换时（先拆后放，原子）
  'onPlace',           // 放置时（野生种子变身、蒲公英/幽怜草初始化）
  'onUseSkill',        // 使用技能时（普通技能 + 连携技，不含天赋）
  'onEveryNTurn',      // 每 N 回合
  'onMoveEnd',         // 移动后（走完一整段路径触发一次）
  'onDodge',           // 闪避时（蹁跹：为主角回 12 血）
  'onCraft',           // 合成或加工时（巧手：25% 返原材料）
  'onUseItem',         // 使用时（草药、初级肥料等消耗道具）
  'onHeal',            // 角色回复生命值时（艾草田地）
  'onCreatureDefeated',// 生物被击败时
  'onCreatureAdded',   // 生物增加时（玉米田地）
  'onEventResolve',    // 事件/选项结算时
];

// hookType → [{ cb, ctx }]
const registry = new Map();

// 初始化 10 种 hook 类型的空数组
for (const t of HOOK_TYPES) registry.set(t, []);

export const HookDispatcher = {
  /**
   * 注册 hook
   * @param {string} hookType 必须是 HOOK_TYPES 中的一个
   * @param {Function} cb 回调函数 (params, ctx) => any  // ctx = 注册者（设施/技能/状态对象）
   * @param {object} [ctx] 注册者上下文对象，fire 时会原样传入 cb 第二个参数
   */
  register(hookType, cb, ctx) {
    if (!registry.has(hookType)) {
      // 非标准类型警告，但允许（未来扩展用）
      console.warn(`[HookDispatcher] register: unknown hookType "${hookType}" — 已自动登记`);
      registry.set(hookType, []);
    }
    registry.get(hookType).push({ cb, ctx });
  },

  /**
   * 触发 hook
   * 按注册顺序依次执行所有回调，try/catch 隔离
   * @param {string} hookType
   * @param {*} [params] 传给 cb 的第一个参数
   */
  fire(hookType, params) {
    const list = registry.get(hookType);
    if (!list) return;
    const snapshot = list.slice();
    for (const { cb, ctx } of snapshot) {
      try {
        cb(params, ctx);
      } catch (e) {
        console.error(`[HookDispatcher] hook "${hookType}" callback threw:`, e);
      }
    }
  },

  /**
   * 清空所有已注册 hook（测试用 / 重启游戏时）
   */
  clearAll() {
    for (const t of registry.keys()) registry.set(t, []);
  },

  /**
   * 调试用：列出某 hookType 下注册数量
   */
  count(hookType) {
    return (registry.get(hookType) || []).length;
  },
};
