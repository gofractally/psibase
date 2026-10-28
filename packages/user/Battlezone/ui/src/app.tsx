import type { BanxLockWire, RosterSlot, ServerFrame } from "./net/protocol";

import { useEffect, useRef } from "react";

import { getSupervisor } from "@psibase/common-lib";

import { ensureBanxGameplayAuth, fetchMyBanxAssets } from "./banx/client";
import {
    lockFromWire,
    lockToWire,
    markPairRejected,
    reconcileAgainstPeers,
    settleBanxHit,
    upsertLock,
} from "./banx/sync";
import { pairKey } from "./banx/stakeLock";
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
import { ageBanxFloaters, createInitialState, resetMatch } from "./game/world";
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
        let reconcileGen = 0;
        let banxAuthInFlight = false;

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

        const broadcastBanxStatus = () => {
            if (!realtime?.connected) return;
            const on =
                state.banxEnabled &&
                state.banxAssetId !== null &&
                !!state.banxSymbol;
            realtime.send({
                t: "banxStatus",
                on,
                assetId: on ? state.banxAssetId! : 0,
                units: String(state.banxUnits),
                symbol: on ? state.banxSymbol : "",
            });
        };

        const runReconcile = () => {
            const gen = ++reconcileGen;
            void (async () => {
                try {
                    const outbound = await reconcileAgainstPeers(state);
                    if (gen !== reconcileGen) return;
                    if (!realtime?.connected) return;
                    for (const frame of outbound) {
                        realtime.send(frame);
                    }
                } catch (e) {
                    if (gen !== reconcileGen) return;
                    state.banxStatus =
                        e instanceof Error ? e.message : String(e);
                }
            })();
        };

        const invalidatePairLocks = () => {
            // Proposal changed — drop locks/offers and re-reconcile.
            state.banxLocks = [];
            state.banxPairs = {};
            state.banxActiveOffer = null;
            runReconcile();
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

        const applyIncomingLock = (wire: BanxLockWire) => {
            upsertLock(state, lockFromWire(wire));
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
                    broadcastBanxStatus();
                    runReconcile();
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
                        if (frame.status === "offline") {
                            const { [frame.account]: _, ...rest } =
                                state.banxPeers;
                            state.banxPeers = rest;
                            if (state.localAccount) {
                                const key = pairKey(
                                    state.localAccount,
                                    frame.account,
                                );
                                const { [key]: __, ...pairs } = state.banxPairs;
                                state.banxPairs = pairs;
                                state.banxLocks = state.banxLocks.filter(
                                    (l) =>
                                        pairKey(l.a, l.b) !== key,
                                );
                            }
                        }
                        adoptAvailablePeers();
                        if (frame.status === "online") {
                            broadcastBanxStatus();
                            runReconcile();
                        }
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
                    if (frame.banxLocks?.length) {
                        for (const w of frame.banxLocks) {
                            applyIncomingLock(w);
                        }
                    }
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
                    state.pendingBanxHits = [];
                    state.banxPaidHits = [];
                    break;
                case "error":
                    state.netStatus = `ERR: ${frame.reason}`;
                    break;
                case "banxStatus": {
                    if (frame.from === state.localAccount) break;
                    if (!frame.on) {
                        const { [frame.from]: _, ...rest } = state.banxPeers;
                        state.banxPeers = rest;
                        if (state.localAccount) {
                            const key = pairKey(
                                state.localAccount,
                                frame.from,
                            );
                            const { [key]: __, ...pairs } = state.banxPairs;
                            state.banxPairs = pairs;
                            state.banxLocks = state.banxLocks.filter(
                                (l) => pairKey(l.a, l.b) !== key,
                            );
                            if (
                                state.banxActiveOffer &&
                                pairKey(
                                    state.banxActiveOffer.lowAccount,
                                    state.banxActiveOffer.peerAccount,
                                ) === key
                            ) {
                                state.banxActiveOffer = null;
                            }
                        }
                    } else {
                        state.banxPeers = {
                            ...state.banxPeers,
                            [frame.from]: {
                                account: frame.from,
                                on: true,
                                assetId: frame.assetId,
                                symbol: frame.symbol,
                                units: frame.units,
                            },
                        };
                    }
                    runReconcile();
                    break;
                }
                case "banxOffer": {
                    if (frame.to !== state.localAccount) break;
                    const offer = {
                        lowAccount: frame.to,
                        peerAccount: frame.from,
                        requiredUnits: frame.requiredUnits,
                        requiredAsset: frame.requiredAsset,
                        requiredSymbol: frame.requiredSymbol,
                        matchPeerUnits: frame.matchPeerUnits,
                        matchPeerAsset: frame.matchPeerAsset,
                        matchPeerSymbol: frame.matchPeerSymbol,
                        pendingLock: lockFromWire(frame.lock),
                    };
                    const key = pairKey(frame.from, frame.to);
                    state.banxPairs = {
                        ...state.banxPairs,
                        [key]: { kind: "offer", offer },
                    };
                    state.banxActiveOffer = offer;
                    break;
                }
                case "banxOfferReply": {
                    if (frame.accept && frame.lock) {
                        applyIncomingLock(frame.lock);
                    } else if (state.localAccount) {
                        markPairRejected(state, frame.from, frame.to);
                    }
                    break;
                }
                case "banxLock":
                    applyIncomingLock(frame.lock);
                    break;
                case "banxHit":
                    void settleBanxHit(
                        state,
                        frame.hitId,
                        String(frame.victim),
                        String(frame.shooter),
                    );
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

            try {
                const assets = await fetchMyBanxAssets(user);
                state.banxMyAssets = assets.map((a) => ({
                    id: a.id,
                    symbol: a.symbol,
                }));
                if (assets.length) {
                    state.banxAssetId = assets[0]!.id;
                    state.banxSymbol = assets[0]!.symbol;
                    state.banxStatus = "";
                } else {
                    state.banxStatus = "NO CREDIT LINES — SET UP IN BANX";
                }
            } catch (e) {
                state.banxStatus =
                    e instanceof Error
                        ? `BANX UNAVAILABLE: ${e.message}`
                        : "BANX UNAVAILABLE";
            }

            realtime = new BattlezoneRealtime({
                onFrame: onServerFrame,
                onOpen: () => {
                    state.netStatus = "LIVE";
                    broadcastBanxStatus();
                },
                onClose: () => {
                    state.netStatus = "DISCONNECTED";
                },
                onError: (err) => {
                    state.netStatus = err;
                },
            });
            try {
                await realtime.connect();
            } catch (e) {
                state.netStatus = `WS FAIL: ${e instanceof Error ? e.message : String(e)}`;
            }
        })();

        const cycleCurrency = (dir: number) => {
            const assets = state.banxMyAssets;
            if (!assets.length || !state.banxEnabled) return;
            let idx = assets.findIndex((a) => a.id === state.banxAssetId);
            if (idx < 0) idx = 0;
            idx = (idx + dir + assets.length) % assets.length;
            state.banxAssetId = assets[idx]!.id;
            state.banxSymbol = assets[idx]!.symbol;
            broadcastBanxStatus();
            invalidatePairLocks();
        };

        const adjustUnits = (delta: number) => {
            if (!state.banxEnabled) return;
            state.banxUnits = Math.max(1, Math.min(1_000_000, state.banxUnits + delta));
            broadcastBanxStatus();
            invalidatePairLocks();
        };

        const onKey = (e: KeyboardEvent) => {
            if (state.phase === "title") {
                if (e.code === "KeyB") {
                    e.preventDefault();
                    if (banxAuthInFlight) return;
                    if (!state.banxMyAssets.length) {
                        state.banxStatus =
                            state.banxStatus ||
                            "NO CREDIT LINES — SET UP IN BANX";
                        return;
                    }
                    if (state.banxEnabled) {
                        state.banxEnabled = false;
                        broadcastBanxStatus();
                        invalidatePairLocks();
                        return;
                    }
                    banxAuthInFlight = true;
                    state.banxStatus = "AUTHORIZE BANX…";
                    void (async () => {
                        try {
                            // High trust prompt covers quotePath (Low) + pathPay (High)
                            // so neither peer-reconcile nor hit settlement interrupts play.
                            await ensureBanxGameplayAuth();
                            state.banxEnabled = true;
                            if (
                                state.banxAssetId === null &&
                                state.banxMyAssets[0]
                            ) {
                                state.banxAssetId = state.banxMyAssets[0].id;
                                state.banxSymbol = state.banxMyAssets[0].symbol;
                            }
                            state.banxStatus = "";
                            broadcastBanxStatus();
                            invalidatePairLocks();
                        } catch (err) {
                            state.banxEnabled = false;
                            state.banxStatus =
                                err instanceof Error
                                    ? `BANX AUTH: ${err.message}`
                                    : "BANX AUTH DENIED";
                            broadcastBanxStatus();
                        } finally {
                            banxAuthInFlight = false;
                        }
                    })();
                    return;
                }
                if (state.banxEnabled && state.banxActiveOffer) {
                    if (e.code === "KeyY") {
                        e.preventDefault();
                        const offer = state.banxActiveOffer;
                        const lock = offer.pendingLock;
                        upsertLock(state, lock);
                        // Raise local proposal display to the locked amount.
                        if (state.localAccount === lock.a) {
                            state.banxUnits = Math.max(
                                1,
                                Math.round(Number(lock.aPays)) || state.banxUnits,
                            );
                        } else if (state.localAccount === lock.b) {
                            state.banxUnits = Math.max(
                                1,
                                Math.round(Number(lock.bPays)) || state.banxUnits,
                            );
                        }
                        broadcastBanxStatus();
                        realtime?.send({
                            t: "banxOfferReply",
                            to: offer.peerAccount,
                            accept: true,
                            lock: lockToWire(lock),
                        });
                        realtime?.send({
                            t: "banxLock",
                            lock: lockToWire(lock),
                        });
                        return;
                    }
                    if (e.code === "KeyN") {
                        e.preventDefault();
                        const offer = state.banxActiveOffer;
                        if (state.localAccount) {
                            markPairRejected(
                                state,
                                state.localAccount,
                                offer.peerAccount,
                            );
                        }
                        realtime?.send({
                            t: "banxOfferReply",
                            to: offer.peerAccount,
                            accept: false,
                        });
                        return;
                    }
                }
                if (state.banxEnabled) {
                    if (e.code === "Comma") {
                        e.preventDefault();
                        cycleCurrency(-1);
                        return;
                    }
                    if (e.code === "Period") {
                        e.preventDefault();
                        cycleCurrency(1);
                        return;
                    }
                    if (e.code === "BracketLeft") {
                        e.preventDefault();
                        adjustUnits(-1);
                        return;
                    }
                    if (e.code === "BracketRight") {
                        e.preventDefault();
                        adjustUnits(1);
                        return;
                    }
                }
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
                state.pendingBanxHits = [];
                state.banxPaidHits = [];
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

            // Host ages floaters inside stepGame; remotes must age here.
            if (state.netRole === "remote" && state.phase !== "title") {
                ageBanxFloaters(state, dt);
            }

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

                // Drain Banx hit queue (host): fan out + settle if we are victim.
                if (
                    state.netRole === "host" &&
                    realtime?.connected &&
                    state.pendingBanxHits.length
                ) {
                    const hits = state.pendingBanxHits.splice(0);
                    for (const hit of hits) {
                        const lock = state.banxLocks.find(
                            (l) =>
                                pairKey(l.a, l.b) ===
                                pairKey(hit.victimAccount, hit.shooterAccount),
                        );
                        if (!lock) continue;
                        realtime.send({
                            t: "banxHit",
                            hitId: hit.hitId,
                            victim: hit.victimAccount,
                            shooter: hit.shooterAccount,
                        });
                        void settleBanxHit(
                            state,
                            hit.hitId,
                            hit.victimAccount,
                            hit.shooterAccount,
                        );
                    }
                }

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
