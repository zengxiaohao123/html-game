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
//     onEnter?: (ctx) => void
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
//     onSelect?: (ctx) => void
//   }
//   所有选项（含「离开」）一律二次确认，没有单击即生效的例外。
//
// ctx = { gs, script, nodeKey, option, ui, settlement? }
//
// 事件可选直接提供节点表（src/data/events.js 的 EventDef）：
//   { id, name, icon, start, nodes } → buildEventStory 原样使用，分支任意深度。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 由事件条目生成一段事件脚本（RES-001 事件点进入时调用）。
 * 文案全部来自条目自身字段，不在 UI 层写死。
 *
 * 事件条目带 nodes（src/data/events.js 的 EventDef）时原样使用其节点表；
 * 否则退化为通用三选项结构（条目 effect 挂到「顺手拿走」选项上，进入不再结算）。
 * @param {{id:string,name:string,nodes?:object,start?:string,icon?:string,effect?:object}} entry
 * @param {{onEnd?:Function}} [opts]
 * @returns {object} StoryScript
 */
export function buildEventStory(entry, opts = {}) {
  const name = entry?.name || '路边的小事';
  if (entry?.nodes && typeof entry.nodes === 'object') {
    const keys = Object.keys(entry.nodes);
    return {
      id: `story_${entry.id || 'event'}`,
      title: name,
      icon: entry.icon || '🎲',
      start: entry.start || keys[0],
      nodes: entry.nodes,
      onEnd: opts.onEnd,
    };
  }
  return {
    id: `story_${entry?.id || 'event'}`,
    title: name,
    icon: '🎲',
    start: 'intro',
    nodes: {
      intro: {
        text: [
          `你在路边发现了${name}。`,
          '四周没有别的动静。你停下脚步，打量着眼前这一小块地方。',
        ],
        options: [
          {
            id: 'look',
            label: '仔细查看',
            sub: '花点时间弄清楚这里发生了什么',
            next: 'looked',
          },
          {
            id: 'take',
            label: '顺手带走',
            sub: '能拿的东西就先拿着',
            effects: entry?.effect ? [{ ...entry.effect }] : [],
            next: 'taken',
          },
          {
            id: 'leave',
            label: '离开',
            sub: '多一事不如少一事',
            end: true,
          },
        ],
      },
      looked: {
        text: '你看清了这里的来龙去脉，又把周围恢复成原样，这才继续赶路。',
        end: true,
      },
      taken: {
        text: '你把能带走的东西收进背包，拍了拍衣角上的尘土。',
        end: true,
      },
    },
    onEnd: opts.onEnd,
  };
}

/**
 * 最小演示脚本：用于手动调试剧情区（不参与正式事件流程）。
 * @returns {object} StoryScript
 */
export function demoStory() {
  return {
    id: 'story_demo',
    title: '剧情区演示',
    icon: '💬',
    start: 'a',
    nodes: {
      a: {
        text: ['这是第一段演示剧情。', '点击剧情区、按空格或回车，推进到下一段。'],
        next: 'b',
      },
      b: {
        text: '这里出现选项：选项区在屏幕右侧，首次点击进入待确认，再次点击生效。',
        options: [
          {
            id: 'one',
            label: '选项一',
            sub: '描述：代价或后果写在这里',
            detail: '第二行描述与第一行同一视觉参数，始终显示。',
            next: 'c',
          },
          { id: 'two', label: '选项二', sub: '描述：禁用态示例', disabled: true, disabledReason: '条件未满足', next: 'c' },
          { id: 'three', label: '离开', sub: '多事不如少一事', end: true },
        ],
      },
      c: { text: '你做出了选择。', end: true },
    },
  };
}
