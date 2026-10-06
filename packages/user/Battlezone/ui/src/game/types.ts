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
};

export type Shot = {
    id: number;
    owner: TankId;
    pos: Vec2;
    vel: Vec2;
    life: number;
};

export type Block = {
    pos: Vec2;
    half: number;
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
    /** Seconds until a dead tank with lives remaining respawns; 0 = idle */
    respawnIn: number;
    respawnId: TankId | null;
    /** Player hit-stun: freeze view + crack overlay while this counts down */
    hitStunIn: number;
    /** Radar border alert after an enemy shot is fired */
    radarAlertIn: number;
    /** Final-kill / mid-kill enemy explosion countdown (seconds remaining) */
    explosionIn: number;
    explosionDuration: number;
    explosionPos: Vec2 | null;
    explosionHeading: number;
};

export const ARENA = 180;
export const TANK_RADIUS = 2.2;
export const SHOT_SPEED = 55;
export const SHOT_LIFE = 2.2;
export const TURN_RATE = 2.4;
export const MOVE_SPEED = 22;
export const FIRE_COOLDOWN = 0.55;
export const START_LIVES = 3;
export const PLAYER_HIT_STUN = 2.0;
export const AI_RESPAWN_DELAY = 1.2;
export const RADAR_ALERT_DURATION = 0.75;
/** Hold on final enemy kill so the explosion can play out */
export const ENEMY_EXPLOSION_DURATION = 5.0;
/** Shorter explosion when the enemy still has lives left */
export const ENEMY_EXPLOSION_MID = 2.0;
