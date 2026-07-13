import type { MeetPeerHandle } from "../lib/meet-peer-handle";
import type { ClientRealtimeFrame } from "../lib/realtime-protocol";
import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PeerTransportRegistry } from "./l3-peer-registry";
import type { PeerLifecycleCoordinator } from "./peer-lifecycle-coordinator";
import type { PeerMediaPort } from "./peer-media-port";
import type { EnsureReason, PeerState, SendResult } from "./types";

import {
    type SharedMeetPeerOptions,
    createSharedMeetPeer,
} from "../lib/shared-meet-peer";

export type { PeerMediaPort } from "./peer-media-port";

export type PeerCapability = {
    remote: string;
    state: PeerState;
    online: boolean;
};

/**
 * Thin app-facing façade over L1 + peer lifecycle + L3.
 * UI / Meet / chat messaging should use this instead of pairSignaling or
 * raw peerRegistry ensure/kick paths.
 */
export type DeliveryFabric = {
    ensurePeer(remote: string, reason: EnsureReason): Promise<void>;
    sendPeerBytes(remote: string, bytes: Uint8Array): SendResult;
    sendNodeControl(frame: ClientRealtimeFrame): void;
    startPeerMedia(opts: SharedMeetPeerOptions): MeetPeerHandle;
    getPeerCapability(remote: string): PeerCapability;
    getPeerState(remote: string): PeerState;
    disposePeer(remote: string, reason: string): void;
    recoverPeer(remote: string, reason: string): void;
    touchPeer(remote: string): void;
    /** Meet media attach without exposing full PeerTransportRegistry. */
    asPeerMediaPort(): PeerMediaPort;
    notifyRemoteReachable(remote: string, source: EnsureReason): void;
};

export function createDeliveryFabric(deps: {
    realtime: RealtimeTransport;
    peerRegistry: PeerTransportRegistry;
    peerLifecycle: PeerLifecycleCoordinator;
}): DeliveryFabric {
    const mediaPort: PeerMediaPort = {
        ensure: (remote, reason) => deps.peerLifecycle.ensure(remote, reason),
        getChatPeer: (remote) => deps.peerRegistry.getChatPeer(remote),
        holdMeet: (remote) => deps.peerRegistry.holdMeet(remote),
        releaseMeet: (remote) => deps.peerRegistry.releaseMeet(remote),
    };

    return {
        ensurePeer(remote, reason) {
            return deps.peerLifecycle.ensure(remote, reason);
        },

        sendPeerBytes(remote, bytes) {
            return deps.peerRegistry.send(remote, bytes);
        },

        sendNodeControl(frame) {
            deps.realtime.send(frame);
        },

        startPeerMedia(opts) {
            return createSharedMeetPeer(mediaPort, opts);
        },

        getPeerCapability(remote) {
            return {
                remote,
                state: deps.peerRegistry.getState(remote),
                online: deps.realtime.isRecipientOnline(remote),
            };
        },

        getPeerState(remote) {
            return deps.peerRegistry.getState(remote);
        },

        disposePeer(remote, reason) {
            deps.peerRegistry.dispose(remote, reason);
        },

        recoverPeer(remote, reason) {
            deps.peerLifecycle.recoverPeer(remote, reason);
        },

        touchPeer(remote) {
            deps.peerRegistry.touch(remote);
        },

        asPeerMediaPort() {
            return mediaPort;
        },

        notifyRemoteReachable(remote, source) {
            deps.peerLifecycle.notifyRemoteReachable(remote, source);
        },
    };
}
