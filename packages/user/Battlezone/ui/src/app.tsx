import type { RosterSlot, ServerFrame } from "./net/protocol";

import { useEffect, useRef } from "react";

import { getSupervisor } from "@psibase/common-lib";

import { computeAllAiInputs } from "./game/ai";
import { attachKeyboard, createKeyBits, inputFromKeys } from "./game/input";
import { renderFrame } from "./game/render";
import { stepGame } from "./game/sim";
import {
    DEFAULT_ENEMY_TANKS,
    type InputState,
    MAX_ENEMY_TANKS,
    MIN_ENEMY_TANKS,
    includeAvailablePeers,
    slotPeerBindings,
    syncEnemySlotModes,
} from "./game/types";
import { createInitialState, resetMatch } from "./game/world";
import { applyRoster, applySnapshot, serializeSnapshot } from "./net/apply";
import { BattlezoneRealtime, ensureLoggedIn } from "./net/realtime";

const SNAPSHOT_HZ = 12;

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
        const remoteInputs = new Map<string, InputState>();
        let lastSnapshot = 0;
        let assignedTankId: string | null = null;
        let realtime: BattlezoneRealtime | null = null;

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

        const beginLocalMatch = (roster?: RosterSlot[]) => {
            Object.assign(state, resetMatch(state));
            if (roster) applyRoster(state, roster);
        };

        /** Lobby host (or anyone, before a lobby exists) may edit seat config. */
        const canEditConfig = () =>
            state.phase === "title" &&
            (!state.lobbyHost || state.lobbyHost === state.localAccount);

        /** Push current seat config if we're already ready (host can update lobby). */
        const pushReadyConfigIfNeeded = () => {
            if (!state.lobbyReady || !realtime?.connected) return;
            const slots = syncEnemySlotModes(
                state.enemySlotModes,
                state.enemyCount,
            );
            state.enemySlotModes = slots;
            realtime.send({
                t: "ready",
                enemyCount: state.enemyCount,
                slots,
            });
        };

        const adoptAvailablePeers = () => {
            if (!canEditConfig()) return;
            const beforeCount = state.enemyCount;
            const beforeModes = state.enemySlotModes.join(",");
            includeAvailablePeers(state);
            if (
                state.enemyCount !== beforeCount ||
                state.enemySlotModes.join(",") !== beforeModes
            ) {
                pushReadyConfigIfNeeded();
            }
        };

        const onServerFrame = (frame: ServerFrame) => {
            switch (frame.t) {
                case "welcome":
                    state.localAccount = frame.user;
                    state.netStatus = "LIVE";
                    break;
                case "presenceSnapshot":
                    state.livePeers = frame.peers
                        .filter((p) => p.account !== state.localAccount)
                        .map((p) => ({
                            account: p.account,
                            online: p.presence === "online",
                        }));
                    adoptAvailablePeers();
                    break;
                case "presence":
                    if (frame.account === state.localAccount) break;
                    {
                        const existing = state.livePeers.find(
                            (p) => p.account === frame.account,
                        );
                        if (existing) {
                            existing.online = frame.status === "online";
                        } else if (frame.status === "online") {
                            state.livePeers.push({
                                account: frame.account,
                                online: true,
                            });
                        }
                        state.livePeers = state.livePeers.filter(
                            (p) => p.online,
                        );
                        adoptAvailablePeers();
                    }
                    break;
                case "lobby": {
                    const anyoneReady = frame.players.some((p) => p.ready);
                    state.lobbyPlayers = frame.players.map((p) => ({
                        account: p.account,
                        ready: p.ready,
                    }));
                    state.lobbyHost = anyoneReady ? frame.host : null;
                    state.lobbyReady = frame.players.some(
                        (p) => p.account === state.localAccount && p.ready,
                    );
                    if (anyoneReady && frame.host !== state.localAccount) {
                        // Non-host sees host's pending match config.
                        state.enemyCount = frame.enemyCount;
                        state.enemySlotModes = syncEnemySlotModes(
                            frame.slots.map((s) =>
                                s === "human" ? "human" : "ai",
                            ),
                            frame.enemyCount,
                        );
                    }
                    break;
                }
                case "matchStarted": {
                    state.enemyCount = frame.enemyCount;
                    state.enemySlotModes = syncEnemySlotModes(
                        state.enemySlotModes,
                        frame.enemyCount,
                    );
                    state.lobbyPlayers = [];
                    state.lobbyHost = null;
                    state.lobbyReady = false;
                    const me = String(state.localAccount ?? "");
                    const hostName = String(frame.host ?? "");
                    // Set role before beginLocalMatch so resetMatch / applyRoster
                    // keep host vs remote (not offline).
                    if (me !== "" && me === hostName) {
                        state.netRole = "host";
                        assignedTankId = "player";
                    } else {
                        state.netRole = "remote";
                        assignedTankId =
                            frame.roster.find(
                                (s) =>
                                    s.tankId !== "player" &&
                                    String(s.account ?? "") === me,
                            )?.tankId ?? null;
                    }
                    state.viewTankId = assignedTankId;
                    beginLocalMatch(frame.roster);
                    if (state.netRole === "remote" && !assignedTankId) {
                        state.message = "SPECTATING — NOT IN MATCH";
                    }
                    break;
                }
                case "roster":
                    applyRoster(state, frame.roster);
                    for (const slot of frame.roster) {
                        if (
                            slot.controller === "ai" &&
                            remoteInputs.has(slot.tankId)
                        ) {
                            remoteInputs.delete(slot.tankId);
                        }
                    }
                    break;
                case "input":
                    if (state.netRole === "host") {
                        remoteInputs.set(frame.tankId, {
                            turn: frame.turn,
                            throttle: frame.throttle,
                            fire: frame.fire,
                        });
                    }
                    break;
                case "stateSnapshot":
                    if (state.netRole === "remote") {
                        applySnapshot(state, frame.state);
                    }
                    break;
                case "matchEnded":
                    state.phase = "title";
                    state.netRole = "offline";
                    state.message = "MATCH ENDED";
                    state.lobbyPlayers = [];
                    state.lobbyHost = null;
                    state.lobbyReady = false;
                    state.viewTankId = null;
                    assignedTankId = null;
                    remoteInputs.clear();
                    break;
                case "error":
                    state.netStatus = `ERR: ${frame.reason}`;
                    break;
            }
        };

        void (async () => {
            const supervisor = getSupervisor();
            state.netStatus = "LOGGING IN…";
            const user = await ensureLoggedIn(supervisor);
            if (!user) {
                state.netStatus = "LOGIN REQUIRED";
                return;
            }
            state.localAccount = user;
            state.netStatus = "CONNECTING…";

            realtime = new BattlezoneRealtime({
                onFrame: onServerFrame,
                onOpen: () => {
                    state.netStatus = "LIVE";
                },
                onClose: () => {
                    state.netStatus = "DISCONNECTED";
                },
                onError: (err) => {
                    state.netStatus = err;
                },
            });
            try {
                await realtime.connect(supervisor);
            } catch (e) {
                state.netStatus = `WS FAIL: ${e instanceof Error ? e.message : String(e)}`;
            }
        })();

        const onKey = (e: KeyboardEvent) => {
            if (state.phase === "title") {
                if (canEditConfig()) {
                    if (e.code === "ArrowLeft" || e.code === "KeyA") {
                        e.preventDefault();
                        state.enemyCount = Math.max(
                            MIN_ENEMY_TANKS,
                            state.enemyCount - 1,
                        );
                        state.enemySlotModes = syncEnemySlotModes(
                            state.enemySlotModes,
                            state.enemyCount,
                        );
                        includeAvailablePeers(state);
                        pushReadyConfigIfNeeded();
                        return;
                    }
                    if (e.code === "ArrowRight" || e.code === "KeyD") {
                        e.preventDefault();
                        state.enemyCount = Math.min(
                            MAX_ENEMY_TANKS,
                            state.enemyCount + 1,
                        );
                        state.enemySlotModes = syncEnemySlotModes(
                            state.enemySlotModes,
                            state.enemyCount,
                        );
                        includeAvailablePeers(state);
                        pushReadyConfigIfNeeded();
                        return;
                    }
                    const digit = /^Digit([1-5])$/.exec(e.code);
                    if (digit) {
                        const slot = Number(digit[1]) - 1;
                        if (slot < state.enemyCount) {
                            e.preventDefault();
                            const modes = [...state.enemySlotModes];
                            if (modes[slot] === "human") {
                                const who = slotPeerBindings(state)[slot];
                                if (who && !state.optedOutPeers.includes(who)) {
                                    state.optedOutPeers = [
                                        ...state.optedOutPeers,
                                        who,
                                    ];
                                }
                                modes[slot] = "ai";
                            } else {
                                modes[slot] = "human";
                                // Re-include the earliest opted-out peer if any.
                                const online = new Set(
                                    state.livePeers
                                        .filter((p) => p.online)
                                        .map((p) => p.account),
                                );
                                const restore = state.optedOutPeers.find((a) =>
                                    online.has(a),
                                );
                                if (restore) {
                                    state.optedOutPeers =
                                        state.optedOutPeers.filter(
                                            (a) => a !== restore,
                                        );
                                }
                            }
                            state.enemySlotModes = modes;
                            includeAvailablePeers(state);
                            pushReadyConfigIfNeeded();
                        }
                        return;
                    }
                }
            }
            if (e.code !== "Enter") return;
            e.preventDefault();
            if (state.phase === "title") {
                if (!state.localAccount || !realtime?.connected) return;
                if (state.lobbyReady) {
                    realtime.send({ t: "unready" });
                    return;
                }
                const slots = syncEnemySlotModes(
                    state.enemySlotModes,
                    state.enemyCount,
                );
                state.enemySlotModes = slots;
                realtime.send({
                    t: "ready",
                    enemyCount: state.enemyCount,
                    slots,
                });
                return;
            }
            if (state.phase === "win" || state.phase === "lose") {
                const localStun =
                    state.hitStunIn > 0 &&
                    state.hitStunVictimId !== null &&
                    state.hitStunVictimId === state.viewTankId;
                if (state.explosionIn > 0 || localStun) return;
                if (realtime?.connected && state.netRole === "host") {
                    realtime.send({ t: "leaveMatch" });
                }
                state.phase = "title";
                state.netRole = "offline";
                state.message = "ENTER TO START";
                state.lobbyPlayers = [];
                state.lobbyHost = null;
                state.lobbyReady = false;
                state.viewTankId = null;
                assignedTankId = null;
                remoteInputs.clear();
            }
        };
        window.addEventListener("keydown", onKey);

        // Drop the x-bzone session as soon as the Battlezone page goes away
        // (navigate to Homepage, close tab, bfcache). Presence is WS-only.
        const dropPresence = () => {
            realtime?.close();
        };
        window.addEventListener("pagehide", dropPresence);
        window.addEventListener("beforeunload", dropPresence);

        let last = performance.now();
        let raf = 0;
        const frame = (now: number) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;

            const playerInput = inputFromKeys(keys);

            if (state.netRole === "remote") {
                // Remotes don't step sim; only send input for assigned tank
                if (
                    assignedTankId &&
                    assignedTankId !== "player" &&
                    realtime?.connected &&
                    state.phase === "playing"
                ) {
                    realtime.send({
                        t: "input",
                        tankId: assignedTankId,
                        turn: playerInput.turn,
                        throttle: playerInput.throttle,
                        fire: playerInput.fire,
                    });
                }
            } else if (
                state.netRole === "host" ||
                state.netRole === "offline"
            ) {
                const aiInputs = computeAllAiInputs(state);
                // Overlay remote human inputs on AI map
                for (const [tankId, input] of remoteInputs) {
                    aiInputs.set(tankId, input);
                }
                // Clear one-shot fire after applying
                for (const [tankId, input] of remoteInputs) {
                    if (input.fire) {
                        remoteInputs.set(tankId, { ...input, fire: false });
                    }
                }
                stepGame(state, playerInput, aiInputs, dt);

                if (
                    state.netRole === "host" &&
                    realtime?.connected &&
                    (state.phase === "playing" ||
                        state.phase === "win" ||
                        state.phase === "lose") &&
                    now - lastSnapshot > 1000 / SNAPSHOT_HZ
                ) {
                    lastSnapshot = now;
                    realtime.send({
                        t: "stateSnapshot",
                        state: serializeSnapshot(state),
                    });
                }
            }

            renderFrame(ctx, window.innerWidth, window.innerHeight, state);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            detachKeys();
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pagehide", dropPresence);
            window.removeEventListener("beforeunload", dropPresence);
            realtime?.close();
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
