// ============================================================
// ui.js —— DOM 渲染层（重写 v2）
// 复用老 CSS 约定：.cell / .attach-bg / .entIcon / .entHpEnemy
// grid 布局：动态设 grid-template-columns
// ============================================================

window.UI = (() => {

    const DATA = window.GAME_DATA;
    const MAP  = window.MAP;
    const RULES = window.RULES;
    const COMBAT = window.COMBAT;
    const EXPLORE = window.EXPLORE;

    const qs  = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

    function el(tag, attrs, children) {
        attrs = attrs || {};
        children = [].concat(children == null ? [] : children);
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
            else if (k.startsWith('on') && typeof v === 'function') e[k.toLowerCase()] = v;
            else e.setAttribute(k, v);
        }
        for (const c of children) {
            if (c == null || c === false) continue;
            e.appendChild(typeof c === 'string' || typeof c === 'number'
                ? document.createTextNode(String(c)) : c);
        }
        return e;
    }

    let gameState = null;
    function bindState(s) { gameState = s; }

    // ============================================================
    // 统一刷新
    // ============================================================
    function refreshAll() {
        refreshHUD();
        refreshMap();
        if (gameState && gameState.mode === 'combat') refreshCombatPanel();
    }

    // ============================================================
    // HUD
    // ============================================================
    function refreshHUD() {
        const hud = qs('#hud'); if (!hud || !gameState) return;
        const gs = gameState;
        const hero = gs.session ? gs.session.hero : gs.hero;
        if (!hero) return;

        const hp = Math.max(0, hero.hp);
        const hpPct = Math.max(0, Math.min(100, Math.floor((hp / hero.maxHp) * 100)));

        hud.innerHTML = '';
        hud.appendChild(el('span', { class: 'hud-day' }, ['第 ' + (gs.day ?? 1) + ' 天']));
        hud.appendChild(el('span', { class: 'hud-mode' }, ['| ' + ({ menu:'菜单', story:'剧情', explore:'探索', combat:'战斗' })[gs.mode]]));

        // HP
        const hpBox = el('div', { class: 'hud-hp' });
        const hpBar = el('div', { class: 'hud-hp-bar', style: { width: hpPct + '%', background: hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#fbbf24' : '#ef4444' } });
        hpBox.appendChild(el('span', {}, ['HP ' + hp + '/' + hero.maxHp]));
        hpBox.appendChild(hpBar);
        hud.appendChild(hpBox);

        if (gs.mode === 'combat' && gs.session) {
            const s = gs.session;
            const alive = s.enemies.filter(e => e.alive && !e.isSelfdestruct).length;
            const right = el('div', { class: 'hud-right' });
            right.appendChild(el('span', {}, ['第 ' + s.round + ' 回合']));
            right.appendChild(el('span', {}, ['| 行动 ' + s.actionCount + '/' + s.totalActionsPerRound]));
            right.appendChild(el('span', {}, ['| 敌人 ' + alive]));
            if (s.hero.visitedWindCell && !s.hero.hasUsedDoubleMove)
                right.appendChild(el('span', { style: { color: '#5bc9c9', fontWeight: 'bold' } }, ['| 【双动就绪】']));
            hud.appendChild(right);
        }
    }

    // ============================================================
    // 地图渲染（核心修复！）
    // ============================================================
    function refreshMap() {
        const grid = qs('#mapGrid'); if (!grid || !gameState) return;
        const gs = gameState;
        const map = gs.session ? gs.session.map : gs.map;
        if (!map) return;

        const w = map.width, h = map.height;
        grid.innerHTML = '';

        // 关键修复：grid 设列！让 cell 正确排成 w 列
        grid.style.gridTemplateColumns = `repeat(${w}, 44px)`;
        grid.style.gridTemplateRows    = `repeat(${h}, 44px)`;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = map.cellAt(x, y);
                grid.appendChild(_renderCell(cell, x, y, gs));
            }
        }

        // 主角指示器（绝对定位覆盖在 mapGrid 上）
        _renderHeroMarker(grid, map, gs);
    }

    function _renderCell(cell, x, y, gs) {
        // 老 CSS 用 .cell 类：44×44 + border-radius:8px + flex 居中
        const classes = ['cell'];

        // 地形
        if (!cell.onOuterRing) {
            classes.push('void');     // 内部空心
        } else if (cell.terrain === 'river') {
            // river 默认不可进入，但 player 类会覆盖背景色显示主角位置
        } else if (!cell.passable) {
            classes.push('obstacle');
        }

        // 元素附着（加 elem-xxx class，老 CSS 会自动显示半透明背景）
        let attachElement = null;
        if (cell.attach) {
            attachElement = typeof cell.attach === 'string' ? cell.attach : cell.attach.element;
            const elemClass = 'elem-' + attachElement;
            classes.push(elemClass);
        }

        if (cell.isEnemySpawnPoint) classes.push('enemyPick');

        const div = el('div', { class: classes.join(' '), 'data-x': x, 'data-y': y });

        // 元素附着背景层（老 CSS .attach-bg 规则）
        if (attachElement) {
            div.appendChild(el('div', { class: 'attach-bg' }));
        }

        // 进攻点图标
        if (cell.isEnemySpawnPoint) {
            div.appendChild(el('div', { class: 'layer layer-spawn' }, ['⚔']));
        }

        // 单位渲染（敌人在格子内部，player 也在这里渲染）
        if (cell.unit && cell.unit.alive && (cell.unit.faction === 'enemy' || cell.unit.faction === 'player')) {
            div.appendChild(_renderUnitInCell(cell.unit));
            // player 加朝向指示（可选）
            if (cell.unit.faction === 'player' && cell.unit.facing) {
                div.appendChild(el('div', { class: 'hero-facing facing-' + cell.unit.facing }));
            }
        }

        return div;
    }

    function _renderUnitInCell(unit) {
        if (unit.faction === 'player') {
            // 主角：金色圆球（用 hero-dot 样式）
            const entIcon = el('div', { class: 'entIcon heroIcon', title: (unit.name || '勇者') + '  HP:' + unit.hp + '/' + unit.maxHp });
            entIcon.appendChild(el('div', { class: 'hero-dot' }));
            const hpPct = Math.max(0, (unit.hp / unit.maxHp) * 100);
            const hpBar = el('div', { class: 'entHpEnemy', style: { width: hpPct + '%' } });
            return el('div', {}, [entIcon, hpBar]);
        }
        // 敌人
        const emoji = unit.isSelfdestruct ? '💣' : _elementEmoji(unit.element);
        const entIcon = el('div', { class: 'entIcon enemyIcon', title: unit.name + '  HP:' + unit.hp + '/' + unit.maxHp }, [emoji]);
        const hpPct = Math.max(0, (unit.hp / unit.maxHp) * 100);
        const hpBar = el('div', { class: 'entHpEnemy', style: { width: hpPct + '%' } });
        return el('div', {}, [entIcon, hpBar]);
    }

    function _elementEmoji(el) {
        return ({ fire:'🔥', water:'💧', grass:'🌿', thunder:'⚡', ice:'❄️', wind:'🌀', rock:'🪨' })[el] || '👾';
    }

    // 主角指示器：确保 grid 有 position:relative（cell 内已经渲染了 hero）
    function _renderHeroMarker(grid, map, gs) {
        // 确保 mapGrid 有 position: relative（给绝对定位元素做包含块）
        if (grid && typeof getComputedStyle !== 'undefined') {
            try {
                const computed = getComputedStyle(grid);
                if (computed && computed.position === 'static') grid.style.position = 'relative';
            } catch(e) { /* ignore */ }
        }
    }

    // ============================================================
    // 战斗面板
    // ============================================================
    function refreshCombatPanel() {
        const gs = gameState;
        if (!gs || gs.mode !== 'combat' || !gs.session) return;
        const s = gs.session;

        const cbCharCards = qs('#cbCharCards');
        if (cbCharCards) {
            cbCharCards.innerHTML = '';
            for (const e of s.enemies.filter(e => e.alive)) {
                const card = el('div', { class: 'enemy-card' });
                card.appendChild(el('div', { class: 'enemy-name' }, [e.name + (e.isSelfdestruct ? '（倒计时）' : '')]));
                const pct = Math.max(0, (e.hp / e.maxHp) * 100);
                card.appendChild(el('div', { class: 'enemy-hp-wrap' }, [el('div', { class: 'enemy-hp-bar', style: { width: pct + '%' } })]));
                cbCharCards.appendChild(card);
            }
        }

        const cbSkillDesc = qs('#cbSkillDesc');
        if (cbSkillDesc) {
            cbSkillDesc.innerHTML = 'WASD 移动  |  JKL 攻击相邻格  |  E/空格 结束回合\n' +
                (s.hero.visitedWindCell && !s.hero.hasUsedDoubleMove ? '💨 风地块已触发，双动就绪！' : '');
        }
    }

    // ============================================================
    // 日志 / Toast / Modal
    // ============================================================
    function log(msg) {
        const body = qs('#logBody'); if (!body) return;
        body.appendChild(el('div', { class: 'log-line' }, [msg]));
        body.scrollTop = body.scrollHeight;
        while (body.children.length > 300) body.removeChild(body.firstChild);
    }

    function toast(msg) {
        const t = el('div', {
            style: {
                position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 20px',
                borderRadius: '6px', zIndex: 99999, pointerEvents: 'none',
                fontSize: '14px', opacity: '0', transition: 'opacity 0.25s'
            }
        }, [msg]);
        document.body.appendChild(t);
        requestAnimationFrame(() => { t.style.opacity = '1'; });
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2000);
    }

    // ============================================================
    // 战斗输入（WASD 移动 + WASD+Shift 攻击 + E/空格 结束回合）
    // ============================================================
    function bindCombatInput(session) {
        const onKey = (e) => {
            if (!gameState || gameState.mode !== 'combat' || gameState.session !== session) {
                document.removeEventListener('keydown', onKey); return;
            }
            if (COMBAT.isBattleOver(session)) return;

            let dir = null;
            switch (e.key.toLowerCase()) {
                case 'w': dir = [0, -1]; break;
                case 's': dir = [0, 1];  break;
                case 'a': dir = [-1, 0]; break;
                case 'd': dir = [1, 0];  break;
                case 'e': case ' ':
                    e.preventDefault();
                    COMBAT.endPlayerTurn(session);
                    refreshAll();
                    _afterBattleEnd(session);
                    return;
            }
            if (dir) {
                e.preventDefault();
                const res = COMBAT.playerMove(session, dir);
                if (!res.ok && res.reason === 'no_action_points') COMBAT.endPlayerTurn(session);
                refreshAll();
                if (COMBAT.isBattleOver(session)) _afterBattleEnd(session);
            }
        };
        document.addEventListener('keydown', onKey);
        return onKey;
    }

    function _afterBattleEnd(session) {
        setTimeout(() => {
            if (session.phase === COMBAT.PHASE.WIN) {
                toast('🎉 战斗胜利！');
                setTimeout(() => _backToExplore(), 600);
            } else if (session.phase === COMBAT.PHASE.LOSE) {
                toast('💀 战斗失败');
                setTimeout(() => _backToExplore(), 600);
            }
        }, 300);
    }

    function _backToExplore() {
        if (!gameState) return;
        // 恢复探索地图（战斗可能改了位置）
        if (gameState.exploreSession) {
            gameState.session = null;
            gameState.map = gameState.exploreSession.map;
            gameState.hero = gameState.exploreSession.hero;
        }
        gameState.mode = 'explore';
        if (typeof window.switchMode === 'function') window.switchMode('explore');
        refreshAll();
    }

    // ============================================================
    // 探索输入（WASD 移动 + F 空地搜索）
    // ============================================================
    function bindExploreInput(session) {
        const onKey = (e) => {
            if (!gameState || gameState.mode !== 'explore') {
                document.removeEventListener('keydown', onKey); return;
            }
            let dir = null;
            switch (e.key.toLowerCase()) {
                case 'w': dir = [0, -1]; break;
                case 's': dir = [0, 1];  break;
                case 'a': dir = [-1, 0]; break;
                case 'd': dir = [1, 0];  break;
                case 'f':
                    e.preventDefault();
                    const res = EXPLORE.search(session);
                    if (res.ok) {
                        if (res.event === 'battle') {
                            toast('⚔️ 遭遇战斗！');
                            window._enterCombatMode(res.stageId);
                        } else if (res.event === 'pickup') {
                            toast('拾取：' + res.items.map(i => i.key + '×' + i.count).join(', '));
                        } else {
                            toast('这里什么都没有...');
                        }
                    } else {
                        const reasonMap = { not_inside: '外圈不能搜索', already_searched: '已经搜过了' };
                        toast(reasonMap[res.reason] || '');
                    }
                    refreshAll();
                    return;
            }
            if (dir) {
                e.preventDefault();
                const res = EXPLORE.move(session, dir);
                if (!res.ok) {
                    const m = ({ out_of_bounds:'边界了', occupied:'被挡了', river_blocked:'河流不能过' })[res.reason] || res.reason;
                    if (m) toast(m);
                }
                refreshAll();
            }
        };
        document.addEventListener('keydown', onKey);
        return onKey;
    }

    function init() {}

    return {
        init, bindState,
        refreshAll, refreshHUD, refreshMap, refreshCombatPanel,
        log, toast,
        bindCombatInput, bindExploreInput
    };
})();