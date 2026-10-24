// src/data/resources.js
// 5 种资源类地块内容定义（与 facilities.js 里的 resource_* 条目相互独立但通过同一套 HookDispatcher 注册）
// 说明：resources.js 主要作为静态数据表供 UI/调试读取；hook 注册写在 facilities.js 里（与设施同模式）。

export const RESOURCES = {
  resource_event: {
    id: 'resource_event',
    name: '事件点',
    emoji: '🎲',
  },
  resource_reward: {
    id: 'resource_reward',
    name: '奖励点',
    emoji: '🎁',
  },
  resource_hunt: {
    id: 'resource_hunt',
    name: '狩猎点',
    emoji: '⚔️',
  },
  resource_shop: {
    id: 'resource_shop',
    name: '商店',
    emoji: '🏪',
  },
  resource_bus: {
    id: 'resource_bus',
    name: '巴士站',
    emoji: '🚌',
  },
};

export const ALL_RESOURCE_IDS = Object.keys(RESOURCES);
