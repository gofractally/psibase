import type {
    BanxLockedStake,
    BanxPendingOffer,
    GameState,
} from "../game/types";
import { SHOT_SPEED } from "../game/types";
import type { BanxLockWire } from "../net/protocol";
import { pathPay, quotePath } from "./client";
import {
    amountFor,
    assetFor,
    findLock,
    minReturnForPayer,
    pairKey,
    reconcilePair,
    symbolFor,
    type BanxProposal,
} from "./stakeLock";

function formatBanxLabel(amount: string, symbol: string): string {
    const trimmed = amount.includes(".")
        ? amount.replace(/0+$/, "").replace(/\.$/, "")
        : amount;
    return symbol ? `${trimmed} ${symbol}` : trimmed;
}

/** Spawn a local world-space transfer label flying victim → shooter. */
export function spawnBanxTransfer(
    state: GameState,
    victimAccount: string,
    shooterAccount: string,
    label: string,
): void {
    if (!label) return;
    const fromTank = state.tanks.find((t) => t.account === victimAccount);
    const toTank = state.tanks.find((t) => t.account === shooterAccount);
    if (!fromTank || !toTank) return;
    const dx = toTank.pos.x - fromTank.pos.x;
    const dy = toTank.pos.y - fromTank.pos.y;
    const dist = Math.hypot(dx, dy);
    const duration = Math.max(0.4, Math.min(2.4, dist / SHOT_SPEED));
    state.banxFloaters.push({
        id: state.nextBanxFloaterId++,
        label,
        from: { x: fromTank.pos.x, y: fromTank.pos.y },
        to: { x: toTank.pos.x, y: toTank.pos.y },
        age: 0,
        duration,
    });
}

export function lockFromWire(w: BanxLockWire): BanxLockedStake {
    return {
        a: String(w.a),
        b: String(w.b),
        aPays: String(w.aPays),
        aAsset: Number(w.aAsset),
        aSymbol: String(w.aSymbol),
        bPays: String(w.bPays),
        bAsset: Number(w.bAsset),
        bSymbol: String(w.bSymbol),
        aMinReturn: String(w.aMinReturn),
        bMinReturn: String(w.bMinReturn),
    };
}

export function lockToWire(l: BanxLockedStake): BanxLockWire {
    return {
        a: l.a,
        b: l.b,
        aPays: l.aPays,
        aAsset: l.aAsset,
        aSymbol: l.aSymbol,
        bPays: l.bPays,
        bAsset: l.bAsset,
        bSymbol: l.bSymbol,
        aMinReturn: l.aMinReturn,
        bMinReturn: l.bMinReturn,
    };
}

export function upsertLock(state: GameState, lock: BanxLockedStake): void {
    const key = pairKey(lock.a, lock.b);
    state.banxLocks = [
        ...state.banxLocks.filter((l) => pairKey(l.a, l.b) !== key),
        lock,
    ];
    state.banxPairs = {
        ...state.banxPairs,
        [key]: { kind: "locked", lock },
    };
    if (
        state.banxActiveOffer &&
        pairKey(state.banxActiveOffer.lowAccount, state.banxActiveOffer.peerAccount) ===
            key
    ) {
        state.banxActiveOffer = null;
    }
}

export function markPairRejected(state: GameState, a: string, b: string): void {
    const key = pairKey(a, b);
    state.banxLocks = state.banxLocks.filter((l) => pairKey(l.a, l.b) !== key);
    state.banxPairs = { ...state.banxPairs, [key]: { kind: "rejected" } };
    if (
        state.banxActiveOffer &&
        pairKey(state.banxActiveOffer.lowAccount, state.banxActiveOffer.peerAccount) ===
            key
    ) {
        state.banxActiveOffer = null;
    }
}

export function localProposal(state: GameState): BanxProposal | null {
    if (
        !state.banxEnabled ||
        !state.localAccount ||
        state.banxAssetId === null ||
        !state.banxSymbol
    ) {
        return null;
    }
    return {
        account: state.localAccount,
        assetId: state.banxAssetId,
        symbol: state.banxSymbol,
        units: String(state.banxUnits),
    };
}

export type BanxOutbound =
    | {
          t: "banxOffer";
          to: string;
          requiredUnits: string;
          requiredAsset: number;
          requiredSymbol: string;
          matchPeerUnits: string;
          matchPeerAsset: number;
          matchPeerSymbol: string;
          lock: BanxLockWire;
      }
    | { t: "banxLock"; lock: BanxLockWire };

/**
 * Reconcile local proposal against every Banx-on peer. Returns frames to send
 * (offers we initiate as the high side, or locks when already equal).
 */
export async function reconcileAgainstPeers(
    state: GameState,
): Promise<BanxOutbound[]> {
    const me = localProposal(state);
    const outbound: BanxOutbound[] = [];
    if (!me) {
        state.banxActiveOffer = null;
        return outbound;
    }

    for (const peer of Object.values(state.banxPeers)) {
        if (!peer.on || peer.account === me.account) continue;
        const key = pairKey(me.account, peer.account);
        const existing = state.banxPairs[key];
        if (existing?.kind === "rejected") continue;

        state.banxPairs = { ...state.banxPairs, [key]: { kind: "pending" } };
        const result = await reconcilePair(me, {
            account: peer.account,
            assetId: peer.assetId,
            symbol: peer.symbol,
            units: peer.units,
        });

        if (result.status === "locked") {
            upsertLock(state, result.lock);
            outbound.push({ t: "banxLock", lock: lockToWire(result.lock) });
        } else if (result.status === "offer") {
            const offer = result.offer;
            state.banxPairs = {
                ...state.banxPairs,
                [key]: { kind: "offer", offer },
            };
            if (offer.lowAccount === me.account) {
                state.banxActiveOffer = offer as BanxPendingOffer;
            } else {
                // We are the high side — send offer to the low peer.
                if (state.banxActiveOffer?.peerAccount === peer.account) {
                    state.banxActiveOffer = null;
                }
                outbound.push({
                    t: "banxOffer",
                    to: offer.lowAccount,
                    requiredUnits: offer.requiredUnits,
                    requiredAsset: offer.requiredAsset,
                    requiredSymbol: offer.requiredSymbol,
                    matchPeerUnits: offer.matchPeerUnits,
                    matchPeerAsset: offer.matchPeerAsset,
                    matchPeerSymbol: offer.matchPeerSymbol,
                    lock: lockToWire(offer.pendingLock),
                });
            }
        } else if (result.status === "noPath") {
            state.banxPairs = {
                ...state.banxPairs,
                [key]: { kind: "noPath", reason: result.reason },
            };
            if (
                state.banxActiveOffer &&
                pairKey(state.banxActiveOffer.lowAccount, state.banxActiveOffer.peerAccount) ===
                    key
            ) {
                state.banxActiveOffer = null;
            }
        } else {
            state.banxPairs = {
                ...state.banxPairs,
                [key]: { kind: "noPath", reason: result.reason },
            };
        }
    }
    return outbound;
}

export async function settleBanxHit(
    state: GameState,
    hitId: number,
    victim: string,
    shooter: string,
): Promise<string | null> {
    const me = state.localAccount;
    if (!me) return null;
    if (state.banxPaidHits.includes(hitId)) return null;

    const lock = findLock(state.banxLocks, victim, shooter);
    if (!lock) return "no Banx lock for pair";

    // Shooter: transfer floater only (victim alone submits pathPay).
    if (me === shooter && me !== victim) {
        state.banxPaidHits = [...state.banxPaidHits, hitId];
        const recv = amountFor(lock, shooter);
        const sym = symbolFor(lock, shooter) ?? "";
        if (recv) {
            spawnBanxTransfer(
                state,
                victim,
                shooter,
                formatBanxLabel(recv, sym),
            );
        }
        return null;
    }

    if (me !== victim) return null;
    state.banxPaidHits = [...state.banxPaidHits, hitId];

    const payAmount = amountFor(lock, victim);
    const fromAsset = assetFor(lock, victim);
    const toAsset = assetFor(lock, shooter);
    const frozenMin = minReturnForPayer(lock, victim);
    if (!payAmount || fromAsset === null || toAsset === null) {
        return "bad lock";
    }

    const sym = symbolFor(lock, victim) ?? "";
    // Spawn immediately so the transfer flies with the hit, not after pathPay.
    spawnBanxTransfer(
        state,
        victim,
        shooter,
        formatBanxLabel(payAmount, sym),
    );

    try {
        const quote = await quotePath({
            fromAccount: victim,
            toAccount: shooter,
            amount: payAmount,
            fromAsset,
            toAsset,
            exactOut: false,
        });
        await pathPay({
            hops: quote.hops,
            amount: payAmount,
            minReturn: frozenMin ?? quote.minReturn,
            requestId: 0,
        });
        return null;
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        state.banxFlash = `PAY FAIL: ${reason}`;
        return reason;
    }
}
