import { ConsensusIndication } from "components";

export interface JoinRoomPayload {
    roomID: string;
}

export interface AllUsersPayload {
    usersInRoom: ParticipantType[];
    iceServers: RTCIceServer[];
}

interface Message {
    message: string;
}

export interface FromMessage extends Message {
    from: ParticipantID;
}

export interface ToMessage extends Message {
    to: ParticipantID;
}

export interface CalculatedRank {
    rank: number;
    votesCast: number;
    votesCounted: { [name: string]: number };
    leadingCandidate: string;
    status: ConsensusIndication;
}

declare global {
    interface Window {
        Peer: any;
    }
}

// TODO: Still some standardization and cleanup using this throughout the code for this participantId property
//   (and ensure it's not being used for the socketId property).
export type ParticipantID = string;

export type UserData = {
    participantId: string;
    name: string;
    team?: string;
    photo: string | null;
};
export interface ParticipantType {
    participantId: string;
    socketId: string;
    isLocal: boolean;
    peer: any; // for localParticipant, LocalPeerData
    peerUserData: UserData;
    stream?: MediaStream;
    tracks: {
        isMicMuted: boolean;
        isCamMuted: boolean;
    };
    // TODO: consider such an approach (optional because not a local peer thing)
    // broadcastUserData?: () => {}
    // sendMessage
}
