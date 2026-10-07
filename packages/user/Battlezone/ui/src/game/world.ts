import {
    ENEMY_COLORS,
    ENEMY_EXPLOSION_DURATION,
    FIELD_LIM,
    FIRE_COOLDOWN,
    MIN_TANK_SEPARATION,
    OBSTACLE_COUNT,
    PLAYER_COLOR,
    SPAWN_NEAR_OBSTACLE,
    START_LIVES,
    TANK_RADIUS,
    TANK_SPAWN_LIM,
    type Block,
    type GameState,
    type ObstacleShape,
    type Tank,
    type Vec2,
} from "./types";

const SHAPES: ObstacleShape[] = [
    "box",
    "pyramid",
    "trapezoid",
    "column",
    "wedge",
];

function makeTank(
    id: Tank["id"],
    x: number,
    y: number,
    heading: number,
    color: string,
): Tank {
    return {
        id,
        pos: { x, y },
        heading,
        alive: true,
        lives: START_LIVES,
        cooldown: 0,
        score: 0,
        color,
    };
}

function enemyColor(index: number): string {
    return ENEMY_COLORS[index % ENEMY_COLORS.length]!;
}

function randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function dist(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function overlapsObstacle(pos: Vec2, radius: number, block: Block): boolean {
    return dist(pos, block.pos) < radius + block.half + 1.5;
}

function nearestObstacleDist(pos: Vec2, blocks: Block[]): number {
    let best = Infinity;
    for (const b of blocks) {
        const d = dist(pos, b.pos) - b.half;
        if (d < best) best = d;
    }
    return best;
}

function findClearSpot(
    blocks: Block[],
    avoid: Vec2[],
    minSep: number,
    tries = 120,
): Vec2 | null {
    for (let i = 0; i < tries; i++) {
        const pos = {
            x: randRange(-TANK_SPAWN_LIM, TANK_SPAWN_LIM),
            y: randRange(-TANK_SPAWN_LIM, TANK_SPAWN_LIM),
        };
        if (blocks.some((b) => overlapsObstacle(pos, TANK_RADIUS + 2, b))) {
            continue;
        }
        if (avoid.some((a) => dist(pos, a) < minSep)) continue;
        // Require being amid the obstacle field, not in an empty fringe pocket
        if (nearestObstacleDist(pos, blocks) > SPAWN_NEAR_OBSTACLE) continue;
        return pos;
    }
    return null;
}

export function createBlocks(): Block[] {
    const blocks: Block[] = [];
    const minGap = 14;
    let attempts = 0;
    while (blocks.length < OBSTACLE_COUNT && attempts < OBSTACLE_COUNT * 40) {
        attempts++;
        const half = randRange(3.2, 7.5);
        const pos = {
            x: randRange(-FIELD_LIM, FIELD_LIM),
            y: randRange(-FIELD_LIM, FIELD_LIM),
        };
        if (blocks.some((b) => dist(pos, b.pos) < half + b.half + minGap)) {
            continue;
        }
        blocks.push({
            pos,
            half,
            shape: SHAPES[Math.floor(Math.random() * SHAPES.length)]!,
            yaw: randRange(0, Math.PI * 2),
            heightScale: randRange(1, 2),
        });
    }
    return blocks;
}

function spawnTanks(blocks: Block[]): [Tank, Tank] {
    const playerPos =
        findClearSpot(blocks, [], MIN_TANK_SEPARATION) ?? {
            x: 0,
            y: TANK_SPAWN_LIM * 0.4,
        };
    const aiPos =
        findClearSpot(blocks, [playerPos], MIN_TANK_SEPARATION) ?? {
            x: 0,
            y: -TANK_SPAWN_LIM * 0.4,
        };

    const faceToward = (from: Vec2, to: Vec2) =>
        Math.atan2(to.x - from.x, -(to.y - from.y));

    return [
        makeTank(
            "player",
            playerPos.x,
            playerPos.y,
            faceToward(playerPos, aiPos),
            PLAYER_COLOR,
        ),
        makeTank(
            "ai",
            aiPos.x,
            aiPos.y,
            faceToward(aiPos, playerPos),
            enemyColor(0),
        ),
    ];
}

export function createInitialState(): GameState {
    const blocks = createBlocks();
    const [player, ai] = spawnTanks(blocks);
    return {
        phase: "title",
        tanks: [player, ai],
        shots: [],
        blocks,
        nextShotId: 1,
        message: "PRESS ENTER TO START",
        elapsed: 0,
        respawnIn: 0,
        respawnId: null,
        hitStunIn: 0,
        radarAlertIn: 0,
        explosionIn: 0,
        explosionDuration: ENEMY_EXPLOSION_DURATION,
        explosionPos: null,
        explosionHeading: 0,
    };
}

export function resetMatch(_state: GameState): GameState {
    const next = createInitialState();
    next.phase = "playing";
    next.message = "DESTROY THE ENEMY TANK";
    return next;
}

export function respawnTank(tank: Tank, blocks: Block[], other?: Tank): void {
    const avoid = other?.alive ? [other.pos] : [];
    const pos =
        findClearSpot(blocks, avoid, MIN_TANK_SEPARATION * 0.7) ?? {
            x: tank.id === "player" ? 0 : 20,
            y:
                tank.id === "player"
                    ? TANK_SPAWN_LIM * 0.4
                    : -TANK_SPAWN_LIM * 0.4,
        };
    tank.pos = pos;
    if (other?.alive) {
        tank.heading = Math.atan2(
            other.pos.x - pos.x,
            -(other.pos.y - pos.y),
        );
    } else {
        tank.heading = Math.random() * Math.PI * 2;
    }
    tank.alive = true;
    tank.cooldown = FIRE_COOLDOWN;
}
