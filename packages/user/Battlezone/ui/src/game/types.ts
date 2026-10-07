export type Vec2 = { x: number; y: number };

/** "player" or "ai-0" … "ai-4" */
export type TankId = string;

export function isEnemyId(id: TankId): boolean {
    return id !== "player";
}

export function aiTankId(index: number): TankId {
    return `ai-${index}`;
}

export type TankController = "local" | "ai" | "remote";

export type Tank = {
    id: TankId;
    pos: Vec2;
    heading: number;
    alive: boolean;
    lives: number;
    cooldown: number;
    score: number;
    /** Wireframe / radar color (player green; enemies from ENEMY_COLORS) */
    color: string;
    controller: TankController;
    /** Bound account when controlled by a human */
    account: string | null;
};

export type Shot = {
    id: number;
    owner: TankId;
    pos: Vec2;
    vel: Vec2;
    life: number;
};

/** Footprint half-extent used for collision / placement */
export type ObstacleShape =
    | "box"
    | "pyramid"
    | "trapezoid"
    | "column"
    | "wedge";

export type Block = {
    pos: Vec2;
    half: number;
    shape: ObstacleShape;
    /** Random yaw for visual variety (radians) */
    yaw: number;
    /** Visual height multiplier in [1, 2] vs the base shape height */
    heightScale: number;
};

export type InputState = {
    turn: number;
    throttle: number;
    fire: boolean;
};

export type GamePhase = "title" | "playing" | "win" | "lose";

/** Local host runs the sim; remote clients render snapshots */
export type NetRole = "offline" | "host" | "remote";

export type LivePeer = {
    account: string;
    online: boolean;
};

export type LobbyPeer = {
    account: string;
    ready: boolean;
};

/** Per enemy tank slot on the title screen */
export type EnemySlotMode = "ai" | "human";

export type GameState = {
    phase: GamePhase;
    /** Enemy tank count chosen on the title screen (1–5); total tanks = 1 + this */
    enemyCount: number;
    /**
     * Controller preference per enemy slot (length == enemyCount).
     * Only "human" slots are filled from live peers when starting a match.
     */
    enemySlotModes: EnemySlotMode[];
    tanks: Tank[];
    shots: Shot[];
    blocks: Block[];
    nextShotId: number;
    message: string;
    elapsed: number;
    respawnIn: number;
    respawnId: TankId | null;
    hitStunIn: number;
    /** Which tank's cockpit is cracked; null when no hit-stun */
    hitStunVictimId: TankId | null;
    radarAlertIn: number;
    explosionIn: number;
    explosionDuration: number;
    explosionPos: Vec2 | null;
    explosionHeading: number;
    explosionColor: string;
    /** Logged-in account for this client */
    localAccount: string | null;
    netRole: NetRole;
    /** Other accounts currently connected to x-bzone */
    livePeers: LivePeer[];
    /**
     * Live peers the host opted out of (Human→AI on their seat). They stay
     * excluded until toggled back in or they leave Battlezone.
     */
    optedOutPeers: string[];
    /** Waiting-room roster from server (`lobby` frames) */
    lobbyPlayers: LobbyPeer[];
    lobbyHost: string | null;
    /** Local client has pressed Enter and is waiting on peers */
    lobbyReady: boolean;
    /**
     * Tank this client views / controls from ("player" for host, "ai-N" for
     * a remote human). Null on the title screen.
     */
    viewTankId: TankId | null;
    netStatus: string;
};

/** Player + enemies = 6 max */
export const MIN_ENEMY_TANKS = 1;
export const MAX_ENEMY_TANKS = 5;
export const DEFAULT_ENEMY_TANKS = 1;

/** Keep slot-mode array length in sync with enemyCount; new slots default to AI. */
export function syncEnemySlotModes(
    modes: EnemySlotMode[],
    enemyCount: number,
): EnemySlotMode[] {
    const next = modes.slice(0, enemyCount);
    while (next.length < enemyCount) next.push("ai");
    return next;
}

/** Online peers not opted out — join order, same as roster fill order. */
export function includablePeers(state: GameState): string[] {
    const opted = new Set(state.optedOutPeers);
    return state.livePeers
        .filter((p) => p.online && !opted.has(p.account))
        .map((p) => p.account);
}

/**
 * Labels for enemy slots on the title screen.
 * Human seats show the bound peer account, or "Human" if empty; AI seats
 * show "AI". Empty Human seats become AI when the match starts.
 */
export function enemySlotLabels(state: GameState): string[] {
    const peers = includablePeers(state);
    const modes = state.enemySlotModes.slice(0, state.enemyCount);
    let peerIdx = 0;
    return modes.map((mode) => {
        if (mode !== "human") return "AI";
        return peers[peerIdx++] ?? "Human";
    });
}

/** Peer account bound to each enemy slot (null if AI or empty Human). */
export function slotPeerBindings(state: GameState): (string | null)[] {
    const peers = includablePeers(state);
    const modes = state.enemySlotModes.slice(0, state.enemyCount);
    let peerIdx = 0;
    return modes.map((mode) => {
        if (mode !== "human") return null;
        return peers[peerIdx++] ?? null;
    });
}

/**
 * Default: every Battlezone-connected peer gets a human seat. Grows
 * enemyCount as needed (up to MAX). Never overrides a seat the host set to
 * AI for an opted-out peer — new seats are added instead when required.
 */
export function includeAvailablePeers(state: GameState): void {
    const online = new Set(
        state.livePeers.filter((p) => p.online).map((p) => p.account),
    );
    state.optedOutPeers = state.optedOutPeers.filter((a) => online.has(a));

    const peerCount = includablePeers(state).length;
    const modes = syncEnemySlotModes(state.enemySlotModes, state.enemyCount);
    let humanSeats = modes.filter((m) => m === "human").length;
    let needMore = peerCount - humanSeats;

    while (needMore > 0) {
        const aiIdx = modes.findIndex((m) => m === "ai");
        if (aiIdx >= 0) {
            modes[aiIdx] = "human";
            needMore -= 1;
            humanSeats += 1;
            continue;
        }
        if (state.enemyCount >= MAX_ENEMY_TANKS) break;
        state.enemyCount += 1;
        modes.push("human");
        needMore -= 1;
        humanSeats += 1;
    }

    state.enemySlotModes = modes;
}

/** Playable / obstacle field (~3× linear → ~9× area vs original) */
export const ARENA = 540;
/** Half-extent for obstacle placement (fills most of the arena disk) */
export const FIELD_LIM = ARENA * 0.46;
/**
 * Tank spawn half-extent — well inside FIELD_LIM so both tanks drop amid
 * obstacles, not on the sparse outer fringe that feels "outside".
 */
export const TANK_SPAWN_LIM = ARENA * 0.32;
export const TANK_RADIUS = 2.2;
export const SHOT_SPEED = 27.5;
export const SHOT_LIFE = 3.3;
/** World distance at which shots remain effective / HUD box hides */
export const FIRE_RANGE = SHOT_SPEED * SHOT_LIFE;
export const TURN_RATE = 2.4;
export const MOVE_SPEED = 11;
export const FIRE_COOLDOWN = 0.55;
export const START_LIVES = 3;
export const PLAYER_HIT_STUN = 2.0;
export const AI_RESPAWN_DELAY = 1.2;
export const RADAR_ALERT_DURATION = 0.75;
export const ENEMY_EXPLOSION_DURATION = 5.0;
export const ENEMY_EXPLOSION_MID = 2.0;
/** Target obstacle count at same density as the original 9-in-~180 field */
export const OBSTACLE_COUNT = 81;
export const MIN_TANK_SEPARATION = 45;
/** Must have an obstacle roughly this close so spawn feels "in the field" */
export const SPAWN_NEAR_OBSTACLE = 55;

export const PLAYER_COLOR = "#33ff66";
/** Non-red enemy palette — cycled per AI index (up to MAX_ENEMY_TANKS) */
export const ENEMY_COLORS = [
    "#33eeff",
    "#ffee33",
    "#cc66ff",
    "#ff9933",
    "#66ffcc",
] as const;

