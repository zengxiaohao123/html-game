window.EXPLORE = (() => {
    const MAP  = window.MAP;
    const RULES = window.RULES;

    function createExplore(options) {
        options = options || {};
        const map = MAP.generate();  // 不传尺寸，按 G.day 自动决定（day1=3x3, day2=5x5, day3+=9x9）
        const hero = {
            id: 'hero', name: '勇者', faction: 'player', isMainCharacter: true,
            atk: 20, def: 5, hp: 100, maxHp: 100,
            status: {}, alive: true, facing: 'up'
        };
        MAP.placeUnit(map, hero, 0, map.height - 1);

        return { map, hero, visited: {}, stepCount: 0 };
    }

    function move(session, dir, fromVehicle) {
        fromVehicle = !!fromVehicle;
        const [dx, dy] = dir;
        const tx = session.hero.x + dx, ty = session.hero.y + dy;
        const check = RULES.canMoveTo(session.map, session.hero, tx, ty, { fromVehicle });
        if (!check.ok) return { ok: false, reason: check.reason };

        const toCell = session.map.cellAt(tx, ty);
        if (toCell.terrain === 'river') {
            MAP.moveUnit(session.map, session.hero, tx, ty);
            const result = RULES.handleRiverEnter(session.map, session.hero, true);
            if (result && result.type === 'main_defeat') return { ok: false, reason: 'defeat_by_river' };
        }

        MAP.moveUnit(session.map, session.hero, tx, ty);
        session.stepCount++;

        const slide = RULES.processIceSlide(session.map, session.hero, dir, true, fromVehicle);
        if (slide) MAP.moveUnit(session.map, session.hero, tx + slide.dx, ty + slide.dy);

        session.hero.facing = dirToFacing(dx, dy);
        return { ok: true, x: session.hero.x, y: session.hero.y };
    }

    function dirToFacing(dx, dy) {
        if (dx === 1) return 'right';
        if (dx === -1) return 'left';
        if (dy === 1) return 'down';
        return 'up';
    }

    function search(session) {
        const cell = session.map.cellAt(session.hero.x, session.hero.y);
        if (!cell || cell.onOuterRing) return { ok: false, reason: 'not_inside' };
        const key = session.hero.x + ',' + session.hero.y;
        if (session.visited[key]) return { ok: false, reason: 'already_searched' };
        session.visited[key] = true;

        const r = Math.random();
        if (r < 0.15) {
            const stageId = Math.random() < 0.2 ? 'slime_rampage' : 'slime_time';
            return { ok: true, event: 'battle', stageId };
        } else if (r < 0.35) {
            return { ok: true, event: 'pickup', items: _randomPickup() };
        }
        return { ok: true, event: 'nothing' };
    }

    function _randomPickup() {
        const r = Math.random();
        if (r < 0.5) return [{ key: 'fruit', count: 1 + Math.floor(Math.random() * 2) }];
        if (r < 0.8) return [{ key: 'wood', count: 1 }];
        return [{ key: 'flax', count: 1 }];
    }

    return { createExplore, move, search };
})();