// src/data/stories.js
// ─────────────────────────────────────────────────────────────────────────────
// 剧情 / 事件脚本数据（§16.5）
// ─────────────────────────────────────────────────────────────────────────────
// UI 层（src/ui/StoryUI.js）只读本数据结构，禁止在 UI 里写死任何文案。
//
// StoryScript 结构：
//   {
//     id:     脚本 id（用于事件与冒烟断言）
//     title:  标题（本轮按需求不渲染标题行；仅作为 aria/title 与日志用）
//     icon:   剧情区左侧圆形徽记的图标（emoji 字符串；缺省 🎲）
//     start:  起始节点 key
//     nodes:  { [key]: StoryNode }
//     onEnd?: (ctx) => void
//   }
//
// StoryNode 结构：
//   {
//     text:    正文；字符串或字符串数组（数组按段渲染，段间空一行）；支持 \n 换行
//     options?: Option[]    存在即进入「选项区等待选择」，不显示「继续」指示
//     next?:   无选项时的下一节点；缺省 = 本脚本结束
//     end?:    true = 本节点结束脚本
//     onEnter?: (ctx) => void
//   }
//
// Option 结构：
//   {
//     id?:      选项 id
//     label:    主标题（必填）
//     sub?:     副标题（代价 / 后果，一行灰字）
//     detail?:  选中后展开的详情（参考图第二张的展开文案）
//     disabled?: true = 灰化不可选
//     disabledReason?: 禁用原因（随副标题一起显示）
//     safe?:    true = 单击即生效，不走二次确认（如「离开」）
//     next?:    跳转节点
//     end?:     true = 选择后结束脚本
//     onSelect?: (ctx) => void
//   }
//
// ctx = { gs, script, nodeKey, option, ui }
// ─────────────────────────────────────────────────────────────────────────────

/** 占位正文（正式事件池定稿后整段替换，UI 无需改动） */
const PH_BODY = '（占位正文：事件与剧情的正式文案待事件池定稿后录入，此处仅用于验证剧情区排版与逐段推进。）';

/**
 * 由占位事件池条目生成一段事件脚本（RES-001 事件点进入时调用）。
 * 文案全部来自条目自身字段，不在 UI 层写死。
 * @param {{id:string,name:string}} entry 占位事件池条目
 * @param {{onEnd?:Function}} [opts]
 * @returns {object} StoryScript
 */
export function buildEventStory(entry, opts = {}) {
  const name = entry?.name || '占位事件';
  return {
    id: `story_${entry?.id || 'ph'}`,
    title: name,
    icon: '🎲',
    start: 'intro',
    nodes: {
      intro: {
        text: [
          '你在这块地方停下了脚步。',
          `${name}。\n${PH_BODY}`,
        ],
        next: 'choice',
      },
      choice: {
        text: '你打算怎么做？',
        options: [
          {
            id: 'look',
            label: '仔细查看',
            sub: '花点时间弄清楚这里发生了什么',
            detail: `${PH_BODY}`,
            next: 'looked',
          },
          {
            id: 'take',
            label: '顺手拿走',
            sub: '能拿的东西就先拿着',
            detail: `${PH_BODY}`,
            next: 'taken',
          },
          {
            id: 'leave',
            label: '离开',
            sub: '多事不如少一事',
            safe: true,
            end: true,
          },
        ],
      },
      looked: {
        text: `${PH_BODY}\n看完之后，你把这里恢复成原样。`,
        next: 'choice2',
      },
      taken: {
        text: `${PH_BODY}\n你把东西塞进了背包。`,
        next: 'choice2',
      },
      choice2: {
        text: '该走了。',
        options: [
          { id: 'back', label: '继续赶路', sub: '今天还有别的事要做', safe: true, end: true },
        ],
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
      a: { text: ['这是第一段占位剧情。', '点击剧情区、按空格或回车，推进到下一段。'], next: 'b' },
      b: {
        text: '这里出现选项：选项区在屏幕右侧，首次点击进入待确认，再次点击生效。',
        options: [
          { id: 'one', label: '选项一', sub: '副标题：代价或后果写在这里', detail: PH_BODY, next: 'c' },
          { id: 'two', label: '选项二', sub: '副标题：禁用态示例', disabled: true, disabledReason: '条件未满足', next: 'c' },
          { id: 'three', label: '离开', sub: '多事不如少一事', safe: true, end: true },
        ],
      },
      c: { text: '你做出了选择。', end: true },
    },
  };
}
