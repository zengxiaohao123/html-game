// =============================================================
// ui.js —— UI 渲染层
// 核心新逻辑：多实体堆叠 2 秒循环切换图标、主角用指示点、敌人进攻点标记
// =============================================================

// ---------------------------------------------------------------
// 多实体循环切换当前显示哪个（2 秒频率）
// ---------------------------------------------------------------
let _entityStackIdx = {};   // cellKey → 当前显示的实体 index
let _entityStackTimer = null;
const STACK_SWITCH_MS = 2000;

function startStackRotationLoop() {
  if (_entityStackTimer) return;
  _entityStackTimer = setInterval(() => {
    // 遍历 COMBAT.map（如果战斗中）或 G.map（探索中）
    const map = (COMBAT && COMBAT.map) || G.map;
    if (!map) return;
    for (const c of map.cells) {
      if (c.entities && c.entities.length > 1) {
        const key = `${c.x},${c.y}`;
        _entityStackIdx[key] = ((_entityStackIdx[key] || 0) + 1) % c.entities.length;
      }
    }
    refreshMapView();
  }, STACK_SWITCH_MS);
}

function stopStackRotationLoop() {
  if (_entityStackTimer) {
    clearInterval(_entityStackTimer);
    _entityStackTimer = null;
  }
  _entityStackIdx = {};
}

function currentEntityIconForCell(cell) {
  if (!cell.entities || cell.entities.length === 0) return null;
  if (cell.entities.length === 1) return cell.entities[0];
  const key = `${cell.x},${cell.y}`;
  const idx = _entityStackIdx[key] || 0;
  return cell.entities[idx];
}

// ---------------------------------------------------------------
// UI 主入口
// ---------------------------------------------------------------
const UI = {
  init() {
    // 绑定键盘输入（main.js 之后调用）
    document.addEventListener('keydown', onKeydown);
    // 开启多实体循环
    startStackRotationLoop();
  },

  switchMode(mode) {
    switchMode(mode);  // 调用 main.js 的全局函数
    if (mode === 'explore') stopStackRotationLoop(); else startStackRotationLoop();
  },

  refreshAll() {
    refreshHUD();
    refreshMap();
  },

  refreshHUD() {
    // 先不实现完整 HUD 结构，占位
    const el = document.getElementById('hud');
    if (!el) return;
    el.innerHTML = `
      第 ${G.day} 天 · 行动力 ${G.hero.actionPoint}/${G.hero.maxActionPoint}
      · HP ${G.hero.hp}/${G.hero.maxHp}
      · 健康 ${G.hero.health}/100
    `;
  },

  refreshMap() { refreshMapView(); },

  refreshCombat() {
    refreshMapView();
    refreshCombatHUD();
  },

  toast(text) {
    // 简易 toast
    let t = document.getElementById('_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_toast';
      t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:6px;z-index:9999;pointer-events:none;opacity:0;transition:opacity .3s;';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  },

  log(text) {
    // 简易日志（打印到控制台 + 追加到 #leftLog 或简易容器）
    console.log(`[LOG] ${text}`);
  },

  showStatChoice(choices, count) {
    // 后续接弹窗 UI，先 log
    UI.log(`属性升级 ${count} 选 ${choices.length}`);
  },
};

window.UI = UI;

// ---------------------------------------------------------------
// 地图视图渲染（核心：主角指示点 + 多实体图标 + 进攻点标记 + 地块 content + 附着）
// ---------------------------------------------------------------
function refreshMapView() {
  const map = (COMBAT && COMBAT.map) || G.map;
  if (!map) return;

  const grid = document.getElementById('mapGrid');
  if (!grid) return;

  grid.innerHTML = '';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${map.width}, 64px)`;
  grid.style.gridTemplateRows = `repeat(${map.height}, 64px)`;
  grid.style.gap = '2px';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = MAP.getCell(map, x, y);
      const div = document.createElement('div');
      div.className = 'map-cell';
      div.dataset.x = x;
      div.dataset.y = y;

      // 地形底色
      if (cell.terrain === 'void') {
        div.style.background = '#222';
      } else {
        div.style.background = '#3a5';
      }

      // content 图标（探索模式才显示；content._hidden === true 表示战斗中隐藏）
      if (cell.content && !cell.content._hidden) {
        const label = cell.contentLabel || contentIconLabel(cell.content.type);
        const icon = document.createElement('div');
        icon.className = 'cell-content';
        icon.textContent = label;
        div.appendChild(icon);
      }

      // 元素附着标记
      if (cell.attach) {
        const at = document.createElement('div');
        at.className = 'cell-attach';
        at.textContent = DATA.ELEMENT_NAME_CN[cell.attach] || cell.attach;
        at.style.cssText = 'position:absolute;top:2px;right:2px;font-size:10px;background:rgba(255,255,255,.7);padding:1px 4px;border-radius:3px;';
        div.style.position = 'relative';
        div.appendChild(at);
      }

      // 敌人进攻点标记
      if (cell.isEnemySpawnPoint) {
        const sp = document.createElement('div');
        sp.className = 'spawn-point';
        sp.textContent = 'X';   // 占位图标，等素材
        sp.style.cssText = 'position:absolute;top:2px;left:2px;font-size:14px;color:red;font-weight:bold;';
        div.style.position = 'relative';
        div.appendChild(sp);
      }

      // 实体（堆叠：只显示当前轮转到的那一个）
      const cur = currentEntityIconForCell(cell);
      if (cur) {
        const ent = document.createElement('div');
        ent.className = `entity ent-${cur.kind}`;
        if (cur.key === 'pro') {
          // 主角：指示点（圆形）
          ent.innerHTML = `<div style="width:24px;height:24px;border-radius:50%;background:#ffcc00;border:2px solid #fff;position:relative;"><div style="position:absolute;top:50%;left:50%;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid #fff;transform:translate(-50%,-100%);${facingArrow(cur.facing)}"></div></div>`;
        } else {
          // 其他实体：显示名字 + 小色块区分阵营
          ent.textContent = cur.name || cur.key;
          ent.style.cssText = `color:#fff;padding:2px;font-size:12px;border-radius:4px;background:${factionColor(cur.faction)};`;
        }
        div.appendChild(ent);
      }

      // 点击事件：选中地块 → 右侧 promptZone 更新
      div.addEventListener('click', () => {
        onCellClick(x, y);
      });

      grid.appendChild(div);
    }
  }
}

function factionColor(f) {
  return ({ player: '#2a7', enemy: '#b44', neutral: '#888', summon_player: '#48c', summon_enemy: '#a64' })[f] || '#666';
}

function facingArrow(f) {
  // 箭头指向表示朝向（CSS rotate）
  const rot = ({ up: 0, right: 90, down: 180, left: 270 })[f] || 0;
  return `transform:translate(-50%,-100%) rotate(${rot}deg);`;
}

function contentIconLabel(ct) {
  const map = {
    'empty':     '',        // 空地无图标
    'terrain':   '山',      // 地形
    'battle':    '⚔',
    'emergency': '⚡',
    'reward':    '★',
    'event':     '?',
    'loot':      '$',
  };
  return map[ct] || '';
}

// ---------------------------------------------------------------
// 战斗 HUD 刷新
// ---------------------------------------------------------------
function refreshCombatHUD() {
  // 简易：在 leftLog 里显示回合计数
  const grid = document.getElementById('combatInfo');
  if (!grid) return;
  grid.textContent = `回合 ${COMBAT.turn} · 阶段 ${COMBAT.phase}`;
}

// ---------------------------------------------------------------
// 点击地块 → 前往按钮
// ---------------------------------------------------------------
let _selectedCell = null;
function onCellClick(x, y) {
  _selectedCell = { x, y };
  const prompt = document.getElementById('promptZone');
  const goBtn  = document.getElementById('goBtn');
  if (prompt) {
    const map = (COMBAT && COMBAT.map) || G.map;
    const cell = MAP.getCell(map, x, y);
    prompt.innerHTML = `(${x+1}, ${y+1}) · terrain: ${cell.terrain} · content: ${cell.content ? cell.content.type : 'none'} ${cell.entities && cell.entities.length ? `· 实体:${cell.entities.length}` : ''}`;
  }
  if (goBtn) {
    const dist = G.mode === 'explore'
      ? RULES.manhattan({ x: G.px, y: G.py }, { x, y })
      : (COMBAT ? RULES.manhattan({ x: COMBAT.heroEntity.x, y: COMBAT.heroEntity.y }, { x, y }) : 99);
    goBtn.disabled = dist > 1;
    goBtn.textContent = dist > 1 ? '太远了' : `前往 (${x+1}, ${y+1})`;
    goBtn.onclick = () => {
      if (G.mode === 'explore') EXPLORE.tryExploreGoTo(x, y);
    };
  }
}

// ---------------------------------------------------------------
// 键盘输入（通用：探索 / 战斗都用 WASD）
// ---------------------------------------------------------------
function onKeydown(e) {
  if (G.mode === 'explore') {
    if (e.key === 'w' || e.key === 'W') EXPLORE.tryExploreMove('up');
    else if (e.key === 's' || e.key === 'S') EXPLORE.tryExploreMove('down');
    else if (e.key === 'a' || e.key === 'A') EXPLORE.tryExploreMove('left');
    else if (e.key === 'd' || e.key === 'D') EXPLORE.tryExploreMove('right');
  } else if (G.mode === 'combat') {
    if (!COMBAT || COMBAT.phase !== 'playerManual' || COMBAT.ended) return;
    if (e.key === 'w' || e.key === 'W') tryCombatMove('up');
    else if (e.key === 's' || e.key === 'S') tryCombatMove('down');
    else if (e.key === 'a' || e.key === 'A') tryCombatMove('left');
    else if (e.key === 'd' || e.key === 'D') tryCombatMove('right');
    else if (e.key === 'f' || e.key === 'F') tryCombatSkip();
  }
}
