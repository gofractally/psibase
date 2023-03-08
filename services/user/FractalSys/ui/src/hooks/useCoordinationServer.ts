import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { useLocalParticipant, useUser } from "hooks";
import { RankUpdate, TrackUpdate } from "pages/meeting/helpers/P2PComms";
import { CoordinationServer, RemoteParticipants } from "pages/meeting/model";
import { ParticipantType } from "pages/meeting/types";
import { useGlobalStore } from "store";
import {
    newRankOrder,
    removeVoter,
    replaceRemoteParticipantList,
    updateRemotePeerTracksStatus,
} from "store/actions";

// TODO: Add types here
export const useCoordinationServer = () => {
    const { roomID } = useParams();
    const { state, dispatch } = useGlobalStore(); // remotePeers are in the store
    const { resetMuteButtonState, localParticipant, initLocalParticipant } =
        useLocalParticipant();
    const { user } = useUser();

    const handleRemoveVoter = (participantId: string) =>
        dispatch(removeVoter(participantId));
    const handleSocketConnect = () => {
        // TODO: Is this right? Do I need the exclamation mark?
        initLocalParticipant(user!);
        resetMuteButtonState();
    };
    const handlerReceiveUpdateTrackStatus = (
        from: string,
        trackStatus: TrackUpdate
    ) => dispatch(updateRemotePeerTracksStatus(from, trackStatus));
    const handleReceiveUpdatedRank = (from: string, newRanks: RankUpdate) =>
        dispatch(newRankOrder(from, newRanks));

    const handleUpdatedRemoteParticipantList = (
        updatedParticipantList: ParticipantType[]
    ) => {
        console.info(
            "handleUpdatedRemoteParticipantList().updating ParticipantList:",
            updatedParticipantList
        );
        dispatch(replaceRemoteParticipantList(updatedParticipantList));
    };

    useEffect(() => {
        if (!roomID || !user) return;

        const cs = new CoordinationServer(roomID, user);
        cs.init();
        cs.setHandlers({
            handleRemoveVoter,
            handleSocketConnect,
            handlerReceiveUpdateTrackStatus,
            handleReceiveUpdatedRank,
        });

        RemoteParticipants.get().setHandlers(
            handleUpdatedRemoteParticipantList
        );
    }, [roomID, user?.name]);

    return {};
};

export default useCoordinationServer;
