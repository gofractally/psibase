import {
    ARENA,
    ENEMY_EXPLOSION_DURATION,
    type Block,
    type GameState,
    type Tank,
    type Vec2,
} from "./types";

const COLOR = "#33ff66";
const DIM = "#1a9944";
const BG = "#000000";
const ALERT = "#ff3333";

type Cam = {
    pos: Vec2;
    heading: number;
};

function worldToView(cam: Cam, p: Vec2): { x: number; y: number; z: number } {
    const dx = p.x - cam.pos.x;
    const dy = p.y - cam.pos.y;
    // Must match tank forward (sin(h), -cos(h)) and right (cos(h), sin(h))
    const fx = Math.sin(cam.heading);
    const fy = -Math.cos(cam.heading);
    const rx = Math.cos(cam.heading);
    const ry = Math.sin(cam.heading);
    return {
        x: dx * rx + dy * ry,
        y: 0,
        z: dx * fx + dy * fy,
    };
}

function project(
    width: number,
    height: number,
    v: { x: number; y: number; z: number },
    fov = 1.05,
): { x: number; y: number } | null {
    if (v.z < 0.8) return null;
    const scale = (height * 0.55) / (v.z * fov);
    return {
        x: width * 0.5 + v.x * scale,
        y: height * 0.55 - v.y * scale,
    };
}

function strokePoly(
    ctx: CanvasRenderingContext2D,
    pts: ({ x: number; y: number } | null)[],
    close = true,
): void {
    const first = pts.find((p) => p);
    if (!first) return;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
        if (!p) {
            started = false;
            continue;
        }
        if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
        } else {
            ctx.lineTo(p.x, p.y);
        }
    }
    if (close && started) ctx.closePath();
    ctx.stroke();
}

function fillPoly(
    ctx: CanvasRenderingContext2D,
    pts: ({ x: number; y: number } | null)[],
): void {
    if (pts.some((p) => !p) || pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i]!.x, pts[i]!.y);
    }
    ctx.closePath();
    ctx.fill();
}

function projectLocal(
    width: number,
    height: number,
    cam: Cam,
    tank: Tank,
    lx: number,
    ly: number,
    lz: number,
): { x: number; y: number } | null {
    const fx = Math.sin(tank.heading);
    const fy = -Math.cos(tank.heading);
    const rx = Math.cos(tank.heading);
    const ry = Math.sin(tank.heading);
    const world = {
        x: tank.pos.x + rx * lx + fx * ly,
        y: tank.pos.y + ry * lx + fy * ly,
    };
    const v = worldToView(cam, world);
    return project(width, height, { x: v.x, y: lz, z: v.z });
}

function drawHorizon(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    heading: number,
): void {
    const horizon = height * 0.55;
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(width, horizon);
    ctx.stroke();

    ctx.beginPath();
    const base = horizon - 2;
    for (let i = 0; i <= width; i += 8) {
        const worldAngle = heading + (i / width - 0.5) * 1.4;
        const h =
            18 +
            22 * Math.abs(Math.sin(worldAngle * 3.1)) +
            10 * Math.abs(Math.sin(worldAngle * 7.3 + 1.2));
        const y = base - h;
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
    }
    ctx.stroke();
}

function drawBlock(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    block: Block,
): void {
    const h = block.half * 1.4;
    const corners: Vec2[] = [
        { x: block.pos.x - block.half, y: block.pos.y - block.half },
        { x: block.pos.x + block.half, y: block.pos.y - block.half },
        { x: block.pos.x + block.half, y: block.pos.y + block.half },
        { x: block.pos.x - block.half, y: block.pos.y + block.half },
    ];
    const bottom = corners.map((c) => {
        const v = worldToView(cam, c);
        return project(width, height, { ...v, y: 0 });
    });
    const top = corners.map((c) => {
        const v = worldToView(cam, c);
        return project(width, height, { ...v, y: h });
    });

    // 85% transparent fill (15% opaque)
    ctx.fillStyle = "rgba(51, 255, 102, 0.15)";
    fillPoly(ctx, top);
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        fillPoly(ctx, [bottom[i], bottom[j], top[j], top[i]]);
    }

    ctx.strokeStyle = COLOR;
    strokePoly(ctx, bottom);
    strokePoly(ctx, top);
    for (let i = 0; i < 4; i++) {
        strokePoly(ctx, [bottom[i], top[i]], false);
    }
}

function drawBoxEdges(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    tank: Tank,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
): void {
    const c = [
        projectLocal(width, height, cam, tank, x0, y0, z0),
        projectLocal(width, height, cam, tank, x1, y0, z0),
        projectLocal(width, height, cam, tank, x1, y1, z0),
        projectLocal(width, height, cam, tank, x0, y1, z0),
        projectLocal(width, height, cam, tank, x0, y0, z1),
        projectLocal(width, height, cam, tank, x1, y0, z1),
        projectLocal(width, height, cam, tank, x1, y1, z1),
        projectLocal(width, height, cam, tank, x0, y1, z1),
    ];
    // bottom
    strokePoly(ctx, [c[0], c[1], c[2], c[3]]);
    // top
    strokePoly(ctx, [c[4], c[5], c[6], c[7]]);
    // verticals
    for (let i = 0; i < 4; i++) {
        strokePoly(ctx, [c[i], c[i + 4]], false);
    }
}

function drawTankMesh(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    tank: Tank,
): void {
    if (!tank.alive) return;
    ctx.strokeStyle = COLOR;

    // Lower hull / chassis (boxy body)
    drawBoxEdges(ctx, width, height, cam, tank, -2.1, 2.1, -2.4, 2.4, 0.0, 1.2);
    // Side track sills (extra edges to distinguish from cubes)
    drawBoxEdges(ctx, width, height, cam, tank, -2.4, -1.7, -2.5, 2.5, 0.0, 0.7);
    drawBoxEdges(ctx, width, height, cam, tank, 1.7, 2.4, -2.5, 2.5, 0.0, 0.7);
    // Turret
    drawBoxEdges(ctx, width, height, cam, tank, -1.2, 1.2, -0.9, 1.3, 1.2, 2.2);
    // Gun barrel pointing forward (+Y) — shows facing
    drawBoxEdges(ctx, width, height, cam, tank, -0.25, 0.25, 1.3, 3.6, 1.55, 1.95);
    // Front glacis hint: angled line from hull nose
    const noseL = projectLocal(width, height, cam, tank, -1.5, 2.4, 1.2);
    const noseR = projectLocal(width, height, cam, tank, 1.5, 2.4, 1.2);
    const noseTip = projectLocal(width, height, cam, tank, 0, 2.9, 0.5);
    strokePoly(ctx, [noseL, noseTip, noseR], false);
}


function drawShots(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    state: GameState,
): void {
    ctx.strokeStyle = COLOR;
    for (const shot of state.shots) {
        const v = worldToView(cam, shot.pos);
        // Own shots start very near the camera; keep a lower near-clip for them
        const near = shot.owner === "player" ? 0.2 : 0.8;
        if (v.z < near) continue;
        const scale = (height * 0.55) / (v.z * 1.05);
        const p = {
            x: width * 0.5 + v.x * scale,
            y: height * 0.55 - 1.2 * scale,
        };
        const size = Math.max(3, 48 / Math.max(v.z, 0.5));
        ctx.beginPath();
        ctx.moveTo(p.x - size, p.y);
        ctx.lineTo(p.x + size, p.y);
        ctx.moveTo(p.x, p.y - size);
        ctx.lineTo(p.x, p.y + size);
        ctx.stroke();
    }
}

function drawRadar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    player: Tank,
): void {
    const size = Math.min(220, width * 0.36);
    const x = width - size - 16;
    const y = height - size - 16;

    const enemyShots = state.shots.filter((s) => s.owner === "ai");
    const alertBlink =
        state.radarAlertIn > 0 && Math.floor(state.elapsed * 8) % 2 === 0;
    ctx.strokeStyle = alertBlink ? ALERT : DIM;
    ctx.lineWidth = alertBlink ? 3 : 1;
    ctx.strokeRect(x, y, size, size);
    ctx.lineWidth = 1;

    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size / 2, y + size);
    ctx.moveTo(x, y + size / 2);
    ctx.lineTo(x + size, y + size / 2);
    ctx.stroke();

    const scale = size / ARENA;
    const toRadar = (p: Vec2) => ({
        rx: x + size / 2 + (p.x - player.pos.x) * scale,
        ry: y + size / 2 + (p.y - player.pos.y) * scale,
    });

    ctx.fillStyle = DIM;
    for (const block of state.blocks) {
        const r = toRadar(block.pos);
        const s = block.half * scale * 2;
        ctx.fillRect(r.rx - s / 2, r.ry - s / 2, s, s);
    }

    // Enemy projectiles (red)
    ctx.fillStyle = ALERT;
    for (const shot of enemyShots) {
        const r = toRadar(shot.pos);
        if (r.rx < x || r.rx > x + size || r.ry < y || r.ry > y + size) continue;
        ctx.beginPath();
        ctx.arc(r.rx, r.ry, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const r = toRadar(tank.pos);
        ctx.strokeStyle = COLOR;
        ctx.beginPath();
        ctx.arc(r.rx, r.ry, tank.id === "player" ? 4 : 5, 0, Math.PI * 2);
        ctx.stroke();
        if (tank.id === "player") {
            const fx = Math.sin(player.heading) * 8;
            const fy = -Math.cos(player.heading) * 8;
            ctx.beginPath();
            ctx.moveTo(r.rx, r.ry);
            ctx.lineTo(r.rx + fx * scale * 8, r.ry + fy * scale * 8);
            ctx.stroke();
        }
    }
}

function drawHud(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    player: Tank,
    enemy: Tank,
): void {
    ctx.fillStyle = COLOR;
    ctx.font = "14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`SCORE ${player.score}`, 16, 24);
    ctx.fillText(`LIVES ${Math.max(0, player.lives)}`, 16, 44);
    ctx.textAlign = "right";
    ctx.fillText(`ENEMY ${Math.max(0, enemy.lives)}`, width - 16, 24);

    const cx = width / 2;
    const cy = height * 0.55;
    ctx.strokeStyle = COLOR;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy);
    ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy + 4);
    ctx.lineTo(cx, cy + 14);
    ctx.stroke();

    if (state.message) {
        ctx.textAlign = "center";
        ctx.font = "18px monospace";
        ctx.fillText(state.message, width / 2, height * 0.18);
    }
}

function drawReticleGround(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
): void {
    const horizon = height * 0.55;
    ctx.strokeStyle = DIM;
    for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const y = horizon + (height - horizon) * t * t;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

/** Battlezone-style cracked windshield overlay while the player is stunned */
function drawWindshieldCrack(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
): void {
    const cx = width * 0.48;
    const cy = height * 0.42;
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1.5;
    const rays: [number, number][] = [
        [0.15, -0.55],
        [0.55, -0.25],
        [0.7, 0.1],
        [0.45, 0.45],
        [0.05, 0.55],
        [-0.35, 0.4],
        [-0.65, 0.05],
        [-0.5, -0.35],
        [-0.1, -0.6],
        [0.25, 0.2],
        [-0.2, -0.15],
        [0.35, -0.5],
    ];
    for (const [dx, dy] of rays) {
        const len = Math.hypot(width, height) * (0.18 + Math.abs(dx) * 0.12);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * len, cy + dy * len);
        ctx.stroke();
        const mx = cx + dx * len * 0.55;
        const my = cy + dy * len * 0.55;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - dy * len * 0.12, my + dx * len * 0.12);
        ctx.stroke();
    }
    ctx.lineWidth = 1;
}

/** Wireframe tank debris expanding over ENEMY_EXPLOSION_DURATION */
function drawExplosion(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    state: GameState,
): void {
    if (!state.explosionPos || state.explosionIn <= 0) return;
    const duration = state.explosionDuration || ENEMY_EXPLOSION_DURATION;
    const progress = 1 - state.explosionIn / duration;
    const pos = state.explosionPos;
    const heading = state.explosionHeading;

    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    const rx = Math.cos(heading);
    const ry = Math.sin(heading);

    // Expanding blast rings in world XZ (ground plane)
    ctx.strokeStyle = COLOR;
    for (let ring = 0; ring < 3; ring++) {
        const radius = (2 + ring * 3) + progress * (18 + ring * 10);
        const segs = 16;
        const pts: ({ x: number; y: number } | null)[] = [];
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const wx = pos.x + Math.cos(a) * radius;
            const wy = pos.y + Math.sin(a) * radius;
            const v = worldToView(cam, { x: wx, y: wy });
            pts.push(project(width, height, { ...v, y: 0.2 + progress * 1.5 }));
        }
        strokePoly(ctx, pts, false);
    }

    // Flying hull fragments
    const fragments: { lx: number; ly: number; lz: number; vx: number; vy: number; vz: number }[] =
        [
            { lx: -1.5, ly: -1, lz: 0.5, vx: -1.2, vy: -0.4, vz: 2.5 },
            { lx: 1.5, ly: -1, lz: 0.5, vx: 1.3, vy: -0.3, vz: 2.2 },
            { lx: 0, ly: 2, lz: 0.8, vx: 0.2, vy: 1.5, vz: 3.0 },
            { lx: -1, ly: 1, lz: 1.5, vx: -0.8, vy: 0.9, vz: 2.8 },
            { lx: 1, ly: 1, lz: 1.5, vx: 0.9, vy: 0.7, vz: 2.6 },
            { lx: 0, ly: -2, lz: 0.3, vx: -0.1, vy: -1.4, vz: 1.8 },
            { lx: -2, ly: 0.5, lz: 1, vx: -1.6, vy: 0.3, vz: 2.0 },
            { lx: 2, ly: 0.5, lz: 1, vx: 1.5, vy: 0.4, vz: 2.1 },
        ];

    const t = progress;
    const ease = t * t; // accelerate outward
    for (const f of fragments) {
        const localX = f.lx + f.vx * ease * 14;
        const localY = f.ly + f.vy * ease * 14;
        const localZ = f.lz + f.vz * ease * 10 - ease * ease * 8;
        const world = {
            x: pos.x + rx * localX + fx * localY,
            y: pos.y + ry * localX + fy * localY,
        };
        const v = worldToView(cam, world);
        const p = project(width, height, { x: v.x, y: Math.max(0, localZ), z: v.z });
        if (!p) continue;
        const size = Math.max(2, 10 * (1 - progress * 0.5));
        ctx.beginPath();
        ctx.moveTo(p.x - size, p.y);
        ctx.lineTo(p.x + size, p.y);
        ctx.moveTo(p.x, p.y - size * 0.6);
        ctx.lineTo(p.x, p.y + size * 0.6);
        ctx.stroke();
        // short trailing edge
        const trail = project(width, height, {
            x: v.x - f.vx * 2,
            y: Math.max(0, localZ - 0.5),
            z: v.z + 1,
        });
        if (trail) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(trail.x, trail.y);
            ctx.stroke();
        }
    }

    // Early frames: flash the intact tank silhouette collapsing
    if (progress < 0.25) {
        const ghost: Tank = {
            id: "ai",
            pos: { ...pos },
            heading,
            alive: true,
            lives: 0,
            cooldown: 0,
            score: 0,
        };
        ctx.globalAlpha = 1 - progress / 0.25;
        drawTankMesh(ctx, width, height, cam, ghost);
        ctx.globalAlpha = 1;
    }
}

export function renderFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
): void {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    const player = state.tanks.find((t) => t.id === "player")!;
    const enemy = state.tanks.find((t) => t.id === "ai")!;
    const cam: Cam = { pos: { ...player.pos }, heading: player.heading };

    drawHorizon(ctx, width, height, cam.heading);
    drawReticleGround(ctx, width, height);

    const depthItems: { z: number; draw: () => void }[] = [];
    for (const block of state.blocks) {
        const z = worldToView(cam, block.pos).z;
        depthItems.push({
            z,
            draw: () => drawBlock(ctx, width, height, cam, block),
        });
    }
    for (const tank of state.tanks) {
        if (tank.id === "player") continue;
        if (!tank.alive) continue;
        const z = worldToView(cam, tank.pos).z;
        depthItems.push({
            z,
            draw: () => drawTankMesh(ctx, width, height, cam, tank),
        });
    }
    depthItems.sort((a, b) => b.z - a.z);
    for (const item of depthItems) {
        if (item.z > 1) item.draw();
    }

    drawShots(ctx, width, height, cam, state);
    drawExplosion(ctx, width, height, cam, state);
    drawHud(ctx, width, height, state, player, enemy);
    drawRadar(ctx, width, height, state, player);

    if (state.hitStunIn > 0) {
        drawWindshieldCrack(ctx, width, height);
    }

    // Title: full black menu
    if (state.phase === "title") {
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = COLOR;
        ctx.textAlign = "center";
        ctx.font = "bold 42px monospace";
        ctx.fillText("BATTLEZONE", width / 2, height * 0.38);
        ctx.font = "16px monospace";
        ctx.fillText("1 PLAYER  +  1 COMPUTER", width / 2, height * 0.48);
        ctx.fillText("WASD / ARROWS  MOVE    SPACE  FIRE", width / 2, height * 0.55);
        ctx.fillText("PRESS ENTER TO START", width / 2, height * 0.66);
        return;
    }

    // Win: keep last view; show Victory after explosion finishes
    if (state.phase === "win") {
        ctx.fillStyle = COLOR;
        ctx.textAlign = "center";
        if (state.explosionIn > 0) {
            ctx.font = "18px monospace";
            ctx.fillText("ENEMY DESTROYED", width / 2, height * 0.16);
        } else {
            ctx.font = "bold 48px monospace";
            ctx.fillText("Victory!", width / 2, height * 0.4);
            ctx.font = "16px monospace";
            ctx.fillText("PRESS ENTER TO PLAY AGAIN", width / 2, height * 0.52);
        }
        return;
    }

    // Lose: after hit-stun, keep cracked/last view with message (not full title wipe)
    if (state.phase === "lose") {
        if (state.hitStunIn > 0) return;
        ctx.fillStyle = COLOR;
        ctx.textAlign = "center";
        ctx.font = "bold 36px monospace";
        ctx.fillText("MISSION FAILED", width / 2, height * 0.4);
        ctx.font = "16px monospace";
        ctx.fillText("PRESS ENTER TO PLAY AGAIN", width / 2, height * 0.52);
    }
}
