// =============================================================
// main.js —— 全局状态 G + mode 切换
// =============================================================

const G = {
  mode: 'explore',   // 'explore' | 'combat' | 'story'
  day: 1,            // day=0 为剧情静态画面，day=1 才生成第一张回字形地图
  hero: null,        // hero entity 全局引用（主角的"状态数据"，不是 COMBAT 里的战斗实例）
  map: null,         // 当前地图
  px: 0, py: 0,      // 主角当前所在格坐标（探索模式下）
  gameOver: false,
};

// ---------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------
function initGame() {
  // 初始化主角（简化模板，后续接完整角色数据）
  G.hero = {
    key: 'pro',
    name: '主角',
    facing: 'up',
    hp: 100, maxHp: 100,
    atk: 10, def: 0,
    speed: 5,
    actionPoint: 6, maxActionPoint: 6,
    health: 100,
    talent: null,
  };

  // 跳过 day=0（剧情），直接从 day=1 开始
  G.day = 1;
  G.map = MAP.generateMap();
  const spawn = MAP.pickHeroSpawn(G.map, null);
  G.px = spawn.x; G.py = spawn.y;

  UI.init();
  UI.refreshAll();
}

// ---------------------------------------------------------------
// 模式切换
// ---------------------------------------------------------------
function switchMode(mode) {
  G.mode = mode;
  document.body.classList.remove('mode-explore', 'mode-combat', 'mode-story');
  document.body.classList.add(`mode-${mode}`);
}

// ---------------------------------------------------------------
// 导出
// ---------------------------------------------------------------
window.G = G;
window.switchMode = switchMode;
window.initGame = initGame;
// Legacy polyfill — 旧剧情模块引用的全局函数
if (typeof window.showActTitle !== "function") window.showActTitle = () => {};
if (typeof window.onModalX !== "function") window.onModalX = () => {};

