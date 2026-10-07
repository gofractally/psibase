import type { GameState, Tank } from "../game/types";
import type { RosterSlot } from "./protocol";

/** Apply match roster controllers/accounts onto an already-spawned tank list. */
export function applyRoster(state: GameState, roster: RosterSlot[]): void {
    for (const slot of roster) {
        const tank = state.tanks.find((t) => t.id === slot.tankId);
        if (!tank) continue;
        if (slot.controller === "remote") {
            tank.controller = "remote";
            tank.account = slot.account ?? null;
        } else if (slot.controller === "local") {
            tank.controller = state.netRole === "host" ? "local" : "remote";
            tank.account = slot.account ?? null;
        } else {
            tank.controller = "ai";
            tank.account = null;
        }
    }
}

export function serializeSnapshot(state: GameState): unknown {
    return {
        phase: state.phase,
        enemyCount: state.enemyCount,
        message: state.message,
        elapsed: state.elapsed,
        respawnIn: state.respawnIn,
        respawnId: state.respawnId,
        hitStunIn: state.hitStunIn,
        hitStunVictimId: state.hitStunVictimId,
        radarAlertIn: state.radarAlertIn,
        explosionIn: state.explosionIn,
        explosionDuration: state.explosionDuration,
        explosionPos: state.explosionPos,
        explosionHeading: state.explosionHeading,
        explosionColor: state.explosionColor,
        nextShotId: state.nextShotId,
        blocks: state.blocks,
        shots: state.shots,
        tanks: state.tanks,
    };
}

export function applySnapshot(state: GameState, raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const snap = raw as Partial<GameState> & { tanks?: Tank[] };
    if (snap.phase) state.phase = snap.phase;
    if (typeof snap.enemyCount === "number") state.enemyCount = snap.enemyCount;
    if (typeof snap.message === "string") state.message = snap.message;
    if (typeof snap.elapsed === "number") state.elapsed = snap.elapsed;
    if (typeof snap.respawnIn === "number") state.respawnIn = snap.respawnIn;
    if (snap.respawnId !== undefined) state.respawnId = snap.respawnId;
    if (typeof snap.hitStunIn === "number") state.hitStunIn = snap.hitStunIn;
    if (snap.hitStunVictimId !== undefined) {
        state.hitStunVictimId = snap.hitStunVictimId;
    }
    if (typeof snap.radarAlertIn === "number") {
        state.radarAlertIn = snap.radarAlertIn;
    }
    if (typeof snap.explosionIn === "number") {
        state.explosionIn = snap.explosionIn;
    }
    if (typeof snap.explosionDuration === "number") {
        state.explosionDuration = snap.explosionDuration;
    }
    if (snap.explosionPos !== undefined) {
        state.explosionPos = snap.explosionPos;
    }
    if (typeof snap.explosionHeading === "number") {
        state.explosionHeading = snap.explosionHeading;
    }
    if (typeof snap.explosionColor === "string") {
        state.explosionColor = snap.explosionColor;
    }
    if (typeof snap.nextShotId === "number") state.nextShotId = snap.nextShotId;
    if (Array.isArray(snap.blocks)) state.blocks = snap.blocks;
    if (Array.isArray(snap.shots)) state.shots = snap.shots;
    if (Array.isArray(snap.tanks)) {
        // Preserve local net metadata on tanks we already know
        const prev = new Map(state.tanks.map((t) => [t.id, t]));
        state.tanks = snap.tanks.map((t) => {
            const old = prev.get(t.id);
            return {
                ...t,
                controller: t.controller ?? old?.controller ?? "ai",
                account: t.account ?? old?.account ?? null,
            };
        });
    }
}
