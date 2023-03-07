import { P2PComms } from "pages/meeting/helpers";
import { LocalParticipant } from "pages/meeting/model";
import { UserData } from "pages/meeting/types";
import { actions, useGlobalStore } from "store";
import { setLocalParticipant, setLocalPeerMicMuted } from "store/actions";

type useLocalParticipantType = () => useLocalParticipantReturnType;
interface useLocalParticipantReturnType {
    localParticipant: LocalParticipant;
    initLocalParticipant: (localUserData: UserData) => void;
    isCamMuted: boolean;
    isMicMuted: boolean;
    toggleCam: () => void;
    toggleMic: () => void;
    resetMuteButtonState: () => void;
}
export const useLocalParticipant: useLocalParticipantType = () => {
    const { state, dispatch } = useGlobalStore();
    const { localParticipant } = state;
    const {
        peer,
        tracks: { isCamMuted, isMicMuted },
    } = localParticipant;

    const initLocalParticipant = async (user: any) => {
        const _localParticipant = LocalParticipant.get();
        if (
            _localParticipant &&
            !_localParticipant.isReady() &&
            !_localParticipant.isInitializing()
        ) {
            await _localParticipant.init({
                name: user?.name || "",
                participantId: LocalParticipant.get().participantId,
                photo: user?.photo || null,
            });
            dispatch(setLocalParticipant(_localParticipant));
        }
    };

    const disableMic = (disable: boolean) => {
        if (!peer?.localStream) return;
        const audioTracks = peer.localStream.getAudioTracks();

        if (audioTracks.length === 0 && !isMicMuted) {
            dispatch(setLocalPeerMicMuted(true));
            return;
        }

        P2PComms.broadcastTracks({
            isCamMuted,
            isMicMuted: disable,
        });
        audioTracks[0].enabled = !disable;
        dispatch(setLocalPeerMicMuted(disable));
    };

    const disableCam = (disable: boolean) => {
        if (!peer?.localStream) return;
        const videoTracks = peer.localStream.getVideoTracks();

        P2PComms.broadcastTracks({
            isCamMuted: disable,
            isMicMuted,
        });

        videoTracks[0].enabled = !disable;
        dispatch(actions.setLocalPeerCamMuted(disable));
    };

    const toggleMic = () => disableMic(!isMicMuted);
    const toggleCam = () => disableCam(!isCamMuted);

    const resetMuteButtonState = () => {
        disableMic(false);
        disableCam(false);
    };

    return {
        localParticipant: peer || LocalParticipant.get(),
        initLocalParticipant,
        isCamMuted,
        isMicMuted,
        toggleCam,
        toggleMic,
        resetMuteButtonState,
    };
};

export default useLocalParticipant;
