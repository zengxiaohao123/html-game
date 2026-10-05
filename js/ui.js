// ============================================================
// ui.js —— 纯 DOM 渲染层（重写版）
// 依赖：data.js / map.js / rules.js / combat.js / explore.js
// 对外暴露：window.UI
// ============================================================

window.UI = (() => {

    const DATA = window.GAME_DATA;
    const MAP  = window.MAP;
    const RULES = window.RULES;
    const COMBAT = window.COMBAT;
    const EXPLORE = window.EXPLORE;

    // ===== 工具函数 =====
    const qs  = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

    function el(tag, attrs = {}, children = []) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
            else if (k.startsWith('on')) e[k] = v;
            else e.setAttribute(k, v);
        }
        for (const c of [].concat(children)) {
            if (c == null) continue;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return e;
    }

    // ===== 全局 gameState（由 main.js 维护） =====
    let gameState = null; // { mode, session, hero, map, day }

    function bindState(s) { gameState = s; }

    // ============================================================
    // HUD 渲染
    // ============================================================
    function refreshHUD() {
        const hud = qs('#hud');
        if (!hud) return;
        const gs = gameState;
        if (!gs) return;

        const hero = gs.session ? gs.session.hero : gs.hero;
        if (!hero) return;

        const hp = Math.max(0, hero.hp);
        const hpPct = Math.max(0, Math.min(100, Math.floor((hp / hero.maxHp) * 100)));

        hud.innerHTML = '';

        // 左侧：天数 + 模式
        const left = el('div', { class: 'hud-left' });
        left.appendChild(el('span', { class: 'hud-day' }, ['第 ' + (gs.day ?? 1) + ' 天']));
        left.appendChild(el('span', { class: 'hud-mode' }, ['模式: ' + modeLabel(gs.mode)]));
        hud.appendChild(left);

        // 中间：HP 条
        const hpWrap = el('div', { class: 'hud-hp' });
        const hpBar = el('div', { class: 'hud-hp-bar' });
        hpBar.style.width = hpPct + '%';
        hpBar.style.background = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#fbbf24' : '#ef4444';
        hpWrap.appendChild(el('span', { class: 'hud-hp-label' }, ['HP ' + hp + '/' + hero.maxHp]));
        hpWrap.appendChild(hpBar);
        hud.appendChild(hpWrap);

        // 右侧：战斗信息
        if (gs.mode === 'combat' && gs.session) {
            const s = gs.session;
            const realEnemies = s.enemies.filter(e => e.alive && !e.isSelfdestruct);
            const right = el('div', { class: 'hud-right' });
            right.appendChild(el('span', { class: 'hud-round' }, ['第 ' + s.round + ' 回合']));
            right.appendChild(el('span', { class: 'hud-ap' }, ['行动 ' + s.actionCount + '/' + s.totalActionsPerRound]));
            right.appendChild(el('span', { class: 'hud-enemies' }, ['敌人 ' + realEnemies.length]));
            if (s.hero.visitedWindCell && !s.hero.hasUsedDoubleMove) {
                right.appendChild(el('span', { class: 'hud-doublemove', style: { color: '#5bc9c9', fontWeight: 'bold' } }, ['【双动就绪】']));
            }
            hud.appendChild(right);
        }
    }

    function modeLabel(m) {
        return ({ menu: '主菜单', story: '剧情', explore: '探索', combat: '战斗' })[m] || m;
    }

    // ============================================================
    // 地图渲染（回字形格子）
    // ============================================================
    function refreshMap() {
        const grid = qs('#mapGrid');
        if (!grid) return;
        const gs = gameState;
        if (!gs) return;

        const map = gs.session ? gs.session.map : gs.map;
        if (!map) return;

        const w = map.width, h = map.height;
        const cellSize = 52;
        grid.innerHTML = '';
        grid.style.width  = (w * cellSize) + 'px';
        grid.style.height = (h * cellSize) + 'px';
        grid.style.setProperty('--cell-size', cellSize + 'px');

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = map.cellAt(x, y);
                if (!cell) continue;
                grid.appendChild(_renderCell(cell, x, y, cellSize, gs));
            }
        }

        _positionUnitsOnMap(grid, map, cellSize, gs);
    }

    function _renderCell(cell, x, y, size, gs) {
        const div = el('div', {
            class: 'map-cell' + (cell.onOuterRing ? ' outer' : ' inner') + (cell.isEnemySpawnPoint ? ' spawn-point' : '') + (cell.passable ? '' : ' impassable'),
            style: {
                width: size + 'px',
                height: size + 'px',
                left: (x * size) + 'px',
                top:  (y * size) + 'px',
                background: RULES.getCellBgColor(cell),
                borderColor: cell.attach ? '#ffffff44' : '#333',
                boxShadow: cell.isEnemySpawnPoint ? 'inset 0 0 0 2px #ef4444' : undefined
            },
            'data-x': x,
            'data-y': y
        });

        // 地形图标层
        const terrain = DATA.TERRAINS[cell.terrain];
        if (terrain && terrain.icon) {
            div.appendChild(el('img', { class: 'terrain-icon', src: terrain.icon }));
        } else if (terrain && cell.terrain !== 'default') {
            // 用 emoji 临时占位（用户说不要简陋 emoji，但暂时先有个视觉提示）
            const iconMap = { river: '〰️', grass: '🌿', ice: '❄️' };
            div.appendChild(el('div', { class: 'terrain-emoji' }, [iconMap[cell.terrain] || '']));
        }

        // 元素附着提示（右上角小色块）
        if (cell.attach) {
            const color = DATA.ELEMENTS[cell.attach]?.color || '#fff';
            div.appendChild(el('div', {
                class: 'attach-dot',
                style: { background: color }
            }));
        }

        // 进攻点标记
        if (cell.isEnemySpawnPoint) {
            div.appendChild(el('div', {
                class: 'spawn-marker',
                title: '敌人进攻点'
            }, ['⚔']));
        }

        return div;
    }

    function _positionUnitsOnMap(grid, map, size, gs) {
        // 移除已有的 unit-layer
        qsa(grid, '.unit-layer').forEach(n => n.remove());

        const units = [];
        if (gs.session) {
            units.push(gs.session.hero);
            for (const e of gs.session.enemies) if (e.alive) units.push(e);
        } else {
            if (gs.hero) units.push(gs.hero);
        }

        for (const u of units) {
            if (!u || u.x == null || u.y == null) continue;
            const layer = el('div', {
                class: 'unit-layer unit-' + (u.isMainCharacter ? 'hero' : u.faction || 'enemy'),
                style: {
                    left: (u.x * size) + 'px',
                    top:  (u.y * size) + 'px',
                    width: size + 'px',
                    height: size + 'px'
                },
                title: _unitTooltip(u)
            });

            const emoji = u.isMainCharacter ? '🧙' : DATA.ENEMIES[u.id]?.name ? _elementEmoji(u.element) : '👾';
            layer.appendChild(el('div', { class: 'unit-avatar' }, [emoji]));

            // HP 小条
            if (u.maxHp && u.maxHp > 0) {
                const pct = Math.max(0, (u.hp / u.maxHp) * 100);
                layer.appendChild(el('div', { class: 'unit-hp-bar', style: { width: pct + '%' } }));
            }

            // 状态效果小标签
            if (u.status) {
                let i = 0;
                for (const key of Object.keys(u.status)) {
                    const def = DATA.STATUS_EFFECTS[key];
                    if (!def) continue;
                    if (def.type === 'attach') continue;  // 附着已经在地块上显示了
                    layer.appendChild(el('div', {
                        class: 'status-chip',
                        style: { background: def.color || '#888', left: (i * 8) + 'px' }
                    }));
                    i++;
                }
            }

            grid.appendChild(layer);
        }
    }

    function _elementEmoji(el) {
        return ({ fire: '🔥', water: '💧', grass: '🌿', thunder: '⚡', ice: '❄️', wind: '🌀', rock: '🪨' })[el] || '👾';
    }

    function _unitTooltip(u) {
        const lines = [u.name || u.id];
        if (u.isMainCharacter) {
            lines.push('HP: ' + u.hp + '/' + u.maxHp);
        } else {
            lines.push(u.element ? (DATA.ELEMENTS[u.element]?.name || '') + '元素' : '');
            lines.push('HP: ' + u.hp + '/' + u.maxHp + '  ATK: ' + u.atk + '  DEF: ' + (u.def || 0));
        }
        return lines.join('\n');
    }

    // ============================================================
    // 战斗面板渲染
    // ============================================================
    function refreshCombatPanel() {
        const gs = gameState;
        if (!gs || gs.mode !== 'combat' || !gs.session) return;
        const s = gs.session;

        // 敌人列表
        const cbCharCards = qs('#cbCharCards');
        if (cbCharCards) {
            cbCharCards.innerHTML = '';
            for (const e of s.enemies.filter(e => e.alive)) {
                cbCharCards.appendChild(_renderEnemyCard(e));
            }
        }

        // 主角属性
        const cbAttrs = qs('#cbAttrs');
        if (cbAttrs) {
            cbAttrs.innerHTML = '';
            const hero = s.hero;
            const attrs = ['ATK: ' + hero.atk, 'DEF: ' + (hero.def || 0), 'HP: ' + hero.hp + '/' + hero.maxHp];
            cbAttrs.appendChild(el('span', {}, attrs.join('  ')));
        }

        // 主角状态
        const cbStatus = qs('#cbStatusChips');
        if (cbStatus) {
            cbStatus.innerHTML = '';
            if (s.hero.status) {
                for (const [key, st] of Object.entries(s.hero.status)) {
                    const def = DATA.STATUS_EFFECTS[key];
                    if (!def) continue;
                    cbStatus.appendChild(el('div', {
                        class: 'status-chip-label',
                        title: def.description || def.name
                    }, [def.name + (st.remaining ? '(' + st.remaining + ')' : '')]));
                }
            }
            // 地块防御加成
            if (s.hero.cellDefBonus > 0) {
                cbStatus.appendChild(el('div', { class: 'status-chip-label' }, ['岩地块DEF+' + s.hero.cellDefBonus]));
            }
        }

        // 技能描述区
        const cbSkillDesc = qs('#cbSkillDesc');
        if (cbSkillDesc) {
            cbSkillDesc.innerHTML = '';
            cbSkillDesc.appendChild(el('div', { class: 'skill-hint' }, [
                'WASD 移动  |  JKL 攻击相邻格  |  E 结束回合\n' +
                (s.hero.visitedWindCell && !s.hero.hasUsedDoubleMove ? '💨 风地块已触发，双动就绪！' : '')
            ]));
        }
    }

    function _renderEnemyCard(enemy) {
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
        const card = el('div', { class: 'enemy-card' });
        card.appendChild(el('div', { class: 'enemy-name' }, [enemy.name + (enemy.isSelfdestruct ? '（自爆倒计时）' : '')]));
        card.appendChild(el('div', { class: 'enemy-hp-wrap' }, [
            el('div', { class: 'enemy-hp-bar', style: { width: hpPct + '%' } })
        ]));
        card.appendChild(el('div', { class: 'enemy-hp-text' }, [enemy.hp + '/' + enemy.maxHp]));

        // 状态标签
        if (enemy.status) {
            for (const [key, st] of Object.entries(enemy.status)) {
                const def = DATA.STATUS_EFFECTS[key];
                if (!def || def.type === 'attach') continue;
                card.appendChild(el('span', { class: 'enemy-status-tag' }, [def.name]));
            }
        }

        return card;
    }

    // ============================================================
    // 日志
    // ============================================================
    function log(msg) {
        const body = qs('#logBody');
        if (!body) return;
        body.appendChild(el('div', { class: 'log-line' }, [msg]));
        body.scrollTop = body.scrollHeight;
        // 最多保留 200 行
        while (body.children.length > 200) body.removeChild(body.firstChild);
    }

    // ============================================================
    // Toast
    // ============================================================
    function toast(msg) {
        const t = el('div', {
            class: 'ui-toast',
            style: {
                position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '8px 18px',
                borderRadius: '6px', zIndex: 99999, pointerEvents: 'none',
                fontSize: '14px', opacity: '0', transition: 'opacity 0.3s'
            }
        }, [msg]);
        document.body.appendChild(t);
        requestAnimationFrame(() => { t.style.opacity = '1'; });
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2000);
    }

    // ============================================================
    // 弹窗
    // ============================================================
    function showModal(title, bodyHtml, actions = []) {
        const overlay = qs('#modalOverlay') || el('div', { id: 'modalOverlay', class: 'modal-overlay' });
        overlay.innerHTML = '';
        const box = el('div', { class: 'modal' });
        box.appendChild(el('h2', { class: 'modal-title' }, [title]));
        const body = el('div', { class: 'modal-body' });
        if (typeof bodyHtml === 'string') body.innerHTML = bodyHtml;
        else body.appendChild(bodyHtml);
        box.appendChild(body);
        const foot = el('div', { class: 'modal-foot' });
        for (const a of actions) {
            const btn = el('button', { class: 'modal-btn' }, [a.label]);
            btn.onclick = () => { a.onClick && a.onClick(); overlay.remove(); };
            foot.appendChild(btn);
        }
        box.appendChild(foot);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    function showVictory(stage) {
        const rewardText = [];
        if (stage.reward?.items) {
            for (const it of stage.reward.items) rewardText.push(it.key + '×' + it.count);
        }
        rewardText.push('属性升级×' + stage.reward.upgradeChoice);

        showModal('战斗胜利！', null, [
            {
                label: '继续',
                onClick: () => {
                    if (gameState) {
                        gameState.mode = 'explore';
                        switchMode('explore');
                        refreshAll();
                    }
                }
            }
        ]);

        const body = el('div', {}, [
            el('p', {}, ['🎉 战斗胜利！']),
            el('p', {}, ['奖励：' + rewardText.join('、')])
        ]);
        // 重建一下 modal 的 body
        const b = qs('#modalOverlay .modal-body');
        if (b) { b.innerHTML = ''; b.appendChild(body); }
    }

    function showDefeat(stage) {
        const penaltyText = stage.healthPenaltyOnDefeat ? '健康 -' + stage.healthPenaltyOnDefeat : '';
        showModal('战斗失败...', null, [
            {
                label: '返回探索',
                onClick: () => {
                    if (gameState) {
                        gameState.mode = 'explore';
                        switchMode('explore');
                        refreshAll();
                    }
                }
            }
        ]);

        const body = el('div', {}, [
            el('p', {}, ['💀 战斗失败']),
            el('p', {}, [penaltyText || ''])
        ]);
        const b = qs('#modalOverlay .modal-body');
        if (b) { b.innerHTML = ''; b.appendChild(body); }
    }

    // ============================================================
    // 统一刷新入口
    // ============================================================
    function refreshAll() {
        refreshHUD();
        refreshMap();
        if (gameState && gameState.mode === 'combat') refreshCombatPanel();
    }

    // ============================================================
    // 键盘输入（战斗中）
    // ============================================================
    function bindCombatInput(session) {
        const handler = (e) => {
            if (!gameState || gameState.mode !== 'combat' || gameState.session !== session) {
                document.removeEventListener('keydown', handler);
                return;
            }

            if (COMBAT.isBattleOver(session)) return;

            let dir = null;
            let attackDir = null;

            switch (e.key.toLowerCase()) {
                case 'w': dir = [0, -1]; attackDir = [0, -1]; break;
                case 's': dir = [0, 1];  attackDir = [0, 1];  break;
                case 'a': dir = [-1, 0]; attackDir = [-1, 0]; break;
                case 'd': dir = [1, 0];  attackDir = [1, 0];  break;
                case 'e':
                case ' ':
                    COMBAT.endPlayerTurn(session);
                    refreshAll();
                    return;
            }

            if (dir) {
                e.preventDefault();
                const res = COMBAT.playerMove(session, dir);
                if (!res.ok && res.reason === 'no_action_points') {
                    COMBAT.endPlayerTurn(session);
                }
                refreshAll();

                if (COMBAT.isBattleOver(session)) {
                    _handleBattleEnd(session);
                }
            }
        };
        document.addEventListener('keydown', handler);
        return handler;
    }

    function _handleBattleEnd(session) {
        setTimeout(() => {
            if (session.phase === COMBAT.PHASE.WIN) {
                const stage = session.stage;
                toast('战斗胜利！');
                showVictory(stage);
            } else if (session.phase === COMBAT.PHASE.LOSE) {
                const stage = session.stage;
                toast('战斗失败...');
                showDefeat(stage);
            }
        }, 400);
    }

    // ============================================================
    // 键盘输入（探索中）
    // ============================================================
    function bindExploreInput(session) {
        const handler = (e) => {
            if (!gameState || gameState.mode !== 'explore') {
                document.removeEventListener('keydown', handler);
                return;
            }
            let dir = null;
            switch (e.key.toLowerCase()) {
                case 'w': dir = [0, -1]; break;
                case 's': dir = [0, 1];  break;
                case 'a': dir = [-1, 0]; break;
                case 'd': dir = [1, 0];  break;
                case 'f':
                    // 空地搜索
                    const res = EXPLORE.search(session);
                    if (res.ok) {
                        if (res.event === 'battle') {
                            toast('遭遇战斗！');
                            startBattleFromExplore(res.stageId);
                        } else if (res.event === 'pickup') {
                            toast('拾取: ' + res.items.map(i => i.key + '×' + i.count).join(', '));
                        } else {
                            toast('这里什么都没有...');
                        }
                    }
                    refreshAll();
                    return;
            }
            if (dir) {
                e.preventDefault();
                const res = EXPLORE.move(session, dir);
                if (!res.ok) toast(_exploreFailReason(res.reason));
                refreshAll();
            }
        };
        document.addEventListener('keydown', handler);
        return handler;
    }

    function _exploreFailReason(r) {
        return ({ out_of_bounds: '边界了', occupied: '被挡了', river_blocked: '河流不能过', defeat_by_river: '意外进入河流...' })[r] || r;
    }

    // ============================================================
    // 入口：从探索模式触发战斗
    // ============================================================
    function startBattleFromExplore(stageId) {
        const gs = gameState;
        if (!gs) return;

        const session = COMBAT.createBattle({ stageId });
        // 把探索中的主角传过去
        session.hero.x = gs.exploreSession.hero.x;
        session.hero.y = gs.exploreSession.hero.y;

        gs.session = session;
        gs.mode = 'combat';
        switchMode('combat');
        COMBAT.startBattle(session);
        log('⚔️ 战斗开始！关卡：' + session.stage.name);
        refreshAll();
        bindCombatInput(session);

        session.onEvent = (evt) => {
            if (evt.type === 'log') log('[' + evt.round + '] ' + evt.msg);
        };
    }

    // ============================================================
    // init
    // ============================================================
    function init() {
        // 监听 DOMContentLoaded 后的全局 UI 初始化
        // 具体的事件绑定由 startNewGame 里调用 bindCombatInput / bindExploreInput
    }

    return {
        init, bindState,
        refreshAll, refreshHUD, refreshMap, refreshCombatPanel,
        log, toast, showModal, showVictory, showDefeat,
        bindCombatInput, bindExploreInput,
        startBattleFromExplore,
        // 暴露给老 main.js 的 polyfill 接口
        refreshAll: refreshAll,
        toast: toast
    };
})();