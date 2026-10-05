// ============================================================
// map.js —— 回字形地图生成（重写版）
// 规格参考：docs/04-探索与地图.md §一~§九
// ============================================================

window.MAP = (() => {

    const DATA = window.GAME_DATA;

    // 默认地图尺寸（回字形外圈为 width x height，内部空心）
    const DEFAULT_W = 9;
    const DEFAULT_H = 9;

    // ===== 地图 Cell 数据结构 =====
    // {
    //   x, y,
    //   terrain: 'default'|'river'|'grass'|'ice',
    //   attach: null | 'fire'|'water'|...,   当前元素附着
    //   alwaysAttach: null | 'water'|'grass'|'ice', 来自 terrain
    //   isEnemySpawnPoint: boolean,
    //   unit: null | Unit instance          占据此格的单位
    // }

    // 生成一张回字形地图（width x height 的外圈）
    function generate(width = DEFAULT_W, height = DEFAULT_H, options = {}) {
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
            width, height,
            cells,
            cellAt(x, y) {
                if (x < 0 || y < 0 || x >= width || y >= height) return null;
                return cells[y * width + x];
            },
            getOuterRingCells() {
                return cells.filter(c => c.onOuterRing);
            },
            getPassableCells() {
                return cells.filter(c => c.passable && !c.unit);
            },
            getSpawnCandidates() {
                return cells.filter(c => c.onOuterRing && c.passable && !c.unit && !c.isEnemySpawnPoint);
            }
        };

        // 初始化元素附着（地形的 alwaysAttach）
        _initTerrainAttaches(map);

        // 生成敌人进攻点
        if (spawnPointCount > 0) {
            _spawnEnemyPoints(map, spawnPointCount, spawnAvoidOverlap);
        }

        return map;
    }

    function _defaultTerrainWeights() {
        return {
            default: 0.6,
            grass:   0.25,
            river:   0.05,
            ice:     0.1
        };
    }

    function _pickTerrain(weights) {
        const r = Math.random();
        let acc = 0;
        for (const [id, w] of Object.entries(weights)) {
            acc += w;
            if (r < acc) return id;
        }
        return 'default';
    }

    function _initTerrainAttaches(map) {
        for (const c of map.cells) {
            if (c.alwaysAttach) {
                c.attach = c.alwaysAttach;
            }
        }
    }

    function _spawnEnemyPoints(map, count, avoidOverlap) {
        const ring = map.getOuterRingCells();
        // 进攻点优先选外圈上的位置
        const candidates = avoidOverlap
            ? [...ring].sort(() => Math.random() - 0.5)  // 随机打乱
            : ring;

        let placed = 0;
        for (const c of candidates) {
            if (placed >= count) break;
            if (!c.isEnemySpawnPoint && c.passable && !c.unit) {
                c.isEnemySpawnPoint = true;
                placed++;
            }
        }
    }

    // ===== 地块元素刷新（"总是附着"机制，见规格 §15.3） =====
    // 每次任意单位的行动节点开始时调用
    function refreshAlwaysAttach(map) {
        for (const c of map.cells) {
            if (c.alwaysAttach) {
                // 允许当前附着存在（可能是元素反应产生的），但若不是 alwaysAttach 则强制刷回
                c.attach = c.alwaysAttach;
            }
        }
    }

    // ===== 元素附着施加 =====
    function applyElementAttach(map, x, y, element, duration = 2) {
        const c = map.cellAt(x, y);
        if (!c) return;

        // 若地块有 alwaysAttach，反应后可能被覆盖
        // 规格：允许元素反应，但禁止第三种新元素进来覆盖 alwaysAttach
        if (c.alwaysAttach) {
            c.attach = c.alwaysAttach;  // 强制刷回
            return;
        }

        c.attach = { element, remaining: duration };
    }

    // ===== 在地图上放置单位 =====
    function placeUnit(map, unit, x, y) {
        const c = map.cellAt(x, y);
        if (!c) return false;
        if (!c.passable) return false;
        c.unit = unit;
        unit.x = x;
        unit.y = y;
        return true;
    }

    // ===== 移动单位 =====
    function moveUnit(map, unit, tx, ty) {
        const fromCell = map.cellAt(unit.x, unit.y);
        const toCell = map.cellAt(tx, ty);
        if (!fromCell || !toCell) return false;
        if (!toCell.passable) return false;
        if (toCell.unit && toCell.unit !== unit) return false;

        fromCell.unit = null;
        toCell.unit = unit;
        unit.x = tx;
        unit.y = ty;

        // 若是敌人移动，根据元素亲和给地块加附着
        if (unit.innateTalents) {
            const affinity = unit.innateTalents.find(t => t.id && t.id.includes('Affinity'));
            if (affinity && affinity.moveAttach && !toCell.alwaysAttach) {
                toCell.attach = { element: affinity.moveAttach, remaining: 2 };
            }
        }

        return true;
    }

    // ===== 获取相邻格 =====
    function getNeighbors(map, x, y) {
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        return dirs.map(([dx, dy]) => ({ x: x + dx, y: y + dy, cell: map.cellAt(x + dx, y + dy) }))
                   .filter(n => n.cell !== null);
    }

    // ===== 获取周围 N 格（以自身为中心） =====
    function getAreaCells(map, x, y, aoeType) {
        switch (aoeType) {
            case 'surround4':  // 上下左右
                return getNeighbors(map, x, y).filter(n => n.cell).map(n => n.cell);
            case 'surround5':  // 自身 + 上下左右
                return [map.cellAt(x, y), ...getAreaCells(map, x, y, 'surround4')].filter(Boolean);
            case 'surround9':  // 九宫格
            case 'cross':
            case 'front3':
                break;
        }
        return [];
    }

    return {
        generate, refreshAlwaysAttach, applyElementAttach,
        placeUnit, moveUnit, getNeighbors, getAreaCells,
        DEFAULT_W, DEFAULT_H
    };
})();