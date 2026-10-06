import {
    ARENA,
    ENEMY_EXPLOSION_DURATION,
    FIRE_COOLDOWN,
    START_LIVES,
    type Block,
    type GameState,
    type Tank,
} from "./types";

function makeTank(
    id: Tank["id"],
    x: number,
    y: number,
    heading: number,
): Tank {
    return {
        id,
        pos: { x, y },
        heading,
        alive: true,
        lives: START_LIVES,
        cooldown: 0,
        score: 0,
    };
}

export function createBlocks(): Block[] {
    const blocks: Block[] = [
        { pos: { x: 0, y: 0 }, half: 6 },
        { pos: { x: -40, y: 25 }, half: 5 },
        { pos: { x: 35, y: -30 }, half: 5 },
        { pos: { x: -55, y: -45 }, half: 4 },
        { pos: { x: 50, y: 40 }, half: 4 },
        { pos: { x: 15, y: 55 }, half: 3.5 },
        { pos: { x: -20, y: -60 }, half: 3.5 },
        { pos: { x: 65, y: -10 }, half: 4 },
        { pos: { x: -65, y: 10 }, half: 4 },
    ];
    return blocks;
}

export function createInitialState(): GameState {
    const half = ARENA * 0.35;
    return {
        phase: "title",
        tanks: [
            makeTank("player", 0, half, Math.PI),
            makeTank("ai", 0, -half, 0),
        ],
        shots: [],
        blocks: createBlocks(),
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

export function respawnTank(tank: Tank): void {
    const half = ARENA * 0.35;
    if (tank.id === "player") {
        tank.pos = { x: 0, y: half };
        tank.heading = Math.PI;
    } else {
        tank.pos = { x: 0, y: -half };
        tank.heading = 0;
    }
    tank.alive = true;
    tank.cooldown = FIRE_COOLDOWN;
}
