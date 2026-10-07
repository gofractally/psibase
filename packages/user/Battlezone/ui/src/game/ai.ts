import {
    FIRE_RANGE,
    TANK_RADIUS,
    isEnemyId,
    type GameState,
    type InputState,
    type Tank,
} from "./types";

function angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function facingOf(from: Tank, to: Tank): number {
    const dx = to.pos.x - from.pos.x;
    const dy = to.pos.y - from.pos.y;
    // heading 0 faces -Y; sin/cos match sim movement
    return Math.atan2(dx, -dy);
}

function distBetween(a: Tank, b: Tank): number {
    return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

const IDLE: InputState = { turn: 0, throttle: 0, fire: false };

/** Brief stick so the AI does not flicker every frame; breaks on proximity. */
const aiFocus = new Map<string, { targetId: string; stickUntil: number }>();

function isHumanTank(t: Tank): boolean {
    if (t.controller === "ai" && !t.account) return false;
    return (
        t.id === "player" ||
        t.controller === "local" ||
        t.controller === "remote" ||
        !!t.account
    );
}

/**
 * Prefer living humans; if none remain in the match, fight other live tanks
 * so free-for-all can finish with a single winner.
 */
function pickFoes(state: GameState, ai: Tank): Tank[] {
    const humansLeft = state.tanks.filter(
        (t) => t.id !== ai.id && t.lives > 0 && isHumanTank(t),
    );
    if (humansLeft.length > 0) {
        const alive = humansLeft.filter((t) => t.alive);
        // Wait out human respawn instead of turning on other AIs early.
        return alive;
    }
    return state.tanks.filter((t) => t.alive && t.id !== ai.id);
}

function pickTarget(state: GameState, ai: Tank): Tank | null {
    const foes = pickFoes(state, ai);
    if (foes.length === 0) {
        aiFocus.delete(ai.id);
        return null;
    }

    const closest = foes.reduce((best, t) =>
        distBetween(ai, t) < distBetween(ai, best) ? t : best,
    );

    const focus = aiFocus.get(ai.id);
    const current =
        focus !== undefined
            ? foes.find((t) => t.id === focus.targetId)
            : undefined;

    if (!current || focus === undefined) {
        aiFocus.set(ai.id, {
            targetId: closest.id,
            stickUntil: state.elapsed + 1.2 + Math.random(),
        });
        return closest;
    }

    const curDist = distBetween(ai, current);
    const closeDist = distBetween(ai, closest);
    const stickExpired = state.elapsed >= focus.stickUntil;

    // Retarget when another human is closer (small hysteresis), or in a
    // short threat bubble, or when the stick timer expires.
    const nearer = closeDist + 6 < curDist;
    const inFace = closeDist < 28 && closeDist < curDist;
    if (
        closest.id !== current.id &&
        (nearer || inFace || (stickExpired && closeDist <= curDist))
    ) {
        aiFocus.set(ai.id, {
            targetId: closest.id,
            stickUntil: state.elapsed + 1.2 + Math.random(),
        });
        return closest;
    }

    if (stickExpired) {
        aiFocus.set(ai.id, {
            targetId: current.id,
            stickUntil: state.elapsed + 1.2 + Math.random(),
        });
    }
    return current;
}

/** AI steering for a single enemy tank hunting the nearest / focused human. */
export function computeAiInput(state: GameState, ai: Tank): InputState {
    if (
        !ai.alive ||
        !isEnemyId(ai.id) ||
        ai.controller !== "ai" ||
        state.phase !== "playing"
    ) {
        return IDLE;
    }

    const target = pickTarget(state, ai);
    if (!target) return IDLE;

    const desired = facingOf(ai, target);
    const err = angleDiff(desired, ai.heading);
    const turn = Math.max(-1, Math.min(1, err * 2.2));

    const dist = distBetween(ai, target);

    let throttle = 0;
    if (Math.abs(err) < 0.6) {
        if (dist > 38) throttle = 1;
        else if (dist < 18) throttle = -0.6;
        else throttle = 0.35;
    } else if (dist > 50) {
        throttle = 0.4;
    }

    // Nudge away from nearest block center if very close
    let nearest = Infinity;
    let away = { x: 0, y: 0 };
    for (const block of state.blocks) {
        const bx = ai.pos.x - block.pos.x;
        const by = ai.pos.y - block.pos.y;
        const d = Math.hypot(bx, by) - block.half;
        if (d < nearest) {
            nearest = d;
            away = { x: bx, y: by };
        }
    }
    if (nearest < TANK_RADIUS + 4) {
        const avoidHeading = Math.atan2(away.x, -away.y);
        const avoidErr = angleDiff(avoidHeading, ai.heading);
        if (Math.abs(avoidErr) > 0.3) {
            return {
                turn: Math.max(-1, Math.min(1, avoidErr * 2)),
                throttle: 0.7,
                fire: false,
            };
        }
    }

    const fire =
        Math.abs(err) < 0.18 &&
        dist < FIRE_RANGE &&
        ai.cooldown <= 0 &&
        !state.shots.some((s) => s.owner === ai.id) &&
        Math.random() < 0.045;

    return { turn, throttle, fire };
}

export function computeAllAiInputs(
    state: GameState,
): Map<string, InputState> {
    const inputs = new Map<string, InputState>();
    for (const tank of state.tanks) {
        if (!isEnemyId(tank.id)) continue;
        inputs.set(tank.id, computeAiInput(state, tank));
    }
    return inputs;
}
