// ============================================================
// combat.js —— 战斗状态机（重写版）
// 规格参考：docs/03-战斗系统.md 全文
// ============================================================

window.COMBAT = (() => {

    const DATA = window.GAME_DATA;
    const MAP  = window.MAP;
    const RULES = window.RULES;

    const PHASE = {
        IDLE: 'idle',
        PLAYER_TURN: 'player_turn',
        ENEMY_ACTION: 'enemy_action',
        RESOLVING: 'resolving',
        WIN: 'win',
        LOSE: 'lose'
    };

    function createBattle(options = {}) {
        const stage = DATA.BATTLE_STAGES[options.stageId] || DATA.BATTLE_STAGES.slime_time;
        const map = MAP.generate(9, 9, {
            spawnPointCount: stage.spawnPointCount,
            spawnAvoidOverlap: stage.spawnAvoidOverlap
        });

        const hero = {
            id: 'hero', name: '勇者', faction: 'player', isMainCharacter: true,
            atk: options.heroAtk ?? 20, def: options.heroDef ?? 5,
            maxHp: options.heroHp ?? 100, hp: options.heroHp ?? 100,
            speed: 5, status: {}, skills: options.heroSkills || [],
            innateTalents: [], immunities: [], cellDefBonus: 0,
            hasUsedDoubleMove: false, visitedWindCell: false,
            alive: true
        };
        MAP.placeUnit(map, hero, 0, map.height - 1);

        return {
            stage, map, hero, enemies: [],
            round: 0, phase: PHASE.IDLE,
            actionCount: 0, totalActionsPerRound: 5,
            onEvent: options.onEvent || (() => {})
        };
    }

    function startBattle(session) {
        session.phase = PHASE.PLAYER_TURN;
        _startNewRound(session);
    }

    function _startNewRound(session) {
        session.round++;
        session.actionCount = 0;
        session.hero.cellDefBonus = 0;
        session.hero.hasUsedDoubleMove = false;
        session.hero.visitedWindCell = false;

        RULES.onTurnStart(session.map);

        for (const e of session.enemies) {
            if (!e.alive) continue;
            RULES.tickStatusEffects(e);
            RULES.applyCellElementEffects(session.map, e);
        }
        RULES.tickStatusEffects(session.hero);
        RULES.applyCellElementEffects(session.map, session.hero);

        if (session.round <= session.stage.spawnRounds) {
            _spawnNewEnemies(session);
        }

        _logEvent(session, '=== 第 ' + session.round + ' 回合 ===');
        session.phase = PHASE.PLAYER_TURN;
    }

    function _spawnNewEnemies(session) {
        const pool = session.stage.enemyPool;
        const candidates = session.map.cells.filter(
            c => c.isEnemySpawnPoint && c.passable && !c.unit
        );
        if (candidates.length === 0) return;

        const cell = candidates[Math.floor(Math.random() * candidates.length)];
        const enemyId = pool[Math.floor(Math.random() * pool.length)];
        const enemyDef = DATA.ENEMIES[enemyId];
        if (!enemyDef) return;

        const day = (window.SAVE && window.SAVE.getDay && window.SAVE.getDay()) || 1;
        const hp = day <= 12 ? enemyDef.maxHp - 60 : enemyDef.maxHp;

        const uid = enemyId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const enemy = {
            ...enemyDef,
            id: uid, hp, maxHp: enemyDef.maxHp,
            alive: true, status: {}, cellDefBonus: 0
        };

        MAP.placeUnit(session.map, enemy, cell.x, cell.y);
        session.enemies.push(enemy);
        _logEvent(session, enemy.name + ' 出现在进攻点！');
    }

    function playerMove(session, dir, fromVehicle = false) {
        if (session.phase !== PHASE.PLAYER_TURN) return { ok: false, reason: 'not_player_turn' };
        if (session.actionCount >= session.totalActionsPerRound) return { ok: false, reason: 'no_action_points' };
        if (session.hero.status && session.hero.status.freeze && session.hero.status.freeze.remaining > 0)
            return { ok: false, reason: 'frozen' };

        const [dx, dy] = dir;
        const tx = session.hero.x + dx;
        const ty = session.hero.y + dy;

        const check = RULES.canMoveTo(session.map, session.hero, tx, ty, { fromVehicle });
        if (!check.ok) return { ok: false, reason: check.reason };

        const toCell = session.map.cellAt(tx, ty);
        if (toCell.terrain === 'river') {
            MAP.moveUnit(session.map, session.hero, tx, ty);
            const result = RULES.handleRiverEnter(session.map, session.hero, true, false);
            if (result && result.type === 'main_defeat') {
                session.phase = PHASE.LOSE;
                _logEvent(session, '勇者意外进入河流，战斗失败！（健康 -1）');
                return { ok: false, reason: 'defeat_by_river' };
            }
        }

        MAP.moveUnit(session.map, session.hero, tx, ty);
        session.actionCount++;
        _logEvent(session, '勇者移动到 (' + tx + ', ' + ty + ')');

        const currentCell = session.map.cellAt(session.hero.x, session.hero.y);
        if (currentCell.attach === 'wind') session.hero.visitedWindCell = true;
        const prevCell = session.map.cellAt(session.hero.x - dx, session.hero.y - dy);
        if (prevCell && prevCell.attach === 'wind') session.hero.visitedWindCell = true;

        const slide = RULES.processIceSlide(session.map, session.hero, dir, true, fromVehicle);
        if (slide) {
            MAP.moveUnit(session.map, session.hero, tx + slide.dx, ty + slide.dy);
            _logEvent(session, '冰面！勇者被迫向前滑动 1 格');
        }

        RULES.applyCellElementEffects(session.map, session.hero);

        if (session.actionCount >= session.totalActionsPerRound) _endPlayerTurn(session);
        return { ok: true };
    }

    function triggerDoubleMove(session, dir) {
        if (!session.hero.visitedWindCell) return { ok: false, reason: 'no_wind_trigger' };
        if (session.hero.hasUsedDoubleMove) return { ok: false, reason: 'already_used' };
        if (session.actionCount >= session.totalActionsPerRound) return { ok: false, reason: 'no_action_points' };

        const result = playerMove(session, dir, false);
        if (result.ok) {
            session.hero.hasUsedDoubleMove = true;
            _logEvent(session, '【双动】触发！第二次移动');
        }
        return result;
    }

    function playerAttack(session, direction) {
        if (session.phase !== PHASE.PLAYER_TURN) return { ok: false, reason: 'not_player_turn' };
        if (session.actionCount >= session.totalActionsPerRound) return { ok: false, reason: 'no_action_points' };

        const [dx, dy] = direction;
        const target = session.map.cellAt(session.hero.x + dx, session.hero.y + dy);
        if (!target || !target.unit) return { ok: false, reason: 'no_target' };
        const enemy = target.unit;
        if (enemy.faction !== 'enemy') return { ok: false, reason: 'not_enemy' };

        const dmg = RULES.calcDamage({
            attacker: session.hero, defender: enemy,
            baseAtk: session.hero.atk, atkRatio: 1.0, element: 'physical'
        });

        if (enemy.innateTalents && enemy.innateTalents.some(t => t.id === 'rockshield')) {
            enemy.def = Math.max(0, enemy.def - 1);
        }

        enemy.hp -= dmg.finalDamage;
        session.actionCount++;
        _logEvent(session, '勇者攻击 ' + enemy.name + '，造成 ' + dmg.finalDamage + ' 伤害' + (enemy.hp <= 0 ? '（击败！）' : ''));

        if (enemy.hp <= 0) {
            enemy.alive = false;
            session.map.cellAt(enemy.x, enemy.y).unit = null;
            _onEnemyDefeated(session, enemy);
        }

        _checkWinLose(session);
        if (session.actionCount >= session.totalActionsPerRound) _endPlayerTurn(session);
        return { ok: true, damage: dmg.finalDamage, enemyDead: enemy.hp <= 0 };
    }

    function _onEnemyDefeated(session, enemy) {
        const selfDestruct = enemy.innateTalents && enemy.innateTalents.find(t => t.id === 'selfdestruct');
        if (selfDestruct) {
            const sdUnit = {
                id: 'sd_' + enemy.id, name: '即将爆炸的火史莱姆',
                faction: 'enemy', isSelfdestruct: true,
                x: enemy.x, y: enemy.y, alive: true,
                hp: 1, atk: 10, maxHp: 1,
                explosionRound: session.round + selfDestruct.explosionRound,
                aoe: selfDestruct.aoe, atkRatio: selfDestruct.atkRatio, element: selfDestruct.element
            };
            MAP.placeUnit(session.map, sdUnit, enemy.x, enemy.y);
            session.enemies.push(sdUnit);
            _logEvent(session, '即将爆炸的火史莱姆在 (' + enemy.x + ', ' + enemy.y + ') 出现！' + sdUnit.explosionRound + ' 回合后爆炸');
        }

        const windvortex = enemy.innateTalents && enemy.innateTalents.find(t => t.id === 'windvortex');
        if (windvortex) {
            const realAlive = session.enemies.filter(e => e.alive && !e.isSelfdestruct).length;
            if (realAlive > 0) _triggerWindVortex(session, enemy, windvortex);
        }
    }

    function _triggerWindVortex(session, deadEnemy, talent) {
        const candidates = [];
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (Math.abs(dx) + Math.abs(dy) > 2) continue;
                const c = session.map.cellAt(deadEnemy.x + dx, deadEnemy.y + dy);
                if (c && c.unit) candidates.push(c);
            }
        }
        if (candidates.length === 0) return;
        const targetCell = candidates[Math.floor(Math.random() * candidates.length)];
        const targetUnit = targetCell.unit;
        const destCell = session.map.cellAt(deadEnemy.x, deadEnemy.y);

        targetCell.unit = null;
        destCell.unit = targetUnit;
        targetUnit.x = deadEnemy.x;
        targetUnit.y = deadEnemy.y;

        if (targetUnit.faction === 'player') {
            const dmg = RULES.calcDamage({
                attacker: deadEnemy, defender: targetUnit,
                baseAtk: deadEnemy.atk, atkRatio: talent.atkRatio, element: 'wind'
            });
            targetUnit.hp -= dmg.finalDamage;
            _logEvent(session, '风旋！勇者被传送，受到 ' + dmg.finalDamage + ' 风伤');
        } else {
            _logEvent(session, '风旋！' + targetUnit.name + ' 被传送');
        }
    }

    function _endPlayerTurn(session) {
        if (session.phase !== PHASE.PLAYER_TURN) return;
        session.phase = PHASE.ENEMY_ACTION;
        _enemiesTurn(session);
    }

    function endPlayerTurn(session) { _endPlayerTurn(session); }

    function _enemiesTurn(session) {
        const aliveEnemies = session.enemies.filter(e => e.alive && !e.isSelfdestruct);
        for (const enemy of aliveEnemies) {
            if (!session.hero.alive) break;
            _enemyAct(session, enemy);
        }

        for (const sd of session.enemies.filter(e => e.isSelfdestruct && e.alive)) {
            if (session.round >= sd.explosionRound) _triggerExplosion(session, sd);
        }

        _checkWinLose(session);
        if (session.phase !== PHASE.WIN && session.phase !== PHASE.LOSE) {
            _startNewRound(session);
        }
    }

    function _enemyAct(session, enemy) {
        const w = session.map.width, h = session.map.height;

        const usableSkill = enemy.skills && enemy.skills.find(s => {
            if (!s.cooldown) return true;
            return !enemy.cooldowns || !enemy.cooldowns[s.id] || enemy.cooldowns[s.id] <= 0;
        });

        if (usableSkill) {
            _enemyUseSkill(session, enemy, usableSkill);
            if (usableSkill.noMoveAfterUse) return;
        }

        const step = DATA.getClockwiseStep(w, h, enemy.x, enemy.y);
        if (step) {
            const cell = session.map.cellAt(step.x, step.y);
            if (cell && cell.passable && !cell.unit) {
                MAP.moveUnit(session.map, enemy, step.x, step.y);
            } else if (cell && cell.unit && cell.unit.faction === 'player') {
                const dmg = RULES.calcDamage({
                    attacker: enemy, defender: session.hero,
                    baseAtk: enemy.atk, atkRatio: 1.0, element: 'physical'
                });
                session.hero.hp -= dmg.finalDamage;
                _logEvent(session, enemy.name + ' 碰撞，对勇者造成 ' + dmg.finalDamage + ' 伤害');
            }
        }

        const dist = Math.abs(enemy.x - session.hero.x) + Math.abs(enemy.y - session.hero.y);
        if (dist === 1) {
            const dmg = RULES.calcDamage({
                attacker: enemy, defender: session.hero,
                baseAtk: enemy.atk, atkRatio: 1.0, element: enemy.attackType
            });
            session.hero.hp -= dmg.finalDamage;
            _logEvent(session, enemy.name + ' 攻击勇者，造成 ' + dmg.finalDamage + ' 伤害');

            const reaction = RULES.applyElementAttachToUnit(session.hero, enemy.element);
            if (reaction) {
                RULES.resolveReaction(session.map, reaction.reaction, enemy, session.hero, 1.0);
            }
        }
    }

    function _enemyUseSkill(session, enemy, skill) {
        _logEvent(session, enemy.name + ' 使用了【' + skill.name + '】！');
        if (skill.cooldown) {
            if (!enemy.cooldowns) enemy.cooldowns = {};
            enemy.cooldowns[skill.id] = skill.cooldown;
        }

        switch (skill.id) {
            case 'breakground': _doBreakground(session, enemy, skill); break;
            case 'waterbubble': _doWaterbubble(session, enemy, skill); break;
            case 'icefog':      _doIcefog(session, enemy, skill); break;
        }

        if (enemy.cooldowns) {
            for (const k of Object.keys(enemy.cooldowns)) {
                enemy.cooldowns[k] = Math.max(0, enemy.cooldowns[k] - 1);
            }
        }
    }

    function _doBreakground(session, enemy, skill) {
        const neighbors = MAP.getNeighbors(session.map, session.hero.x, session.hero.y);
        const valid = neighbors.filter(n => n.cell.passable && !n.cell.unit);
        if (valid.length === 0) return;
        const dest = valid[Math.floor(Math.random() * valid.length)];
        MAP.moveUnit(session.map, enemy, dest.x, dest.y);

        const cells = MAP.getAreaCells(session.map, enemy.x, enemy.y, 'surround4');
        for (const c of cells) {
            if (c.unit && c.unit.faction === 'player') {
                const dmg = RULES.calcDamage({
                    attacker: enemy, defender: c.unit,
                    baseAtk: enemy.atk, atkRatio: skill.atkRatio, element: skill.element
                });
                c.unit.hp -= dmg.finalDamage;
                _logEvent(session, '破土而出！勇者受到 ' + dmg.finalDamage + ' 草伤');
            }
        }
    }

    function _doWaterbubble(session, enemy, skill) {
        session.pendingBubble = { targetX: session.hero.x, targetY: session.hero.y, round: session.round + 1 };
    }

    function _doIcefog(session, enemy, skill) {
        const dmg = RULES.calcDamage({
            attacker: enemy, defender: session.hero,
            baseAtk: enemy.atk, atkRatio: skill.atkRatio, element: skill.element
        });
        session.hero.hp -= dmg.finalDamage;
        _logEvent(session, '冰雾！勇者受到 ' + dmg.finalDamage + ' 冰伤');

        const reaction = RULES.applyElementAttachToUnit(session.hero, skill.element);
        if (reaction) RULES.resolveReaction(session.map, reaction.reaction, enemy, session.hero, skill.atkRatio);
    }

    function _triggerExplosion(session, sdUnit) {
        const cells = MAP.getAreaCells(session.map, sdUnit.x, sdUnit.y, 'surround9');
        for (const c of cells) {
            if (!c.unit) continue;
            const dmg = RULES.calcDamage({
                attacker: sdUnit, defender: c.unit,
                baseAtk: sdUnit.atk || 10, atkRatio: sdUnit.atkRatio || 1.0, element: sdUnit.element || 'fire'
            });
            c.unit.hp -= dmg.finalDamage;
            _logEvent(session, '自爆！' + c.unit.name + ' 受到 ' + dmg.finalDamage + ' 火伤');
            if (c.unit.hp <= 0 && c.unit.faction === 'player') session.hero.alive = false;
        }
        sdUnit.alive = false;
        session.map.cellAt(sdUnit.x, sdUnit.y).unit = null;
    }

    function _checkWinLose(session) {
        if (session.hero.hp <= 0 || !session.hero.alive) {
            session.phase = PHASE.LOSE;
            session.defeatEvent = { ...session.stage };
            _logEvent(session, '战斗失败！');
            return;
        }
        const realAlive = session.enemies.filter(e => e.alive && !e.isSelfdestruct);
        if (realAlive.length === 0) {
            session.phase = PHASE.WIN;
            session.victoryEvent = { ...session.stage };
            _logEvent(session, '战斗胜利！');
        }
    }

    function isBattleOver(session) {
        return session.phase === PHASE.WIN || session.phase === PHASE.LOSE;
    }

    function _logEvent(session, msg) {
        session.onEvent({ type: 'log', msg: msg, round: session.round });
    }

    return { PHASE, createBattle, startBattle, playerMove, triggerDoubleMove, playerAttack, endPlayerTurn, isBattleOver };
})();