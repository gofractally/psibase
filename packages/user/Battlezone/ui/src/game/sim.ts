import {
    ARENA,
    FIRE_COOLDOWN,
    MOVE_SPEED,
    SHOT_LIFE,
    SHOT_SPEED,
    TANK_RADIUS,
    TURN_RATE,
    type Block,
    type GameState,
    type InputState,
    type Shot,
    type Tank,
    type Vec2,
} from "./types";
import { respawnTank } from "./world";

function clampArena(p: Vec2): void {
    const lim = ARENA * 0.5 - TANK_RADIUS;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.y = Math.max(-lim, Math.min(lim, p.y));
}

function circleHitsBlock(pos: Vec2, radius: number, block: Block): boolean {
    const dx = Math.max(
        Math.abs(pos.x - block.pos.x) - block.half,
        0,
    );
    const dy = Math.max(
        Math.abs(pos.y - block.pos.y) - block.half,
        0,
    );
    return dx * dx + dy * dy < radius * radius;
}

function resolveBlockCollision(pos: Vec2, radius: number, blocks: Block[]): void {
    for (const block of blocks) {
        if (!circleHitsBlock(pos, radius, block)) continue;
        const dx = pos.x - block.pos.x;
        const dy = pos.y - block.pos.y;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const pushX = block.half + radius - ax;
        const pushY = block.half + radius - ay;
        if (pushX < pushY) {
            pos.x += Math.sign(dx || 1) * pushX;
        } else {
            pos.y += Math.sign(dy || 1) * pushY;
        }
    }
}

function tryFire(state: GameState, tank: Tank): void {
    if (!tank.alive || tank.cooldown > 0) return;
    tank.cooldown = FIRE_COOLDOWN;
    const dir = { x: Math.sin(tank.heading), y: -Math.cos(tank.heading) };
    const shot: Shot = {
        id: state.nextShotId++,
        owner: tank.id,
        pos: {
            x: tank.pos.x + dir.x * (TANK_RADIUS + 1),
            y: tank.pos.y + dir.y * (TANK_RADIUS + 1),
        },
        vel: { x: dir.x * SHOT_SPEED, y: dir.y * SHOT_SPEED },
        life: SHOT_LIFE,
    };
    state.shots.push(shot);
}

function applyInput(tank: Tank, input: InputState, dt: number, blocks: Block[]): void {
    if (!tank.alive) return;
    tank.heading += input.turn * TURN_RATE * dt;
    if (input.throttle !== 0) {
        const dir = { x: Math.sin(tank.heading), y: -Math.cos(tank.heading) };
        tank.pos.x += dir.x * input.throttle * MOVE_SPEED * dt;
        tank.pos.y += dir.y * input.throttle * MOVE_SPEED * dt;
        clampArena(tank.pos);
        resolveBlockCollision(tank.pos, TANK_RADIUS, blocks);
    }
    tank.cooldown = Math.max(0, tank.cooldown - dt);
}

function hitTank(shot: Shot, tank: Tank): boolean {
    if (!tank.alive || shot.owner === tank.id) return false;
    const dx = shot.pos.x - tank.pos.x;
    const dy = shot.pos.y - tank.pos.y;
    return dx * dx + dy * dy <= TANK_RADIUS * TANK_RADIUS;
}

function onTankHit(state: GameState, victim: Tank, attackerId: Tank["id"]): void {
    victim.alive = false;
    victim.lives -= 1;
    const attacker = state.tanks.find((t) => t.id === attackerId);
    if (attacker) attacker.score += 1;

    if (victim.lives <= 0) {
        state.phase = victim.id === "player" ? "lose" : "win";
        state.message =
            victim.id === "player" ? "MISSION FAILED" : "ENEMY DESTROYED";
        state.shots = [];
        state.respawnIn = 0;
        state.respawnId = null;
        return;
    }

    state.message = victim.id === "player" ? "TANK DESTROYED" : "HIT CONFIRMED";
    state.respawnId = victim.id;
    state.respawnIn = 1.2;
}

export function stepGame(
    state: GameState,
    playerInput: InputState,
    aiInput: InputState,
    dt: number,
): void {
    if (state.phase !== "playing") return;
    state.elapsed += dt;

    if (state.respawnIn > 0 && state.respawnId) {
        state.respawnIn -= dt;
        if (state.respawnIn <= 0) {
            const tank = state.tanks.find((t) => t.id === state.respawnId);
            if (tank) respawnTank(tank);
            state.respawnId = null;
            state.respawnIn = 0;
            state.message = "DESTROY THE ENEMY TANK";
        }
    }

    const player = state.tanks.find((t) => t.id === "player")!;
    const ai = state.tanks.find((t) => t.id === "ai")!;

    applyInput(player, playerInput, dt, state.blocks);
    applyInput(ai, aiInput, dt, state.blocks);
    if (playerInput.fire) tryFire(state, player);
    if (aiInput.fire) tryFire(state, ai);

    const remaining: Shot[] = [];
    for (const shot of state.shots) {
        shot.pos.x += shot.vel.x * dt;
        shot.pos.y += shot.vel.y * dt;
        shot.life -= dt;

        let dead = shot.life <= 0;
        const lim = ARENA * 0.5;
        if (
            Math.abs(shot.pos.x) > lim ||
            Math.abs(shot.pos.y) > lim
        ) {
            dead = true;
        }
        for (const block of state.blocks) {
            if (circleHitsBlock(shot.pos, 0.4, block)) {
                dead = true;
                break;
            }
        }
        if (!dead) {
            for (const tank of state.tanks) {
                if (hitTank(shot, tank)) {
                    dead = true;
                    onTankHit(state, tank, shot.owner);
                    break;
                }
            }
        }
        if (!dead) remaining.push(shot);
    }
    state.shots = remaining;
}
