import { RemoteParticipants, socket } from "../model";
import { UserData } from "../types";

interface PayloadWrapper<MessagePayload> {
    type: string;
    payload: MessagePayload;
}
export const isType = <T extends MessagePayload>(
    type: PayloadType,
    json: PayloadWrapper<MessagePayload>
): json is PayloadWrapper<T> => json.type === type;

// message types
export type PayloadType = "UPDATE_PEER_DATA" | "UPDATE_RANKS" | "UPDATE_TRACKS";

export const UPDATE_TRACKS = "UPDATE_TRACKS";
export const UPDATE_PEER_DATA = "UPDATE_PEER_DATA";
export const UPDATE_RANKS = "UPDATE_RANKS";

export interface WrappedMessage {
    type: string;
    payload: MessagePayload;
}
export interface TrackUpdate {
    isMicMuted: boolean;
    isCamMuted: boolean;
}

export interface RankUpdate {
    ranked: string[];
    unranked: string[];
}

export interface CastedRanks {
    [peerId: string]: RankUpdate;
}

export type MessagePayload = UserData | RankUpdate | TrackUpdate;

export class P2PComms {
    constructor() {}
    static sendMessage(to: string, message: WrappedMessage) {
        console.info(
            `sendMessage([${to}], message[${JSON.stringify(
                message,
                null,
                2
            )}]).top`
        );
        if (!socket) {
            console.warn(
                `sendMessage(to[${to}], message[${JSON.stringify(
                    message,
                    null,
                    2
                )}]) called before socket was connected. `
            );
            return;
        }
        socket.emit("new message request", {
            to,
            message: JSON.stringify(message),
        });
    }
    // TODO: Would it be relatively simply to move the broadcase/sendMessage functions to the useP2PComms() hook
    //   or perhaps a more aptly name hook in the meantime before moving them to that hook, the plumbing for which doesn't yet exist?
    static broadcastMessage(payload: MessagePayload, type: string) {
        const message: WrappedMessage = {
            payload,
            type,
        };
        RemoteParticipants.get()
            .asArray()
            .map((p) => p.socketId)
            .forEach((peerId) => {
                this.sendMessage(peerId, message);
            });
    }
    static broadcastRanks(payload: RankUpdate) {
        // console.info(
        // "broadcastRanks().top this.socket:",
        // JSON.stringify(socket, null, 2)
        // );
        this.broadcastMessage(payload, UPDATE_RANKS);
    }
    static broadcastTracks(payload: TrackUpdate) {
        this.broadcastMessage(payload, UPDATE_TRACKS);
    }
    static broadcastUserMetaData(newUserInfo: UserData) {
        const message = JSON.stringify(newUserInfo);
        RemoteParticipants.get()
            .asArray()
            .map((p) => p.socketId)
            .forEach((peerID) => {
                const payload = { to: peerID, message };
                if (!socket) {
                    throw new Error(
                        "Can't update UserMetaData before socket has been initialized"
                    );
                }
                console.log(
                    `sending message[${payload.message}] to socket[${payload.to}]`
                );
                const haveExistingConnection = RemoteParticipants.get()
                    .asArray()
                    .map((p) => p.socketId)
                    .includes(payload.to);

                if (!haveExistingConnection) {
                    console.error(
                        "wanted to send to",
                        payload.to,
                        "but have no peer for it",
                        RemoteParticipants.get().asArray()
                    );
                    alert(
                        `No connection to ${payload.to} so cannot send message of ${payload.message}`
                    );
                }
                console.log("EMIT|new message request| payload:", payload);
                socket.emit("new message request", payload);
            });
    }
}

export default {
    P2PComms,
};
