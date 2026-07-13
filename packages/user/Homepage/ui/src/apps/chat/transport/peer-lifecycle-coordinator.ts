import type { PeerTransportRegistry } from "./l3-peer-registry";
import type { EnsureReason } from "./types";

import { chatDataRecord } from "../lib/chat-data-debug";
import {
    type RosterRenegotiationCoordinator,
    createRosterRenegotiationCoordinator,
} from "./roster-renegotiation-coordinator";

/**
 * Sole owner of external peer lifecycle *intents* (ensure / kick / recover /
 * resend / retrigger). Callers submit intents here; L3 registry executes.
 *
 * Roster burst coalescing stays in {@link RosterRenegotiationCoordinator};
 * roster actions are bound to this coordinator so all paths log and serialize
 * through one owner.
 */
export type PeerLifecycleCoordinator = {
    ensure(remote: string, reason: EnsureReason): Promise<void>;
    kickNegotiation(remote: string): void;
    resendOffer(remote: string): void;
    retriggerHandshake(remote: string): void;
    recoverPeer(remote: string, reason: string): void;
    notifyRemoteReachable(remote: string, source: EnsureReason): void;
    notifyPairRosterUpdate(remote: string, source: EnsureReason): void;
    notifyJoinBatchIdle(completedPairId: string | undefined): void;
    dispose(): void;
};

export type PeerLifecycleRegistryPort = Pick<
    PeerTransportRegistry,
    | "ensure"
    | "kickNegotiation"
    | "resendOffer"
    | "retriggerHandshake"
    | "recoverPeer"
    | "getRosterSnapshot"
>;

export function createPeerLifecycleCoordinator(deps: {
    localAccount: string;
    registry: PeerLifecycleRegistryPort;
    pairIdForRemote: (remote: string) => string;
    remoteForPairId: (pairId: string) => string | null;
    debounceMs?: number;
}): {
    lifecycle: PeerLifecycleCoordinator;
    roster: RosterRenegotiationCoordinator;
} {
    const registry = deps.registry;

    const ensure = (remote: string, reason: EnsureReason): Promise<void> => {
        chatDataRecord("peer-lifecycle-ensure", { remote, reason });
        return registry.ensure(remote, reason);
    };

    const kickNegotiation = (remote: string): void => {
        chatDataRecord("peer-lifecycle-kick", { remote });
        registry.kickNegotiation(remote);
    };

    const resendOffer = (remote: string): void => {
        chatDataRecord("peer-lifecycle-resend-offer", { remote });
        registry.resendOffer(remote);
    };

    const retriggerHandshake = (remote: string): void => {
        chatDataRecord("peer-lifecycle-retrigger", { remote });
        registry.retriggerHandshake(remote);
    };

    const recoverPeer = (remote: string, reason: string): void => {
        chatDataRecord("peer-lifecycle-recover", { remote, reason });
        registry.recoverPeer(remote, reason);
    };

    const roster = createRosterRenegotiationCoordinator({
        localAccount: deps.localAccount,
        pairIdForRemote: deps.pairIdForRemote,
        remoteForPairId: deps.remoteForPairId,
        getSnapshot: (remote) => registry.getRosterSnapshot(remote),
        debounceMs: deps.debounceMs,
        actions: {
            ensure: (remote, reason) => {
                void ensure(remote, reason);
            },
            resendOffer,
            retriggerHandshake,
            recoverPeer,
        },
    });

    const lifecycle: PeerLifecycleCoordinator = {
        ensure,
        kickNegotiation,
        resendOffer,
        retriggerHandshake,
        recoverPeer,
        notifyRemoteReachable(remote, source) {
            roster.notifyRemoteReachable(remote, source);
        },
        notifyPairRosterUpdate(remote, source) {
            roster.notifyPairRosterUpdate(remote, source);
        },
        notifyJoinBatchIdle(completedPairId) {
            roster.notifyJoinBatchIdle(completedPairId);
        },
        dispose() {
            roster.dispose();
        },
    };

    return { lifecycle, roster };
}
