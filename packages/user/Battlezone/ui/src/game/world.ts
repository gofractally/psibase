import {
    DEFAULT_ENEMY_TANKS,
    ENEMY_COLORS,
    ENEMY_EXPLOSION_DURATION,
    FIELD_LIM,
    FIRE_COOLDOWN,
    MAX_ENEMY_TANKS,
    MIN_ENEMY_TANKS,
    MIN_TANK_SEPARATION,
    OBSTACLE_COUNT,
    PLAYER_COLOR,
    SPAWN_NEAR_OBSTACLE,
    START_LIVES,
    TANK_RADIUS,
    TANK_SPAWN_LIM,
    aiTankId,
    syncEnemySlotModes,
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
    controller: Tank["controller"] = id === "player" ? "local" : "ai",
    account: string | null = null,
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
        controller,
        account,
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

function clampSpawn(pos: Vec2): Vec2 {
    return {
        x: Math.max(-TANK_SPAWN_LIM, Math.min(TANK_SPAWN_LIM, pos.x)),
        y: Math.max(-TANK_SPAWN_LIM, Math.min(TANK_SPAWN_LIM, pos.y)),
    };
}

function isValidSpawn(
    pos: Vec2,
    blocks: Block[],
    avoid: Vec2[],
    minSep: number,
    requireNearObstacle: boolean,
): boolean {
    if (blocks.some((b) => overlapsObstacle(pos, TANK_RADIUS + 2, b))) {
        return false;
    }
    if (avoid.some((a) => dist(pos, a) < minSep)) return false;
    // Require being amid the obstacle field, not in an empty fringe pocket
    if (
        requireNearObstacle &&
        nearestObstacleDist(pos, blocks) > SPAWN_NEAR_OBSTACLE
    ) {
        return false;
    }
    return true;
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
        if (isValidSpawn(pos, blocks, avoid, minSep, true)) return pos;
    }
    return null;
}

/** Clear spot near a target — jitter grows across tries, then constraints relax. */
function findClearSpotNear(
    blocks: Block[],
    avoid: Vec2[],
    minSep: number,
    target: Vec2,
    tries = 100,
): Vec2 | null {
    const aim = clampSpawn(target);
    for (let i = 0; i < tries; i++) {
        const t = i / tries;
        const jitter = TANK_SPAWN_LIM * (0.08 + 0.55 * t);
        const pos = clampSpawn({
            x: aim.x + randRange(-jitter, jitter),
            y: aim.y + randRange(-jitter, jitter),
        });
        const sep = minSep * (1 - 0.35 * t);
        const nearObs = t < 0.7;
        if (isValidSpawn(pos, blocks, avoid, sep, nearObs)) return pos;
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

function faceToward(from: Vec2, to: Vec2): number {
    return Math.atan2(to.x - from.x, -(to.y - from.y));
}

function clampEnemyCount(n: number): number {
    return Math.max(MIN_ENEMY_TANKS, Math.min(MAX_ENEMY_TANKS, Math.floor(n)));
}

/**
 * Place player + enemies on evenly spaced angular slots around the field
 * so opponents aren't clustered in one corner.
 */
function spawnTanks(blocks: Block[], enemyCount: number): Tank[] {
    const count = clampEnemyCount(enemyCount);
    const total = count + 1;
    const angle0 = Math.random() * Math.PI * 2;
    const playerSlot = Math.floor(Math.random() * total);
    // Keep tanks well apart as count grows (ring circumference / slots)
    const ringSep = Math.max(
        MIN_TANK_SEPARATION,
        (TANK_SPAWN_LIM * 0.75 * Math.PI * 2) / total * 0.85,
    );

    const slots: Vec2[] = [];
    for (let i = 0; i < total; i++) {
        const angle = angle0 + (i / total) * Math.PI * 2;
        // Mid–outer ring with light radius jitter (not a perfect circle)
        const radius = TANK_SPAWN_LIM * randRange(0.55, 0.9);
        const target = {
            x: Math.sin(angle) * radius,
            y: -Math.cos(angle) * radius,
        };
        const pos =
            findClearSpotNear(blocks, slots, ringSep, target) ??
            findClearSpot(blocks, slots, MIN_TANK_SEPARATION) ??
            clampSpawn(target);
        slots.push(pos);
    }

    const playerPos = slots[playerSlot]!;
    const enemyPositions = slots.filter((_, i) => i !== playerSlot);
    const firstEnemy = enemyPositions[0] ?? playerPos;

    const tanks: Tank[] = [
        makeTank(
            "player",
            playerPos.x,
            playerPos.y,
            faceToward(playerPos, firstEnemy),
            PLAYER_COLOR,
        ),
    ];

    for (let i = 0; i < count; i++) {
        const pos = enemyPositions[i]!;
        tanks.push(
            makeTank(
                aiTankId(i),
                pos.x,
                pos.y,
                faceToward(pos, playerPos),
                enemyColor(i),
            ),
        );
    }
    return tanks;
}

export function createInitialState(
    enemyCount: number = DEFAULT_ENEMY_TANKS,
): GameState {
    const count = clampEnemyCount(enemyCount);
    const blocks = createBlocks();
    const tanks = spawnTanks(blocks, count);
    return {
        phase: "title",
        enemyCount: count,
        enemySlotModes: syncEnemySlotModes([], count),
        tanks,
        shots: [],
        blocks,
        nextShotId: 1,
        message: "PRESS ENTER TO READY",
        elapsed: 0,
        respawnIn: 0,
        respawnId: null,
        hitStunIn: 0,
        hitStunVictimId: null,
        radarAlertIn: 0,
        explosionIn: 0,
        explosionDuration: ENEMY_EXPLOSION_DURATION,
        explosionPos: null,
        explosionHeading: 0,
        explosionColor: ENEMY_COLORS[0]!,
        localAccount: null,
        netRole: "offline",
        livePeers: [],
        lobbyPlayers: [],
        lobbyHost: null,
        lobbyReady: false,
        viewTankId: null,
        netStatus: "CONNECTING…",
    };
}

export function missionMessage(enemyCount: number): string {
    return enemyCount === 1
        ? "DESTROY THE ENEMY TANK"
        : "DESTROY THE ENEMY TANKS";
}

export function resetMatch(state: GameState): GameState {
    const next = createInitialState(state.enemyCount);
    next.enemySlotModes = syncEnemySlotModes(
        state.enemySlotModes,
        state.enemyCount,
    );
    next.localAccount = state.localAccount;
    next.livePeers = state.livePeers;
    next.netStatus = state.netStatus;
    // Must keep host/remote — otherwise both clients fall back to offline
    // local sims and never exchange input / snapshots.
    next.netRole = state.netRole;
    next.viewTankId = state.viewTankId;
    next.phase = "playing";
    next.message = missionMessage(state.enemyCount);
    return next;
}

export function respawnTank(
    tank: Tank,
    blocks: Block[],
    others: Tank[] = [],
): void {
    const avoid = others.filter((t) => t.alive).map((t) => t.pos);
    const minSep = MIN_TANK_SEPARATION * 0.7;

    let pos: Vec2 | null = null;
    if (tank.id !== "player") {
        // Enemies: random angle/radius on the field, then nearest clear spot
        const angle = Math.random() * Math.PI * 2;
        const radius = TANK_SPAWN_LIM * randRange(0.35, 0.9);
        const target = {
            x: Math.sin(angle) * radius,
            y: -Math.cos(angle) * radius,
        };
        pos =
            findClearSpotNear(blocks, avoid, minSep, target) ??
            findClearSpot(blocks, avoid, minSep, 200);
    } else {
        pos = findClearSpot(blocks, avoid, minSep, 200);
    }

    if (!pos) {
        pos = {
            x: randRange(-TANK_SPAWN_LIM, TANK_SPAWN_LIM),
            y: randRange(-TANK_SPAWN_LIM, TANK_SPAWN_LIM),
        };
    }

    tank.pos = pos;
    const face = others.find((t) => t.alive);
    if (face) {
        tank.heading = Math.atan2(
            face.pos.x - pos.x,
            -(face.pos.y - pos.y),
        );
    } else {
        tank.heading = Math.random() * Math.PI * 2;
    }
    tank.alive = true;
    tank.cooldown = FIRE_COOLDOWN;
}
