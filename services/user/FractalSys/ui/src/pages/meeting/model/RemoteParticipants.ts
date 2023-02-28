import { ParticipantType } from "../types";

let remoteParticipantsArray: ParticipantType[] = [];

export class RemoteParticipants {
    static remoteParticipants: RemoteParticipants;
    static get(): RemoteParticipants {
        if (!RemoteParticipants.remoteParticipants) {
            RemoteParticipants.remoteParticipants = new RemoteParticipants();
        }
        return RemoteParticipants.remoteParticipants;
    }
    handleParticipantListUpdate: (
        updatedRemoteParticipantList: ParticipantType[]
    ) => void = () => {};
    // TODO: setup as EventSource?
    setHandlers(
        handleParticipantListUpdate: (
            updatedRemoteParticipantList: ParticipantType[]
        ) => void
    ) {
        this.handleParticipantListUpdate = handleParticipantListUpdate;
    }
    getParticipant(socketId: string) {
        return remoteParticipantsArray.find((p) => p.socketId === socketId);
    }
    // TODO: implements ParticipantType {
    // TODO: *very* bad consistency that this is "addParticipant" but what's passed in is a peer object. Fix this so a participant is passed in
    addParticipant(socketId: string, peer: any) {
        console.info("RemoteParticipants.addParticipant().top");
        remoteParticipantsArray = [
            ...remoteParticipantsArray,
            {
                // participantId,
                socketId,
                isLocal: false,
                peer,
                peerUserData: {
                    // participantId,
                    name: "",
                    photo: null,
                },
                tracks: {
                    isMicMuted: false,
                    isCamMuted: false,
                },
            } as ParticipantType,
        ];
        this.handleParticipantListUpdate(remoteParticipantsArray);
    }
    updateParticipant(
        participantID: string,
        updatedParticipant: ParticipantType
    ) {
        remoteParticipantsArray = remoteParticipantsArray.map((p) => {
            if (p.socketId === participantID) {
                return {
                    ...p,
                    ...updatedParticipant,
                };
            } else {
                return p;
            }
        });
        this.handleParticipantListUpdate(remoteParticipantsArray);
    }
    removeParticipant(peerID: string) {
        remoteParticipantsArray = remoteParticipantsArray.filter(
            (p) => p.socketId != peerID
        );
        this.handleParticipantListUpdate(remoteParticipantsArray);
    }

    // TODO: would be nice to return an iterator here
    asArray() {
        return remoteParticipantsArray;
    }
}

export default {
    RemoteParticipants,
};
