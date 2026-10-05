// ============================================================
// map.js —— 回字形地图生成
// 规格参考：docs/04-探索与地图.md §一~§九
//
// 地图尺寸按 day 变化：
//   day 1: 3x3 回字形（最外圈 8 格 + 中心空）
//   day 2: 5x5
//   day 3+: 9x9（默认）
// ============================================================

window.MAP = (() => {

    const DATA = window.GAME_DATA;

    function _sizeForDay(day) {
        if (day <= 1) return 3;
        if (day === 2) return 5;
        return 9;
    }

    function generate(width, height, options) {
        if (typeof width !== 'number') { options = width; width = undefined; height = undefined; }
        if (typeof height !== 'number') { height = undefined; }

        // 兼容：不传 width/height 时自动按 G.day 决定
        if (!width || !height) {
            const day = (window.G && window.G.day) || 1;
            width = width || height || _sizeForDay(day);
            height = height || width;
        }

        options = options || {};
        const {
            terrainWeights = _defaultTerrainWeights(),
            spawnPointCount = 0,
            spawnAvoidOverlap = true
        } = options;

        const cells = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const onOuter = DATA.isOnOuterRing(width, height, x, y);
                const terrainId = onOuter ? _pickTerrain(terrainWeights) : 'default';
                const terrain = DATA.TERRAINS[terrainId];

                cells.push({
                    x, y,
                    onOuterRing: onOuter,
                    terrain: terrainId,
                    alwaysAttach: terrain.alwaysAttach || null,
                    passable: terrain.passable,
                    attach: null,
                    isEnemySpawnPoint: false,
                    unit: null
                });
            }
        }

        const map = {
            width, height, cells,
            cellAt(x, y) {
                if (x < 0 || y < 0 || x >= width || y >= height) return null;
                return cells[y * width + x];
            },
            getOuterRingCells() { return cells.filter(c => c.onOuterRing); },
            getPassableCells()  { return cells.filter(c => c.passable && !c.unit); },
            getSpawnCandidates(){ return cells.filter(c => c.onOuterRing && c.passable && !c.unit && !c.isEnemySpawnPoint); }
        };

        _initTerrainAttaches(map);

        if (spawnPointCount > 0) {
            _spawnEnemyPoints(map, spawnPointCount, spawnAvoidOverlap);
        }

        return map;
    }

    function generateMap() { return generate(); }

    function pickHeroSpawn(map, _unused) {
        // 左下角外圈
        const candidates = map.getOuterRingCells().filter(c => c.passable && !c.unit);
        // 优先选左下角附近
        candidates.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        return candidates[0] || { x: 0, y: map.height - 1 };
    }

    function _defaultTerrainWeights() {
        return { default: 0.6, grass: 0.25, river: 0.05, ice: 0.1 };
    }

    function _pickTerrain(weights) {
        const r = Math.random();
        let acc = 0;
        for (const [id, w] of Object.entries(weights)) { acc += w; if (r < acc) return id; }
        return 'default';
    }

    function _initTerrainAttaches(map) {
        for (const c of map.cells) if (c.alwaysAttach) c.attach = c.alwaysAttach;
    }

    function _spawnEnemyPoints(map, count, avoidOverlap) {
        const ring = [...map.getOuterRingCells()];
        if (avoidOverlap) ring.sort(() => Math.random() - 0.5);
        let placed = 0;
        for (const c of ring) {
            if (placed >= count) break;
            if (c.passable && !c.unit && !c.isEnemySpawnPoint) {
                c.isEnemySpawnPoint = true;
                placed++;
            }
        }
    }

    function refreshAlwaysAttach(map) {
        for (const c of map.cells) if (c.alwaysAttach) c.attach = c.alwaysAttach;
    }

    function applyElementAttach(map, x, y, element, duration = 2) {
        const c = map.cellAt(x, y);
        if (!c) return;
        if (c.alwaysAttach) { c.attach = c.alwaysAttach; return; }
        c.attach = { element, remaining: duration };
    }

    function placeUnit(map, unit, x, y) {
        const c = map.cellAt(x, y);
        if (!c || !c.passable) return false;
        c.unit = unit;
        unit.x = x; unit.y = y;
        return true;
    }

    function moveUnit(map, unit, tx, ty) {
        const fromCell = map.cellAt(unit.x, unit.y);
        const toCell = map.cellAt(tx, ty);
        if (!fromCell || !toCell || !toCell.passable || (toCell.unit && toCell.unit !== unit)) return false;
        fromCell.unit = null;
        toCell.unit = unit;
        unit.x = tx; unit.y = ty;

        if (unit.innateTalents) {
            const affinity = unit.innateTalents.find(t => t.moveAttach);
            if (affinity && !toCell.alwaysAttach) {
                toCell.attach = { element: affinity.moveAttach, remaining: 2 };
            }
        }
        return true;
    }

    function getNeighbors(map, x, y) {
        return [[0,-1],[0,1],[-1,0],[1,0]]
            .map(([dx,dy]) => ({ x: x+dx, y: y+dy, cell: map.cellAt(x+dx, y+dy) }))
            .filter(n => n.cell !== null);
    }

    function getAreaCells(map, x, y, aoeType) {
        switch (aoeType) {
            case 'surround4':
                return getNeighbors(map, x, y).map(n => n.cell);
            case 'surround5':
                return [map.cellAt(x, y), ...getAreaCells(map, x, y, 'surround4')].filter(Boolean);
            case 'surround9': {
                const out = [];
                for (let dx = -1; dx <= 1; dx++)
                    for (let dy = -1; dy <= 1; dy++) {
                        const c = map.cellAt(x + dx, y + dy);
                        if (c) out.push(c);
                    }
                return out;
            }
        }
        return [];
    }

    return {
        generate, generateMap, pickHeroSpawn,
        refreshAlwaysAttach, applyElementAttach,
        placeUnit, moveUnit, getNeighbors, getAreaCells,
        sizeForDay: _sizeForDay
    };
})();