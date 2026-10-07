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

const IDLE: InputState = { turn: 0, throttle: 0, fire: false };

/** AI steering for a single enemy tank hunting the player */
export function computeAiInput(state: GameState, ai: Tank): InputState {
    const player = state.tanks.find((t) => t.id === "player");
    if (
        !player ||
        !ai.alive ||
        !isEnemyId(ai.id) ||
        ai.controller !== "ai" ||
        state.phase !== "playing"
    ) {
        return IDLE;
    }

    const desired = facingOf(ai, player);
    const err = angleDiff(desired, ai.heading);
    const turn = Math.max(-1, Math.min(1, err * 2.2));

    const dx = player.pos.x - ai.pos.x;
    const dy = player.pos.y - ai.pos.y;
    const dist = Math.hypot(dx, dy);

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
