import { useEffect, useRef } from "react";

import { computeAiInput } from "./game/ai";
import {
    attachKeyboard,
    createKeyBits,
    inputFromKeys,
} from "./game/input";
import { renderFrame } from "./game/render";
import { stepGame } from "./game/sim";
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
        const state = createInitialState();

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
            if (e.code !== "Enter") return;
            e.preventDefault();
            if (state.phase === "title" || state.phase === "win" || state.phase === "lose") {
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
            const aiInput = computeAiInput(state);
            stepGame(state, playerInput, aiInput, dt);
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
                background: "#001100",
                cursor: "none",
            }}
        />
    );
}
