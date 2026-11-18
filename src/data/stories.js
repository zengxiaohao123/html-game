// src/data/stories.js
// ─────────────────────────────────────────────────────────────────────────────
// 剧情 / 事件脚本数据（§16.5）
// ─────────────────────────────────────────────────────────────────────────────
// UI 层（src/ui/StoryUI.js）只读本数据结构，禁止在 UI 里写死任何文案。
//
// StoryScript 结构：
//   {
//     id:     脚本 id（用于事件与冒烟断言）
//     title:  事件标题（显示在剧情区正文上方）
//     icon:   剧情区左侧圆形徽记的图标（emoji 字符串；缺省 🎲）
//     start:  起始节点 key
//     nodes:  { [key]: StoryNode }
//     onEnd?: (ctx) => void
//   }
//
// StoryNode 结构：
//   {
//     text:    正文；字符串或字符串数组（数组按段渲染，段间空一行）；支持 \n 换行
//     options?: Option[]    存在即进入「选项区等待选择」（与正文同节点，不再加过渡问句）
//     next?:   无选项时的下一节点；缺省 = 本脚本结束
//     end?:    true = 本节点结束脚本（结果文本出现后点屏幕任意处关闭）
//   }
//
// Option 结构：
//   {
//     id?:      选项 id（仅代码使用，永不上屏）
//     label:    选项标题（白色选项条内的唯一文本；UI 不渲染数字徽章）
//     sub?:     选项描述（白条下方常驻显示的代价 / 后果）
//     detail?:  选项描述第二段（与 sub 同一视觉参数，常驻显示）
//     disabled?: true = 灰化不可选
//     disabledReason?: 禁用原因（显示为描述行）
//     effects?: EventEffect[]  选项确认的同一 tick 执行（且只执行一次），词表见
//               src/systems/EventEffects.js；事件结算只允许走这里
//     next?:    跳转节点（任意深度，可指向另一个含 options 的节点）
//     end?:     true = 选择后结束脚本
//   }
//   所有选项（含「离开」）一律二次确认，没有单击即生效的例外。
//
// 事件节点表来自 src/data/events/ 下的 EventDef。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 由事件定义生成一段事件脚本（RES-001 事件点进入时调用）。
 * 文案全部来自事件定义自身字段，不在 UI 层写死。
 * @param {{id:string,name:string,nodes:object,start?:string,icon?:string}} entry
 * @param {{onEnd?:Function}} [opts]
 * @returns {object|null} 事件定义缺少节点表时返回 null
 */
export function buildEventStory(entry, opts = {}) {
  if (!entry?.nodes || typeof entry.nodes !== 'object') return null;
  return {
    id: `story_${entry.id}`,
    title: entry.name,
    icon: entry.icon || '🎲',
    start: entry.start || Object.keys(entry.nodes)[0],
    nodes: entry.nodes,
    onEnd: opts.onEnd,
  };
}
