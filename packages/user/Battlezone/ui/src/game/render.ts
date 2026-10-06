import { ARENA, type Block, type GameState, type Tank, type Vec2 } from "./types";

const COLOR = "#33ff66";
const DIM = "#1a8833";

type Cam = {
    pos: Vec2;
    heading: number;
};

function worldToView(cam: Cam, p: Vec2): { x: number; y: number; z: number } {
    const dx = p.x - cam.pos.x;
    const dy = p.y - cam.pos.y;
    const c = Math.cos(cam.heading);
    const s = Math.sin(cam.heading);
    // Camera looks along -world Y when heading=0
    const forward = -dy * c - dx * s;
    const right = dx * c - dy * s;
    return { x: right, y: 0, z: forward };
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

    // Scrolling mountain silhouette
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

    ctx.strokeStyle = COLOR;
    strokePoly(ctx, bottom);
    strokePoly(ctx, top);
    for (let i = 0; i < 4; i++) {
        strokePoly(ctx, [bottom[i], top[i]], false);
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
    // local: x right, y forward (tank frame), z up
    const local = [
        { x: 0, y: -2.8, z: 0.0 },
        { x: -2.0, y: 2.2, z: 0.0 },
        { x: 2.0, y: 2.2, z: 0.0 },
        { x: 0, y: -1.2, z: 2.2 },
        { x: -1.4, y: 1.6, z: 2.0 },
        { x: 1.4, y: 1.6, z: 2.0 },
    ];
    const fx = Math.sin(tank.heading);
    const fy = -Math.cos(tank.heading);
    const rx = Math.cos(tank.heading);
    const ry = Math.sin(tank.heading);
    const pts = local.map((p) => {
        const world = {
            x: tank.pos.x + rx * p.x + fx * p.y,
            y: tank.pos.y + ry * p.x + fy * p.y,
        };
        const v = worldToView(cam, world);
        return project(width, height, { x: v.x, y: p.z, z: v.z });
    });

    ctx.strokeStyle = COLOR;
    // hull base triangle + top
    strokePoly(ctx, [pts[0], pts[1], pts[2]]);
    strokePoly(ctx, [pts[3], pts[4], pts[5]]);
    strokePoly(ctx, [pts[0], pts[3]], false);
    strokePoly(ctx, [pts[1], pts[4]], false);
    strokePoly(ctx, [pts[2], pts[5]], false);
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
        const p = project(width, height, { ...v, y: 1.2 });
        if (!p) continue;
        const size = Math.max(2, 40 / Math.max(v.z, 1));
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
    const size = Math.min(110, width * 0.18);
    const x = width - size - 16;
    const y = height - size - 16;
    ctx.strokeStyle = DIM;
    ctx.strokeRect(x, y, size, size);
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

    for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const r = toRadar(tank.pos);
        ctx.strokeStyle = COLOR;
        ctx.beginPath();
        ctx.arc(r.rx, r.ry, tank.id === "player" ? 3 : 4, 0, Math.PI * 2);
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

    // Crosshair
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

export function renderFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GameState,
): void {
    ctx.fillStyle = "#001100";
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
    drawHud(ctx, width, height, state, player, enemy);
    drawRadar(ctx, width, height, state, player);

    if (state.phase === "title" || state.phase === "win" || state.phase === "lose") {
        ctx.fillStyle = "rgba(0, 20, 0, 0.55)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = COLOR;
        ctx.textAlign = "center";
        ctx.font = "bold 42px monospace";
        ctx.fillText("BATTLEZONE", width / 2, height * 0.38);
        ctx.font = "16px monospace";
        if (state.phase === "title") {
            ctx.fillText("1 PLAYER  +  1 COMPUTER", width / 2, height * 0.48);
            ctx.fillText("WASD / ARROWS  MOVE    SPACE  FIRE", width / 2, height * 0.55);
            ctx.fillText("PRESS ENTER TO START", width / 2, height * 0.66);
        } else {
            ctx.fillText(state.message, width / 2, height * 0.5);
            ctx.fillText("PRESS ENTER TO REPLAY", width / 2, height * 0.6);
        }
    }
}
