// src/data/events/evt_peddler_01.js
// 《歇脚的游商》—— 每日限 1 次；单层三选一。
// 文案逐字来自《事件库.xlsx》事件总表 / 节点表 / 选项表（前者优先）。

export default {
  id: 'evt_peddler_01',
  name: '歇脚的游商',
  icon: '🍯',
  weight: 1,
  repeatability: 'daily',
  start: 'intro',
  nodes: {
    intro: {
      text: '林间通向小镇的岔路口停着一辆小木推车。推车上铺着褪色粗麻布，摆着几罐浸了草药的蜜浆。守车的老妇正低头整理捆扎好的干香草，她没有主动招呼，只是任由淡淡的药香在风里散开。',
      options: [
        {
          id: 'honey',
          label: '买下一罐蜜浆',
          sub: '恢复40%生命值',
          effects: [{ type: 'heal', percent: 0.4 }],
          next: 'honey_end',
        },
        {
          id: 'help',
          label: '帮她捆扎散落的香草束',
          sub: '行动力+2',
          effects: [{ type: 'stamina', amount: 2 }],
          next: 'help_end',
        },
        {
          id: 'leave',
          label: '不予理会',
          sub: '多一事不如少一事',
          next: 'leave_end',
        },
      ],
    },
    honey_end: {
      text: '蜜浆入喉，草本的暖意慢慢漫开，身上的伤痛随之缓缓平复。',
      end: true,
    },
    help_end: {
      text: '你帮她将四散的香草整理捆好。老妇向你指明一条更近的小路，省却不少跋涉的气力。',
      end: true,
    },
    leave_end: {
      text: '你没有上前搭话，继续沿着道路向前行进。',
      end: true,
    },
  },
};
