import { useEffect, useRef } from "react";

import { computeAllAiInputs } from "./game/ai";
import {
    attachKeyboard,
    createKeyBits,
    inputFromKeys,
} from "./game/input";
import { renderFrame } from "./game/render";
import { stepGame } from "./game/sim";
import {
    DEFAULT_ENEMY_TANKS,
    MAX_ENEMY_TANKS,
    MIN_ENEMY_TANKS,
} from "./game/types";
import { createInitialState, resetMatch } from "./game/world";

export function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const keys = createKeyBits();
        const detachKeys = attachKeyboard(keys);
        const state = createInitialState(DEFAULT_ENEMY_TANKS);

        const onResize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        onResize();
        window.addEventListener("resize", onResize);

        const onKey = (e: KeyboardEvent) => {
            if (state.phase === "title") {
                if (e.code === "ArrowLeft" || e.code === "KeyA") {
                    e.preventDefault();
                    state.enemyCount = Math.max(
                        MIN_ENEMY_TANKS,
                        state.enemyCount - 1,
                    );
                    return;
                }
                if (e.code === "ArrowRight" || e.code === "KeyD") {
                    e.preventDefault();
                    state.enemyCount = Math.min(
                        MAX_ENEMY_TANKS,
                        state.enemyCount + 1,
                    );
                    return;
                }
            }
            if (e.code !== "Enter") return;
            e.preventDefault();
            if (state.phase === "title" || state.phase === "win" || state.phase === "lose") {
                // Wait out the victory explosion before allowing replay
                if (state.phase === "win" && state.explosionIn > 0) return;
                Object.assign(state, resetMatch(state));
            }
        };
        window.addEventListener("keydown", onKey);

        let last = performance.now();
        let raf = 0;
        const frame = (now: number) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;

            const playerInput = inputFromKeys(keys);
            const aiInputs = computeAllAiInputs(state);
            stepGame(state, playerInput, aiInputs, dt);
            renderFrame(ctx, window.innerWidth, window.innerHeight, state);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            detachKeys();
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                display: "block",
                width: "100vw",
                height: "100vh",
                background: "#000000",
                cursor: "none",
            }}
        />
    );
}
