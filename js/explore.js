// ============================================================
// explore.js —— 探索模式（重写版）
// 规格参考：docs/04-探索与地图.md §二~§八
// ============================================================

window.EXPLORE = (() => {

    const MAP  = window.MAP;
    const RULES = window.RULES;

    function createExplore(options = {}) {
        const map = MAP.generate(9, 9, {});
        const hero = {
            id: 'hero', name: '勇者', faction: 'player', isMainCharacter: true,
            atk: 20, def: 5, hp: 100, maxHp: 100,
            status: {}, alive: true
        };
        MAP.placeUnit(map, hero, 0, map.height - 1);

        return {
            map, hero, visited: {}, stepCount: 0,
            onEvent: options.onEvent || (() => {})
        };
    }

    function move(session, dir, fromVehicle = false) {
        const [dx, dy] = dir;
        const tx = session.hero.x + dx;
        const ty = session.hero.y + dy;

        const check = RULES.canMoveTo(session.map, session.hero, tx, ty, { fromVehicle });
        if (!check.ok) return { ok: false, reason: check.reason };

        const toCell = session.map.cellAt(tx, ty);
        if (toCell.terrain === 'river') {
            MAP.moveUnit(session.map, session.hero, tx, ty);
            const result = RULES.handleRiverEnter(session.map, session.hero, true);
            if (result && result.type === 'main_defeat') {
                return { ok: false, reason: 'defeat_by_river' };
            }
        }

        MAP.moveUnit(session.map, session.hero, tx, ty);
        session.stepCount++;

        const slide = RULES.processIceSlide(session.map, session.hero, dir, true, fromVehicle);
        if (slide) {
            MAP.moveUnit(session.map, session.hero, tx + slide.dx, ty + slide.dy);
        }

        return { ok: true, x: session.hero.x, y: session.hero.y };
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