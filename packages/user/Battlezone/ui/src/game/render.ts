import {
    ARENA,
    ENEMY_EXPLOSION_DURATION,
    FIRE_RANGE,
    PLAYER_COLOR,
    type Block,
    type GameState,
    type Shot,
    type Tank,
    type Vec2,
} from "./types";

const COLOR = PLAYER_COLOR;
const DIM = "#1a9944";
const BG = "#000000";
const ALERT = "#ff3333";
const ENEMY_FALLBACK = "#33eeff";
/** Obstacle stroke/fill at half the player-green intensity */
const OBSTACLE_STROKE = "#1a7f33";
const OBSTACLE_FILL = "rgba(26, 127, 51, 0.4)";
/** Tank face fill opacity */
const TANK_FILL_ALPHA = 0.3;

function parseHex(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace("#", "");
    const full =
        h.length === 3
            ? h
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToRgba(hex: string, alpha: number): string {
    const { r, g, b } = parseHex(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tankColor(tank: Tank): string {
    return tank.color;
}

function shotColor(state: GameState, shot: Shot): string {
    if (shot.owner === "player") return COLOR;
    const owner = state.tanks.find((t) => t.id === shot.owner);
    return owner?.color ?? ENEMY_FALLBACK;
}

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

function rotate2(p: Vec2, yaw: number): Vec2 {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function obstacleCorner(
    block: Block,
    lx: number,
    ly: number,
): Vec2 {
    const r = rotate2({ x: lx, y: ly }, block.yaw);
    return { x: block.pos.x + r.x, y: block.pos.y + r.y };
}

function projectWorld(
    width: number,
    height: number,
    cam: Cam,
    p: Vec2,
    y: number,
): { x: number; y: number } | null {
    const v = worldToView(cam, p);
    return project(width, height, { ...v, y });
}

function drawObstacleFaces(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    bottom: ({ x: number; y: number } | null)[],
    top: ({ x: number; y: number } | null)[],
): void {
    ctx.fillStyle = OBSTACLE_FILL;
    fillPoly(ctx, top);
    const n = Math.min(bottom.length, top.length);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        fillPoly(ctx, [bottom[i], bottom[j], top[j], top[i]]);
    }
    ctx.strokeStyle = OBSTACLE_STROKE;
    strokePoly(ctx, bottom);
    strokePoly(ctx, top);
    for (let i = 0; i < n; i++) {
        strokePoly(ctx, [bottom[i], top[i]], false);
    }
}

function drawBlock(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    block: Block,
): void {
    const s = block.half;
    const h = s * 1.4 * block.heightScale;

    if (block.shape === "pyramid") {
        const bottom = [
            obstacleCorner(block, -s, -s),
            obstacleCorner(block, s, -s),
            obstacleCorner(block, s, s),
            obstacleCorner(block, -s, s),
        ].map((p) => projectWorld(width, height, cam, p, 0));
        const apex = projectWorld(width, height, cam, block.pos, h * 1.35);
        ctx.fillStyle = OBSTACLE_FILL;
        for (let i = 0; i < 4; i++) {
            fillPoly(ctx, [bottom[i], bottom[(i + 1) % 4], apex]);
        }
        ctx.strokeStyle = OBSTACLE_STROKE;
        strokePoly(ctx, bottom);
        for (let i = 0; i < 4; i++) {
            strokePoly(ctx, [bottom[i], apex], false);
        }
        return;
    }

    if (block.shape === "column") {
        // Octagonal prism (columnar)
        const bottom: ({ x: number; y: number } | null)[] = [];
        const top: ({ x: number; y: number } | null)[] = [];
        const r = s * 0.75;
        const colH = h * 1.6;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const local = { x: Math.cos(a) * r, y: Math.sin(a) * r };
            const world = obstacleCorner(block, local.x, local.y);
            bottom.push(projectWorld(width, height, cam, world, 0));
            top.push(projectWorld(width, height, cam, world, colH));
        }
        drawObstacleFaces(ctx, width, height, cam, bottom, top);
        return;
    }

    if (block.shape === "trapezoid") {
        // Larger base, smaller top (frustum)
        const base = s;
        const topS = s * 0.45;
        const bottom = [
            obstacleCorner(block, -base, -base),
            obstacleCorner(block, base, -base),
            obstacleCorner(block, base, base),
            obstacleCorner(block, -base, base),
        ].map((p) => projectWorld(width, height, cam, p, 0));
        const top = [
            obstacleCorner(block, -topS, -topS),
            obstacleCorner(block, topS, -topS),
            obstacleCorner(block, topS, topS),
            obstacleCorner(block, -topS, topS),
        ].map((p) => projectWorld(width, height, cam, p, h * 1.15));
        drawObstacleFaces(ctx, width, height, cam, bottom, top);
        return;
    }

    if (block.shape === "wedge") {
        // Triangular prism / ramp
        const bottom = [
            obstacleCorner(block, -s, -s),
            obstacleCorner(block, s, -s),
            obstacleCorner(block, s, s),
            obstacleCorner(block, -s, s),
        ].map((p) => projectWorld(width, height, cam, p, 0));
        const top = [
            projectWorld(width, height, cam, obstacleCorner(block, -s, -s), 0.2),
            projectWorld(width, height, cam, obstacleCorner(block, s, -s), 0.2),
            projectWorld(width, height, cam, obstacleCorner(block, s, s), h),
            projectWorld(width, height, cam, obstacleCorner(block, -s, s), h),
        ];
        drawObstacleFaces(ctx, width, height, cam, bottom, top);
        return;
    }

    // Default box
    const bottom = [
        obstacleCorner(block, -s, -s),
        obstacleCorner(block, s, -s),
        obstacleCorner(block, s, s),
        obstacleCorner(block, -s, s),
    ].map((p) => projectWorld(width, height, cam, p, 0));
    const top = [
        obstacleCorner(block, -s, -s),
        obstacleCorner(block, s, -s),
        obstacleCorner(block, s, s),
        obstacleCorner(block, -s, s),
    ].map((p) => projectWorld(width, height, cam, p, h));
    drawObstacleFaces(ctx, width, height, cam, bottom, top);
}

function drawShots(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    state: GameState,
): void {
    for (const shot of state.shots) {
        const v = worldToView(cam, shot.pos);
        const near = shot.owner === "player" ? 0.2 : 0.8;
        if (v.z < near) continue;
        const scale = (height * 0.55) / (v.z * 1.05);
        const p = {
            x: width * 0.5 + v.x * scale,
            y: height * 0.55 - 1.2 * scale,
        };
        // Slightly heavier than a pixel: filled diamond + outline
        const size = Math.max(5, 70 / Math.max(v.z, 0.5));
        const col = shotColor(state, shot);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - size);
        ctx.lineTo(p.x + size * 0.7, p.y);
        ctx.lineTo(p.x, p.y + size);
        ctx.lineTo(p.x - size * 0.7, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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
    fill = false,
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
    if (fill) {
        ctx.fillStyle = hexToRgba(tankColor(tank), TANK_FILL_ALPHA);
        fillPoly(ctx, [c[4], c[5], c[6], c[7]]);
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            fillPoly(ctx, [c[i], c[j], c[j + 4], c[i + 4]]);
        }
    }
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
    ctx.strokeStyle = tankColor(tank);

    // Lower hull / chassis (boxy body) — translucent fill for silhouette
    drawBoxEdges(ctx, width, height, cam, tank, -2.1, 2.1, -2.4, 2.4, 0.0, 1.2, true);
    // Side track sills (extra edges to distinguish from cubes)
    drawBoxEdges(ctx, width, height, cam, tank, -2.4, -1.7, -2.5, 2.5, 0.0, 0.7, true);
    drawBoxEdges(ctx, width, height, cam, tank, 1.7, 2.4, -2.5, 2.5, 0.0, 0.7, true);
    // Turret
    drawBoxEdges(ctx, width, height, cam, tank, -1.2, 1.2, -0.9, 1.3, 1.2, 2.2, true);
    // Gun barrel pointing forward (+Y) — shows facing
    drawBoxEdges(ctx, width, height, cam, tank, -0.25, 0.25, 1.3, 3.6, 1.55, 1.95, true);
    // Front glacis hint: angled line from hull nose
    const noseL = projectLocal(width, height, cam, tank, -1.5, 2.4, 1.2);
    const noseR = projectLocal(width, height, cam, tank, 1.5, 2.4, 1.2);
    const noseTip = projectLocal(width, height, cam, tank, 0, 2.9, 0.5);
    strokePoly(ctx, [noseL, noseTip, noseR], false);
}

function drawRadar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
    player: Tank,
): void {
    // 2× prior size (was min(220, width*0.36))
    const size = Math.min(440, width * 0.72);
    const x = width - size - 16;
    const y = height - size - 16;

    const enemyShots = state.shots.filter((s) => s.owner === "ai");
    const alertBlink =
        state.radarAlertIn > 0 && Math.floor(state.elapsed * 8) % 2 === 0;

    const scale = size / ARENA;
    const toRadar = (p: Vec2) => ({
        rx: x + size / 2 + (p.x - player.pos.x) * scale,
        ry: y + size / 2 + (p.y - player.pos.y) * scale,
    });

    // Opaque backdrop + clip so the 3D landscape never shows through the radar
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.fillStyle = BG;
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size / 2, y + size);
    ctx.moveTo(x, y + size / 2);
    ctx.lineTo(x + size, y + size / 2);
    ctx.stroke();

    ctx.fillStyle = DIM;
    for (const block of state.blocks) {
        const r = toRadar(block.pos);
        const s = block.half * scale * 2;
        ctx.fillRect(r.rx - s / 2, r.ry - s / 2, s, s);
    }

    // Enemy projectiles — match firing tank color; alert border stays red
    for (const shot of enemyShots) {
        const r = toRadar(shot.pos);
        ctx.fillStyle = shotColor(state, shot);
        ctx.beginPath();
        ctx.arc(r.rx, r.ry, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const r = toRadar(tank.pos);
        const col = tankColor(tank);
        if (tank.id === "player") {
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.arc(r.rx, r.ry, 4, 0, Math.PI * 2);
            ctx.stroke();
            const fx = Math.sin(player.heading) * 8;
            const fy = -Math.cos(player.heading) * 8;
            ctx.beginPath();
            ctx.moveTo(r.rx, r.ry);
            ctx.lineTo(r.rx + fx * scale * 8, r.ry + fy * scale * 8);
            ctx.stroke();
        } else {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(r.rx, r.ry, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // Border drawn after clip so it isn't eaten by clipped fills
    ctx.strokeStyle = alertBlink ? ALERT : DIM;
    ctx.lineWidth = alertBlink ? 3 : 1;
    ctx.strokeRect(x, y, size, size);
    ctx.lineWidth = 1;
}

/** Thin square marking a distant enemy; hidden once inside FIRE_RANGE */
function drawEnemyRangeBox(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cam: Cam,
    player: Tank,
    enemy: Tank,
): void {
    if (!enemy.alive) return;
    const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y);
    if (dist <= FIRE_RANGE) return;

    const v = worldToView(cam, enemy.pos);
    if (v.z < 1.5) return;
    const ground = project(width, height, { x: v.x, y: 0, z: v.z });
    const top = project(width, height, { x: v.x, y: 2.4, z: v.z });
    if (!ground || !top) return;

    const halfH = Math.max(10, Math.abs(ground.y - top.y) * 0.85 + 6);
    const halfW = halfH;
    const cx = ground.x;
    const cy = (ground.y + top.y) * 0.5;

    ctx.save();
    ctx.strokeStyle = tankColor(enemy);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    ctx.stroke();
    ctx.restore();
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
    ctx.fillStyle = tankColor(enemy);
    ctx.fillText(`ENEMY ${Math.max(0, enemy.lives)}`, width - 16, 24);

    const cx = width / 2;
    const cy = height * 0.55;
    const arm = 28;
    const gap = 8;
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.lineWidth = 1;

    if (state.message && state.phase !== "win") {
        ctx.fillStyle = COLOR;
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
    const blastColor =
        state.tanks.find((t) => t.id === "ai")?.color ?? ENEMY_FALLBACK;

    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    const rx = Math.cos(heading);
    const ry = Math.sin(heading);

    // Expanding blast rings in world XZ (ground plane)
    ctx.strokeStyle = blastColor;
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
            color: blastColor,
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
    if (state.phase === "playing") {
        drawEnemyRangeBox(ctx, width, height, cam, player, enemy);
    }
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
