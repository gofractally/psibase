import {
    ARENA,
    ENEMY_EXPLOSION_DURATION,
    ENEMY_EXPLOSION_MID,
    MOVE_SPEED,
    PLAYER_HIT_STUN,
    RADAR_ALERT_DURATION,
    SHOT_LIFE,
    SHOT_SPEED,
    TANK_RADIUS,
    TURN_RATE,
    isEnemyId,
    type Block,
    type GameState,
    type InputState,
    type Shot,
    type Tank,
    type Vec2,
} from "./types";
import { missionMessage, respawnTank } from "./world";

function clampArena(p: Vec2): void {
    const lim = ARENA * 0.5 - TANK_RADIUS;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.y = Math.max(-lim, Math.min(lim, p.y));
}

function circleHitsBlock(pos: Vec2, radius: number, block: Block): boolean {
    const dx = Math.max(Math.abs(pos.x - block.pos.x) - block.half, 0);
    const dy = Math.max(Math.abs(pos.y - block.pos.y) - block.half, 0);
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

function hasLiveShot(state: GameState, owner: Tank["id"]): boolean {
    return state.shots.some((s) => s.owner === owner);
}

function tryFire(state: GameState, tank: Tank): void {
    // One shot in flight at a time — next fire waits for hit or miss
    if (!tank.alive || tank.cooldown > 0 || hasLiveShot(state, tank.id)) return;
    const dir = { x: Math.sin(tank.heading), y: -Math.cos(tank.heading) };
    const shot: Shot = {
        id: state.nextShotId++,
        owner: tank.id,
        pos: {
            x: tank.pos.x + dir.x * (TANK_RADIUS + 2.5),
            y: tank.pos.y + dir.y * (TANK_RADIUS + 2.5),
        },
        vel: { x: dir.x * SHOT_SPEED, y: dir.y * SHOT_SPEED },
        life: SHOT_LIFE,
    };
    state.shots.push(shot);
    if (isEnemyId(tank.id)) {
        state.radarAlertIn = RADAR_ALERT_DURATION;
    }
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

/** Free-for-all: any tank's shot can hit any other live tank (incl. AI). */
function canHit(shot: Shot, tank: Tank): boolean {
    if (!tank.alive || shot.owner === tank.id) return false;
    return true;
}

function hitTank(shot: Shot, tank: Tank): boolean {
    if (!canHit(shot, tank)) return false;
    const dx = shot.pos.x - tank.pos.x;
    const dy = shot.pos.y - tank.pos.y;
    return dx * dx + dy * dy <= TANK_RADIUS * TANK_RADIUS;
}

/** Tanks that still have lives left (may be mid-respawn / not alive). */
function contenders(state: GameState): Tank[] {
    return state.tanks.filter((t) => t.lives > 0);
}

function winnerLabel(tank: Tank, state: GameState): string {
    if (tank.account) return String(tank.account);
    if (tank.id === "player" && state.localAccount) {
        return state.localAccount;
    }
    if (tank.controller === "ai") return "AI";
    return tank.id === "player" ? "HOST" : "AI";
}

/** Match ends only when a single tank still has lives. */
function tryDeclareWinner(state: GameState): boolean {
    const left = contenders(state);
    if (left.length !== 1) return false;
    const winner = left[0]!;
    state.phase = "win";
    state.message = `Victory is ${winnerLabel(winner, state)}'s!`;
    state.respawnIn = 0;
    state.respawnId = null;
    return true;
}

function onTankHit(state: GameState, victim: Tank, attackerId: Tank["id"]): void {
    victim.alive = false;
    victim.lives -= 1;
    const attacker = state.tanks.find((t) => t.id === attackerId);
    if (attacker) attacker.score += 1;

    // Drop the victim's in-flight shots only — others keep fighting.
    state.shots = state.shots.filter((s) => s.owner !== victim.id);

    if (victim.id === "player") {
        state.hitStunIn = PLAYER_HIT_STUN;
        state.hitStunVictimId = "player";
        if (victim.lives <= 0) {
            if (tryDeclareWinner(state)) {
                state.explosionDuration = ENEMY_EXPLOSION_DURATION;
                state.explosionIn = ENEMY_EXPLOSION_DURATION;
            } else {
                // Eliminated: stay in match as a radar spectator.
                state.message = "ELIMINATED";
                state.respawnIn = 0;
                state.respawnId = null;
            }
        } else {
            state.message = "TANK DESTROYED";
            state.respawnIn = PLAYER_HIT_STUN;
            state.respawnId = "player";
        }
        return;
    }

    // Enemy hit: explode at the kill site. Human-controlled enemies also get
    // cockpit hit-stun so only their client shows the cracked windshield.
    state.explosionPos = { ...victim.pos };
    state.explosionHeading = victim.heading;
    state.explosionColor = victim.color;
    if (victim.controller === "remote") {
        state.hitStunIn = PLAYER_HIT_STUN;
        state.hitStunVictimId = victim.id;
    }

    if (victim.lives <= 0) {
        if (tryDeclareWinner(state)) {
            state.explosionDuration = ENEMY_EXPLOSION_DURATION;
            state.explosionIn = ENEMY_EXPLOSION_DURATION;
        } else {
            state.message = "ENEMY DESTROYED";
            state.explosionDuration = ENEMY_EXPLOSION_MID;
            state.explosionIn = ENEMY_EXPLOSION_MID;
            state.respawnId = null;
            state.respawnIn = 0;
        }
    } else {
        state.message = "HIT CONFIRMED";
        state.explosionDuration = ENEMY_EXPLOSION_MID;
        state.explosionIn = ENEMY_EXPLOSION_MID;
        state.respawnId = victim.id;
        state.respawnIn = 0; // respawn after explosion finishes
    }
}

export function stepGame(
    state: GameState,
    playerInput: InputState,
    aiInputs: Map<string, InputState>,
    dt: number,
): void {
    if (state.phase === "title") return;

    // Freeze gameplay while an explosion and/or cockpit hit-stun plays out.
    if (state.explosionIn > 0 || state.hitStunIn > 0) {
        state.elapsed += dt;
        if (state.explosionIn > 0) {
            state.explosionIn = Math.max(0, state.explosionIn - dt);
        }
        if (state.hitStunIn > 0) {
            state.hitStunIn = Math.max(0, state.hitStunIn - dt);
            if (state.hitStunIn <= 0) {
                state.hitStunVictimId = null;
            }
        }
        if (state.respawnIn > 0 && state.respawnId === "player") {
            state.respawnIn = Math.max(0, state.respawnIn - dt);
        }

        const frozenDone = state.explosionIn <= 0 && state.hitStunIn <= 0;
        if (frozenDone) {
            if (state.phase === "win") {
                // Keep the shared victory line for the end screen.
                state.explosionPos = null;
            } else if (state.phase === "playing") {
                if (state.respawnId === "player" && state.respawnIn <= 0) {
                    const tank = state.tanks.find((t) => t.id === "player");
                    const others = state.tanks.filter((t) => t.id !== "player");
                    if (tank) respawnTank(tank, state.blocks, others);
                    state.respawnId = null;
                } else if (state.respawnId && isEnemyId(state.respawnId)) {
                    const tank = state.tanks.find((t) => t.id === state.respawnId);
                    const others = state.tanks.filter(
                        (t) => t.id !== state.respawnId,
                    );
                    if (tank) respawnTank(tank, state.blocks, others);
                    state.respawnId = null;
                }
                state.explosionPos = null;
                state.message = missionMessage(state.enemyCount);
            }
        }
        return;
    }

    if (state.phase !== "playing") return;
    state.elapsed += dt;
    if (state.radarAlertIn > 0) {
        state.radarAlertIn = Math.max(0, state.radarAlertIn - dt);
    }

    const player = state.tanks.find((t) => t.id === "player")!;
    applyInput(player, playerInput, dt, state.blocks);
    if (playerInput.fire) tryFire(state, player);

    for (const tank of state.tanks) {
        if (!isEnemyId(tank.id)) continue;
        const input = aiInputs.get(tank.id) ?? {
            turn: 0,
            throttle: 0,
            fire: false,
        };
        applyInput(tank, input, dt, state.blocks);
        if (input.fire) tryFire(state, tank);
    }

    const remaining: Shot[] = [];
    for (const shot of state.shots) {
        shot.pos.x += shot.vel.x * dt;
        shot.pos.y += shot.vel.y * dt;
        shot.life -= dt;

        let dead = shot.life <= 0;
        const lim = ARENA * 0.5;
        if (Math.abs(shot.pos.x) > lim || Math.abs(shot.pos.y) > lim) {
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
