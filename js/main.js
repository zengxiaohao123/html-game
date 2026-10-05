// =============================================================
// main.js —— 全局状态 G + mode 切换 + 启动链路
// =============================================================

const G = {
  mode: 'menu',
  day: 0,
  hero: null,
  map: null,
  px: 0, py: 0,
  gameOver: false,
  // event.js / vehicle.js 依赖的全局容器（初始化在 startNewGame 里）
  inventory: null,
  records: null,
  vehicles: null,
};

// ---------------------------------------------------------------
// 启动
// ---------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  renderMainMenu();
});

// ---------------------------------------------------------------
// 主菜单
// ---------------------------------------------------------------
function renderMainMenu() {
  const btns = document.getElementById('menuBtns');
  if (!btns) return;
  btns.innerHTML = '';

  const newBtn = document.createElement('button');
  newBtn.className = 'mbtn';
  newBtn.textContent = '新游戏';
  newBtn.onclick = () => startNewGame();
  btns.appendChild(newBtn);

  const loadBtn = document.createElement('button');
  loadBtn.className = 'mbtn';
  loadBtn.textContent = '读取存档';
  loadBtn.onclick = () => alert('读档功能后续接。');
  btns.appendChild(loadBtn);
}

function startNewGame() {
  // 1. 初始化主角
  G.hero = {
    key: 'pro', name: '主角', facing: 'up',
    hp: 100, maxHp: 100,
    atk: 10, def: 0, speed: 5,
    actionPoint: 6, maxActionPoint: 6,
    health: 100,
    psyStress: 0,
  };

  // 2. 旧 event.js 依赖的全局容器
  G.inventory = { coin: 50 };
  G.records = {};
  G.vehicles = [];

  // 3. 初始化 UI（事件监听等）
  UI.init();

  // 4. day=0 剧情态
  G.day = 0;

  // 5. 隐藏主菜单 overlay
  const overlay = document.getElementById('menuOverlay');
  if (overlay) overlay.classList.remove('show');

  // 6. 切剧情态 + 触发 main_story 第 0 幕
  switchMode('story');
  if (window.triggerMainStorySeg) {
    window.triggerMainStorySeg();
  } else {
    storyAdvanceDayToOneFallback();
  }
}

// ---------------------------------------------------------------
// 剧情播完 → 由 main_story 调 storyAdvanceDayToOne → 进入探索
// 覆盖 main_story 的同名函数（在原始脚本之后执行）
// ---------------------------------------------------------------
window._origAdvance = window.storyAdvanceDayToOne;
window.storyAdvanceDayToOne = () => {
  if (window._origAdvance) window._origAdvance();
  storyAdvanceDayToOneFallback();
};

function storyAdvanceDayToOneFallback() {
  G.day = 1;
  G.map = MAP.generateMap();
  const spawn = MAP.pickHeroSpawn(G.map, null);
  G.px = spawn.x; G.py = spawn.y;
  G.mode = 'explore';
  switchMode('explore');
  UI.refreshAll();
  UI.toast(`新的一天，第 ${G.day} 天。`);
}

// ---------------------------------------------------------------
// 模式切换（统一入口）
// ---------------------------------------------------------------
function switchMode(mode) {
  G.mode = mode;
  document.body.classList.remove('mode-explore', 'mode-combat', 'mode-story');
  document.body.classList.add(`mode-${mode}`);

  const storyBox  = document.getElementById('storyBox');
  const combatZone = document.getElementById('combatZone');
  const bottom = document.getElementById('bottom');
  if (bottom) {
    bottom.classList.remove('mode-explore', 'mode-combat', 'mode-story');
    bottom.classList.add(`mode-${mode}`);
  }

  if (mode === 'combat') {
    if (storyBox) storyBox.style.display = 'none';
    if (combatZone) combatZone.style.display = '';
  } else if (mode === 'story') {
    if (storyBox) storyBox.style.display = '';
    if (combatZone) combatZone.style.display = 'none';
  } else {
    // explore
    if (storyBox) storyBox.style.display = 'none';
    if (combatZone) combatZone.style.display = 'none';
  }
}

// ---------------------------------------------------------------
// UI 对象 polyfill（旧 ui.js 是全局函数形式，main.js 用 UI.xxx）
// ---------------------------------------------------------------
const UI = {
  init() {
    // 旧 ui.js 没有 init 函数，这里空操作
  },
  refreshAll() {
    try { refreshHUD(); } catch(e) {}
    try { renderMap(); } catch(e) {}
    try { _renderCharCards(); } catch(e) {}
    try { _renderSkillGroup(); } catch(e) {}
    try { renderIconbar(); } catch(e) {}
  },
  refreshMap() { try { renderMap(); } catch(e) {} },
  refreshHUD() { try { refreshHUD(); } catch(e) {} },
  toast(msg) {
    // 旧 ui.js 没有 toast，用简单 alert 或自定义小弹层
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.75); color:#fff; padding:8px 16px; border-radius:6px; z-index:9999; pointer-events:none;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  },
};
window.UI = UI;

window.G = G;
window.switchMode = switchMode;
window.renderMainMenu = renderMainMenu;
window.startNewGame = startNewGame;

// ---------------------------------------------------------------
// Legacy polyfills
// ---------------------------------------------------------------

// main_story 调用
if (typeof window.showActTitle !== 'function') window.showActTitle = () => {};
if (typeof window.onModalX !== 'function') window.onModalX = () => {};
if (typeof window.renderIconbar !== 'function') {
  window.renderIconbar = function() {
    const iconbar = document.getElementById('iconbar');
    if (!iconbar) return;
    const playing = !!window.mainStoryPlaying;
    const btns = iconbar.querySelectorAll('button, .ibtn');
    for (const b of btns) {
      b.disabled = playing;
      b.style.opacity = playing ? '0.4' : '1';
    }
  };
}
if (typeof window.refreshHUD !== 'function') window.refreshHUD = () => { UI.refreshHUD(); UI.refreshMap(); };
if (typeof window.renderMap !== 'function')  window.renderMap  = () => UI.refreshMap();

// event.js 调用
window.startCombat = function(opt) {
  const map = opt.map || G.map;
  const x = opt.x ?? G.px;
  const y = opt.y ?? G.py;
  let scene = opt.scene || DATA.getBattleSceneByContentType('battle') || DATA.BATTLE_SCENES.slimeNormal;
  START_COMBAT(map, x, y, scene);
};
if (typeof window.gainAffinity !== 'function') window.gainAffinity = () => {};
if (typeof window.ALLIES === 'undefined') window.ALLIES = [];
if (typeof window.RES_ZH === 'undefined') window.RES_ZH = {};

// 旧 ui.js / save.js 依赖的缺失全局 —— 一次性 polyfill
if (typeof window.isInStoryFlow !== 'function') {
  window.isInStoryFlow = () => G.mode === 'story' || !!window.mainStoryPlaying;
}
if (typeof window.isInFlow !== 'function') {
  window.isInFlow = () => window.isInStoryFlow();
}
if (typeof window.heroDisplayMaxHp !== 'function') {
  window.heroDisplayMaxHp = () => G.hero ? (G.hero.maxHp || 100) : 100;
}
if (typeof window.heroineMaxHp !== 'function') {
  window.heroineMaxHp = () => G.hero ? (G.hero.maxHp || 100) : 100;
}


// ===== 开发调试快捷键（跳过剧情） =====
window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    // 直接进探索模式，跳过 main_story
    if (!G.hero) {
      startNewGame();
      // startNewGame 会进 story，手动回退
      G.day = 1;
      if (G.map) {
        // 已经 startNewGame 里生成了 day=0 的 story，我们再 regenerate
      }
      G.map = MAP.generateMap();
      const spawn = MAP.pickHeroSpawn(G.map, null);
      G.px = spawn.x; G.py = spawn.y;
    } else if (G.day === 0 || G.mode === 'story') {
      G.day = 1;
      G.map = MAP.generateMap();
      const spawn = MAP.pickHeroSpawn(G.map, null);
      G.px = spawn.x; G.py = spawn.y;
    }
    G.mode = 'explore';
    switchMode('explore');
    UI.refreshAll();
    UI.toast('F9：跳过剧情进入探索模式。');
  }
});

// ===== 最终兜底：不管什么情况，新游戏按钮按下后 8 秒一定进探索 =====
// 用一个全局定时器，setTimeout 后强制检查
window.addEventListener('load', () => {
  setTimeout(() => {
    if (typeof G !== 'undefined' && G.day === 0 && G.mode === 'story') {
      console.log('[FINAL-FALLBACK] load 8s later: force advance');
      G.day = 1;
      if (typeof MAP !== 'undefined' && typeof MAP.generateMap === 'function') {
        G.map = MAP.generateMap();
        const spawn = MAP.pickHeroSpawn(G.map, null);
        G.px = spawn.x; G.py = spawn.y;
      }
      G.mode = 'explore';
      if (typeof switchMode === 'function') switchMode('explore');
      if (typeof UI !== 'undefined' && UI.refreshAll) UI.refreshAll();
    }
  }, 8000);
});

window.storyAdvanceDayToOneFallback = function() {
  G.day = 1;
  G.map = MAP.generateMap();
  const spawn = MAP.pickHeroSpawn(G.map, null);
  G.px = spawn.x; G.py = spawn.y;
  G.mode = 'explore';
  switchMode('explore');
  UI.refreshAll();
};
