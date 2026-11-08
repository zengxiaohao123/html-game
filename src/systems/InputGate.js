// src/systems/InputGate.js
// 输入门控（第 13 批回归修复）：用「显式阻塞原因 + 面板白名单」代替原来的
// 「openPanels 栈非空即锁死」。
//
// 语义（与设计文档 §16.4 / §16.5 / §16.6 / §16.14 / §16.20 对齐）：
//   · info（信息区）是常驻侧栏：普通 tab 打开时探索模式一切正常，不阻塞移动 / 祈福 / 睡觉；
//   · 全屏 / 模态面板（背包、角色、编队、合成、载具、任务、图鉴、商店、设置）独占输入；
//   · 主菜单是真的模态遮罩，必须阻塞；
//   · 剧情 / 事件（DialogBox，无论有没有选项）期间禁止移动 / 祈福 / 睡觉；
//   · 祈福动画播放期间：可移动、可睡觉；不可再次祈福（blessing 标记自身互斥）。

/** 阻塞原因常量（便于排查「为什么现在不能动」） */
export const INPUT_BLOCK = {
  MAIN_MENU: 'mainMenu',
  BUILD_MODE: 'buildMode',
  MODAL_PANEL: 'modalPanel',
  STORY: 'story',
};

/**
 * 独占输入的面板白名单。
 * 注意：'info' 故意不在名单里 —— 信息区打开时探索模式不锁输入（§16.14）。
 */
export const MODAL_PANEL_KEYS = new Set([
  'settings', 'inventory', 'role', 'team', 'forge', 'vehicle', 'task', 'codex',
  'shop', 'magicShop',
]);

export function isModalPanelKey(panel) {
  return !!panel && MODAL_PANEL_KEYS.has(panel);
}

/**
 * 计算当前所有阻塞原因（每次按键实时计算，不留缓存，避免状态漂移）
 * @returns {string[]}
 */
export function getInputBlockReasons(director) {
  if (!director) return [];
  const gs = typeof director.getGS === 'function' ? director.getGS() : director.gs;
  const reasons = [];

  if (director.mainMenu?.visible) reasons.push(INPUT_BLOCK.MAIN_MENU);
  if (gs?.buildMode === true) reasons.push(INPUT_BLOCK.BUILD_MODE);
  if ((director.openPanels || []).some(isModalPanelKey) || director.settingsPanel?.visible) {
    reasons.push(INPUT_BLOCK.MODAL_PANEL);
  }
  // 剧情 / 事件进行中（StoryUI，含剧情区与选项区）：禁止移动 / 祈福 / 睡觉
  if (director.storyUI?.visible) reasons.push(INPUT_BLOCK.STORY);
  // DialogBox 承担确认弹窗（含剧情跳过确认）：显示期间同样视为「剧情/事件进行中」
  if (director.dialogBox?.visible) reasons.push(INPUT_BLOCK.STORY);

  return reasons;
}

/** 移动（WASD / 前往）是否被阻塞 */
export function isMovementBlocked(director) {
  return getInputBlockReasons(director).length > 0;
}

/** 祈福是否被阻塞（含祈福动画进行中） */
export function isBlessBlocked(director) {
  if (isMovementBlocked(director)) return true;
  const gs = typeof director?.getGS === 'function' ? director.getGS() : director?.gs;
  return gs?.uiState?.blessing === true;
}

/** 睡觉是否被阻塞（剧情 / 事件期间禁止；祈福动画期间允许） */
export function isSleepBlocked(director) {
  return isMovementBlocked(director);
}

/** 剧情 / 事件是否正在进行（面板类快捷键在此期间也不响应） */
export function isStoryBlocked(director) {
  return getInputBlockReasons(director).includes(INPUT_BLOCK.STORY);
}

/**
 * 快捷栏 1~0 是否被阻塞。
 * 建造模式允许（§16.14）；信息区允许；仅主菜单 / 模态面板 / 剧情事件时阻塞。
 */
export function isHotbarBlocked(director) {
  const reasons = getInputBlockReasons(director);
  return reasons.includes(INPUT_BLOCK.MAIN_MENU)
    || reasons.includes(INPUT_BLOCK.MODAL_PANEL)
    || reasons.includes(INPUT_BLOCK.STORY);
}

/** 开发期排查入口：打印当前门控状态（不改变任何状态） */
export function debugInputState(director) {
  const gs = typeof director?.getGS === 'function' ? director.getGS() : director?.gs;
  return {
    buildMode: gs?.buildMode === true,
    blessing: gs?.uiState?.blessing === true,
    stack: [...(director?.openPanels || [])],
    mainMenu: !!director?.mainMenu?.visible,
    dialog: !!director?.dialogBox?.visible,
    blockReasons: getInputBlockReasons(director),
  };
}
