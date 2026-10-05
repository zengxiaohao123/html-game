// =============================================================
// main.js —— 全局状态 G + 启动链路
// 剧情 → 探索 → 战斗 完整链路
// =============================================================

const G = {
    mode: 'menu',            // menu / story / explore / combat
    day: 0,
    hero: null,
    px: 0, py: 0,
    map: null,
    exploreSession: null,
    session: null,           // combat session
    inventory: null,
    records: null,
    vehicles: null,
};

window.G = G;

window.addEventListener('DOMContentLoaded', () => {
    renderMainMenu();
});

// ===== 主菜单 =====
function renderMainMenu() {
    const btns = document.getElementById('menuBtns'); if (!btns) return;
    btns.innerHTML = '';
    const nb = document.createElement('button');
    nb.className = 'mbtn'; nb.textContent = '新游戏';
    nb.onclick = () => startNewGame();
    btns.appendChild(nb);
    const lb = document.createElement('button');
    lb.className = 'mbtn'; lb.textContent = '读取存档';
    lb.onclick = () => alert('读档功能后续接');
    btns.appendChild(lb);
}
window.renderMainMenu = renderMainMenu;

// ===== 新游戏启动 =====
function startNewGame() {
    G.hero = {
        id: 'hero', name: '勇者', isMainCharacter: true,
        hp: 100, maxHp: 100, atk: 20, def: 5,
        speed: 5, status: {}, alive: true, facing: 'up'
    };
    G.inventory = { coin: 50 };
    G.records = {};
    G.vehicles = [];
    G.day = 0;

    UI.bindState(G);
    UI.init();

    const overlay = document.getElementById('menuOverlay');
    if (overlay) overlay.classList.remove('show');

    // 先尝试触发 main_story 第 0 幕剧情
    // main_story/index.js 是 <script type="module">，加载可能晚于普通 script
    // 所以第一次调可能只有 HEAD polyfill（空函数）
    let storyStarted = false;
    if (typeof window.triggerMainStorySeg === 'function') {
        try {
            storyStarted = window.triggerMainStorySeg() === true;
        } catch (e) { storyStarted = false; }
    }

    if (!storyStarted) {
        // main_story 还没加载 —— 先进入探索模式保证 UI 可见
        _enterExploreMode();
    } else {
        // 剧情已触发 —— 切了 story 模式，等剧情播完后 storyAdvanceDayToOne 会推进 day=1 并进入探索
        G.mode = 'story';
        switchMode('story');
    }

    UI.refreshAll();
}
window.startNewGame = startNewGame;

// ===== 进入探索模式 =====
function _enterExploreMode() {
    G.exploreSession = EXPLORE.createExplore({});
    G.hero = G.exploreSession.hero;
    G.map = G.exploreSession.map;
    G.px = G.hero.x; G.py = G.hero.y;
    G.session = null;
    G.mode = 'explore';
    switchMode('explore');
    UI.log('=== 第 ' + G.day + ' 天 —— 探索模式 ===');
    UI.bindExploreInput(G.exploreSession);
    UI.refreshAll();
}
window._enterExploreMode = _enterExploreMode;

// ===== 进入战斗模式 =====
function _enterCombatMode(stageId) {
    const session = COMBAT.createBattle({ stageId });
    // 同步主角
    if (G.exploreSession) {
        session.hero.x = G.exploreSession.hero.x;
        session.hero.y = G.exploreSession.hero.y;
    }
    if (G.hero) {
        session.hero.hp = G.hero.hp;
        session.hero.maxHp = G.hero.maxHp;
        session.hero.atk = G.hero.atk;
        session.hero.def = G.hero.def;
    }
    session.onEvent = (evt) => { if (evt.type === 'log') UI.log('[' + evt.round + '] ' + evt.msg); };

    G.session = session;
    G.mode = 'combat';
    switchMode('combat');
    COMBAT.startBattle(session);
    UI.log('⚔️ 战斗开始：' + session.stage.name);
    UI.bindCombatInput(session);
    UI.refreshAll();
}
window._enterCombatMode = _enterCombatMode;

// ===== 模式切换（核心修复！mode 类必须加到 #bottom 上，CSS 选择器才能命中）=====
function switchMode(mode) {
    G.mode = mode;

    // body 上也加一份（兼容可能的旧样式）
    document.body.className = document.body.className.replace(/mode-\w+/g, '').trim();
    document.body.classList.add('mode-' + mode);

    // ★ 关键修复：CSS 规则是 #bottom.mode-story #storyBox / #bottom.mode-combat #combatZone
    // 所以 mode 类必须加到 #bottom 上
    const bottom = document.getElementById('bottom');
    if (bottom) {
        bottom.className = bottom.className.replace(/mode-\w+/g, '').trim();
        bottom.classList.add('mode-' + mode);
    }

    // 清空内联 display（让 CSS 规则接管 show/hide）
    const sb = document.getElementById('storyBox');
    const cz = document.getElementById('combatZone');
    if (sb) sb.style.display = '';
    if (cz) cz.style.display = '';
}
window.switchMode = switchMode;

// ===== Legacy Polyfills（供老 main_story / event.js 调用）=====
if (typeof window.showActTitle !== 'function') window.showActTitle = () => {};
if (typeof window.onModalX !== 'function') window.onModalX = () => {};
if (typeof window.renderIconbar !== 'function') window.renderIconbar = () => {};
if (typeof window.refreshHUD !== 'function') window.refreshHUD = () => UI.refreshHUD();
if (typeof window.renderMap !== 'function')  window.renderMap  = () => UI.refreshMap();

window.startCombat = function(opt) {
    const sid = opt.stageId || opt.scene || 'slime_time';
    _enterCombatMode(sid);
};
if (typeof window.START_COMBAT !== 'function') {
    window.START_COMBAT = function(_map, _x, _y, scene) {
        _enterCombatMode((scene && scene.id) || 'slime_time');
    };
}
if (typeof window.gainAffinity !== 'function') window.gainAffinity = () => {};
if (typeof window.ALLIES === 'undefined') window.ALLIES = [];
if (typeof window.RES_ZH === 'undefined') window.RES_ZH = {};
if (typeof window.isInStoryFlow !== 'function') window.isInStoryFlow = () => G.mode === 'story' || !!window.mainStoryPlaying;
if (typeof window.isInFlow !== 'function') window.isInFlow = () => window.isInStoryFlow();
if (typeof window.heroDisplayMaxHp !== 'function') window.heroDisplayMaxHp = () => G.hero ? (G.hero.maxHp || 100) : 100;
if (typeof window.heroineMaxHp !== 'function') window.heroineMaxHp = () => G.hero ? (G.hero.maxHp || 100) : 100;

// ===== storyAdvanceDayToOne：main_story 剧情播完后调 =====
window.storyAdvanceDayToOne = function() {
    G.day = 1;
    setTimeout(() => {
        _enterExploreMode();
        UI.toast('第 ' + G.day + ' 天开始了。');
    }, 300);
};

// ===== 开发快捷键 =====
window.addEventListener('keydown', (e) => {
    if (e.key === 'F9' && (G.mode === 'menu' || G.mode === 'story')) {
        if (!G.hero) startNewGame();
        G.day = 1;
        _enterExploreMode();
        UI.toast('F9：快速进入探索');
    }
    if (e.key === 'F10' && G.mode === 'explore') {
        _enterCombatMode('slime_time');
    }
    if (e.key === 'F11' && G.mode === 'explore') {
        _enterCombatMode('slime_rampage');
    }
});

// ===== 兜底 =====
window.addEventListener('load', () => {
    setTimeout(() => {
        if (typeof G !== 'undefined' && G.day === 0 && G.mode === 'menu') {
            console.log('[fallback] force start');
            startNewGame();
        }
    }, 4000);
});