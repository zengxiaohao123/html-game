/**
 * data/facilities.js —— 设施数据（§6.9.4）
 * 设施作为 entity 占格；相邻格可交互；拆除返还 ceil(材料×0.5)。
 */

export const FACILITIES = {
  tent: {
    id: 'tent', name: '帐篷',
    desc: '简陋却温馨的庇护所。可以在此睡觉以进入下一天。睡觉时自动存档。',
    cost: { wood: 1, linen: 1 },
    startOwned: 1,           // 初始背包自带 1 个
    onWater: false,
    actions: ['sleep', 'demolish'],
  },
  campfire: {
    id: 'campfire', name: '篝火',
    desc: '可以烹饪食物。',
    cost: { wood: 6 },
    onWater: false,
    actions: ['cook', 'demolish'],
    lifecycle: 'lit',       // lit / extinguished
    notes: '放置时受 1 次火附着；水/冰附着→熄灭；2 天后自动熄灭（放置当天算第 1 天）。',
  },
  campfireOut: {
    id: 'campfireOut', name: '熄灭的篝火',
    desc: '已经没法使用了。需要重新点燃。',
    cost: null,             // 不可建造、不进背包
    onWater: false,
    actions: ['demolish'],
    notes: '受火附着→变回篝火。',
  },
  pump: {
    id: 'pump', name: '抽水泵',
    desc: '放置在水面上就会自动开始抽水。',
    cost: { wood: 4 },
    onWater: true,          // 只能放水面
    actions: ['collect', 'demolish'],
    storage: { item: 'water', perDay: 1, max: 10 },
  },
};

export function getFacility(id) { return FACILITIES[id] ?? null; }

/** 背包 facilities 分类中始终展示的可建造设施（含未拥有） */
export const BUILDABLE_FACILITIES = Object.values(FACILITIES).filter((f) => f.cost);
