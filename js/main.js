// =============================================================
// main.js —— 全局状态 G + 启动链路（重写版）
// 新 API：MAP.generate() / COMBAT.createBattle() / EXPLORE.createExplore()
// 全局 UI 对象由 ui.js 提供（UI.init / UI.refreshAll / UI.toast ...）
// =============================================================

const G = {
    mode: 'menu',            // menu / story / explore / combat
    day: 0,
    hero: null,              // 通用英雄对象（新战斗 session 创建时会复制关键属性）
    map: null,               // 旧 explore map（兼容）
    exploreSession: null,    // EXPLORE session
    session: null,           // COMBAT session（战斗时）
};

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
    // 1. 主角基础属性
    G.hero = {
        id: 'hero', name: '勇者', isMainCharacter: true,
        hp: 100, maxHp: 100,
        atk: 20, def: 5,
        speed: 5, status: {}, alive: true
    };

    // 2. 旧 event.js 可能依赖的全局容器
    G.inventory = { coin: 50 };
    G.records = {};
    G.vehicles = [];

    // 3. 绑定 UI 状态
    UI.bindState(G);
    UI.init();

    // 4. 隐藏主菜单
    const overlay = document.getElementById('menuOverlay');
    if (overlay) overlay.classList.remove('show');

    // 5. 直接进探索模式（跳过剧情，剧情后续接 main_story）
    G.day = 1;
    _enterExploreMode();

    UI.refreshAll();
    UI.toast('第 ' + G.day + ' 天开始了。');
}

function _enterExploreMode() {
    G.exploreSession = EXPLORE.createExplore({});
    G.hero = G.exploreSession.hero;
    G.map = G.exploreSession.map;
    G.session = null;

    G.mode = 'explore';
    switchMode('explore');
    UI.log('=== 第 ' + G.day + ' 天 —— 探索模式 ===');
    UI.bindExploreInput(G.exploreSession);
}

function _enterCombatMode(stageId) {
    const session = COMBAT.createBattle({ stageId });
    // 把探索中的主角位置传过去
    if (G.exploreSession) {
        session.hero.x = G.exploreSession.hero.x;
        session.hero.y = G.exploreSession.hero.y;
    }
    // 同步属性
    if (G.hero) {
        session.hero.hp = G.hero.hp;
        session.hero.maxHp = G.hero.maxHp;
        session.hero.atk = G.hero.atk;
        session.hero.def = G.hero.def;
    }

    session.onEvent = (evt) => {
        if (evt.type === 'log') UI.log('[' + evt.round + '] ' + evt.msg);
    };

    G.session = session;
    G.mode = 'combat';
    switchMode('combat');
    COMBAT.startBattle(session);
    UI.log('⚔️ 战斗开始！关卡：' + session.stage.name);
    UI.bindCombatInput(session);
}

// ---------------------------------------------------------------
// 模式切换
// ---------------------------------------------------------------
function switchMode(mode) {
    G.mode = mode;
    document.body.classList.remove('mode-explore', 'mode-combat', 'mode-story', 'mode-menu');
    document.body.classList.add('mode-' + mode);

    const storyBox  = document.getElementById('storyBox');
    const combatZone = document.getElementById('combatZone');
    const bottom = document.getElementById('bottom');
    if (bottom) {
        bottom.classList.remove('mode-explore', 'mode-combat', 'mode-story', 'mode-menu');
        bottom.classList.add('mode-' + mode);
    }

    if (mode === 'combat') {
        if (storyBox) storyBox.style.display = 'none';
        if (combatZone) combatZone.style.display = '';
    } else {
        if (storyBox) storyBox.style.display = 'none';
        if (combatZone) combatZone.style.display = 'none';
    }
}

// ---------------------------------------------------------------
// 全局对象暴露 + Legacy Polyfills
// ---------------------------------------------------------------
window.G = G;
window.switchMode = switchMode;
window.renderMainMenu = renderMainMenu;
window.startNewGame = startNewGame;
window._enterExploreMode = _enterExploreMode;
window._enterCombatMode = _enterCombatMode;

// --- main_story / event.js 可能调用的 ---
if (typeof window.showActTitle !== 'function') window.showActTitle = () => {};
if (typeof window.onModalX !== 'function') window.onModalX = () => {};
if (typeof window.renderIconbar !== 'function') window.renderIconbar = () => {
    const ib = document.getElementById('iconbar'); if (!ib) return;
    const playing = !!window.mainStoryPlaying;
    ib.querySelectorAll('button, .ibtn').forEach(b => { b.disabled = playing; b.style.opacity = playing ? '0.4' : '1'; });
};
// --- event.js 调用：startCombat ---
window.startCombat = function(opt) {
    const stageId = opt.stageId || opt.scene || 'slime_time';
    _enterCombatMode(stageId);
    UI.refreshAll();
};
// 老 event.js 可能用的 START_COMBAT
if (typeof window.START_COMBAT !== 'function') {
    window.START_COMBAT = function(map, x, y, scene) {
        const stageId = (scene && scene.id) || 'slime_time';
        _enterCombatMode(stageId);
    };
}
if (typeof window.gainAffinity !== 'function') window.gainAffinity = () => {};
if (typeof window.ALLIES === 'undefined') window.ALLIES = [];
if (typeof window.RES_ZH === 'undefined') window.RES_ZH = {};
if (typeof window.isInStoryFlow !== 'function') window.isInStoryFlow = () => G.mode === 'story';
if (typeof window.isInFlow !== 'function') window.isInFlow = () => G.mode === 'story';
if (typeof window.heroDisplayMaxHp !== 'function') window.heroDisplayMaxHp = () => G.hero?.maxHp || 100;
if (typeof window.heroineMaxHp !== 'function') window.heroineMaxHp = () => G.hero?.maxHp || 100;

// --- Legacy 渲染函数 polyfill ---
if (typeof window.refreshHUD !== 'function') window.refreshHUD = () => UI.refreshHUD();
if (typeof window.renderMap !== 'function')  window.renderMap  = () => UI.refreshMap();

// ---------------------------------------------------------------
// 开发快捷键
// ---------------------------------------------------------------
window.addEventListener('keydown', (e) => {
    if (e.key === 'F9' && G.mode !== 'explore' && G.mode !== 'combat') {
        if (!G.hero || G.day === 0) {
            startNewGame();
        } else {
            _enterExploreMode();
            UI.refreshAll();
        }
        UI.toast('F9：快速进入探索模式');
    }
    if (e.key === 'F10' && G.mode === 'explore') {
        _enterCombatMode('slime_time');
        UI.refreshAll();
    }
    if (e.key === 'F11' && G.mode === 'explore') {
        _enterCombatMode('slime_rampage');
        UI.refreshAll();
    }
});

// ---------------------------------------------------------------
// 最终兜底
// ---------------------------------------------------------------
window.addEventListener('load', () => {
    setTimeout(() => {
        if (typeof G !== 'undefined' && G.day === 0) {
            console.log('[fallback] force start');
            startNewGame();
        }
    }, 3000);
});