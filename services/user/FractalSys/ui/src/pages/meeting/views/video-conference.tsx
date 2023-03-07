import { useParams } from "react-router-dom";

import { useGlobalStore } from "store";

import { ParticipantType } from "../types";
import { VideoParticipant } from "./video-components";

function deterministicShuffle<T>(items: T[], seed: number): T[] {
    const result = Array.from(items);
    let temp, j;
    for (let i = 0; i < result.length; i++) {
        // Select a "random" position.
        j = ((seed % (i + 1)) + i) % result.length;
        // Swap the current element with the "random" one.
        temp = result[i];
        result[i] = result[j];
        result[j] = temp;
    }
    return result;
}

function sortByNameCallback(p1, p2) {
    if (p1.peerUserData?.name === p2.peerUserData?.name) return 0;
    return p1.peerUserData?.name < p2.peerUserData?.name ? -1 : 1;
}

export const VideoConference = () => {
    const { roomID } = useParams();
    const { state } = useGlobalStore();
    const { localParticipant: localPeerState, remoteParticipants } = state;

    const room = roomID || "placeholderRoomId";
    const allPeers: ParticipantType[] = [localPeerState, ...remoteParticipants];
    const allPeersSorted = deterministicShuffle(
        allPeers.sort(sortByNameCallback),
        room.charCodeAt(0)
    );

    return (
        <div className="grid w-full grid-cols-3 grid-rows-2 text-white">
            {allPeersSorted.map((participant) => (
                <VideoParticipant
                    peer={participant}
                    key={participant.socketId}
                    displayName={participant.peerUserData?.name}
                    isCamMuted={participant.tracks?.isCamMuted}
                    isMicMuted={participant.tracks?.isMicMuted}
                />
            ))}
        </div>
    );
};

export default VideoConference;
