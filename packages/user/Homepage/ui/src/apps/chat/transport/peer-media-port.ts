import type { ChatDataWebRtcPeer } from "../lib/chat-data-webrtc-peer";
import type { EnsureReason } from "./types";

/** Narrow port SharedMeetPeer needs — apps get this via DeliveryFabric. */
export type PeerMediaPort = {
    ensure(remote: string, reason: EnsureReason): Promise<void>;
    getChatPeer(remote: string): ChatDataWebRtcPeer | null;
    holdMeet(remote: string): void;
    releaseMeet(remote: string): void;
};
