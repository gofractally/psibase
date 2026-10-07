export type Vec2 = { x: number; y: number };

export type TankId = "player" | "ai";

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

export type GameState = {
    phase: GamePhase;
    tanks: Tank[];
    shots: Shot[];
    blocks: Block[];
    nextShotId: number;
    message: string;
    elapsed: number;
    respawnIn: number;
    respawnId: TankId | null;
    hitStunIn: number;
    radarAlertIn: number;
    explosionIn: number;
    explosionDuration: number;
    explosionPos: Vec2 | null;
    explosionHeading: number;
};

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
/** Non-red enemy palette (aqua, yellow, violet) — cycled per AI index */
export const ENEMY_COLORS = ["#33eeff", "#ffee33", "#cc66ff"] as const;
