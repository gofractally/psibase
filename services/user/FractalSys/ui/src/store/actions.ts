import { AlertBannerType } from "components";
import { RankUpdate, TrackUpdate } from "pages/meeting/helpers";
import { LocalParticipant } from "pages/meeting/model";
import { ParticipantType, UserData } from "pages/meeting/types";

import * as StoreTypes from "./types";
import { ActionType } from "./types";

export type DefaultModalResolver = (value: boolean) => void;
export interface DefaultModalToggleArgs {
    display: boolean;
    resolver: DefaultModalResolver | null;
}

/**
 * Action: ToggleNavDrawer
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleNavDrawer = () => ({
    type: StoreTypes.ActionType.ToggleNavDrawer,
    payload: {},
});

/**
 * Action: ToggleAccountMenu
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleAccountMenu = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleAccountMenu,
    payload: { isOpen: display, resolver },
});

/**
 * Action: SetAlertBanner
 * @param {AlertBannerType} alertBanner - controls which alert banner is displayed
 * @returns a reducer action
 */
export const setAlertBanner = (alertBanner: AlertBannerType) => ({
    type: ActionType.SetAlertBanner,
    payload: { alertBanner },
});

/**
 * Action: SetLocalParticipant
 * @param {LocalParticipant} localParticipant - The localParticipant object representing the active user video/audio
 * @returns a reducer action
 */
export const setLocalParticipant = (localParticipant?: LocalParticipant) => ({
    type: ActionType.SetLocalParticipant,
    payload: { localParticipant: localParticipant ?? null },
});

/**
 * Action: SetLocalPeerMicMuted
 * @param {boolean} isMicMuted - controls whether the mic is muted for the current user
 * @returns a reducer action
 */
export const setLocalPeerMicMuted = (isMicMuted?: boolean) => ({
    type: ActionType.SetLocalPeerMicMuted,
    payload: { isMicMuted },
});

/**
 * Action: SetLocalPeerCamMuted
 * @param {boolean} isCamMuted - controls whether the camera is on or off for the current user
 * @returns a reducer action
 */
export const setLocalPeerCamMuted = (isCamMuted?: boolean) => ({
    type: ActionType.SetLocalPeerCamMuted,
    payload: { isCamMuted },
});

/**
 * Action: SetRemoteStream
 * @param {string} socketId - socketID of peer this stream belongs to
 * @param {MediaStream} remoteStream - The Stream object representing a remote video stream
 * @returns a reducer action
 */
export const setRemoteStream = (
    socketId: string,
    remoteStream?: MediaStream
) => ({
    type: ActionType.SetRemoteStream,
    payload: { socketId, stream: remoteStream ?? null },
});

/**
 * Action: SetRemotePeerUserData
 * @param {string} socketId - socketID of peer this stream belongs to
 * @param {UserData} remoteUserData - The remoteUserData object representing the remote participant's user data
 * @returns a reducer action
 */
export const setRemotePeerUserData = (
    socketId: string,
    remoteUserData?: UserData
) => ({
    type: ActionType.SetRemotePeerUserData,
    payload: { socketId, userData: remoteUserData ?? null },
});

/**
 * Action: UpdateRemotePeerUserData
 * @param {string} socketId - socketID of peer this stream belongs to
 * @param {TrackUpdate} trackStatus - The TrackUpdate object representing the active user video/audio status
 * @returns a reducer action
 */
export const updateRemotePeerTracksStatus = (
    socketId: string,
    tracksStatus: TrackUpdate
) => ({
    type: ActionType.UpdateRemotePeerTracksStatus,
    payload: { socketId, tracksStatus },
});

/**
 * Action: ReplaceRemoteParticipantList
 * @param {ParticipantType[]} updatedRemoteParticipantList - The updated list of Remote Participants
 * @returns a reducer action
 */
export const replaceRemoteParticipantList = (
    updatedRemoteParticipantList: ParticipantType[]
) => {
    return {
        type: ActionType.AddReplaceRemoteParticipantList,
        payload: { updatedRemoteParticipantList },
    };
};

/**
 * Action: RemoveRemotePeer
 * @param {string} socketId - socketID of peer this stream belongs to
 * @returns a reducer action
 */
export const removeRemotePeer = (socketId: string) => ({
    type: ActionType.RemoveRemotePeer,
    payload: { socketId },
});

/**
 * Action: SetLocalPeerMicMuted
 * @param {string} socketId - socketID of peer this update is from
 * @param {boolean} isMicMuted - controls whether the mic is muted for the current user
 * @returns a reducer action
 */
export const setRemotePeerMicMuted = (
    socketId: string,
    isMicMuted?: boolean
) => ({
    type: ActionType.SetRemotePeerMicMuted,
    payload: { socketId, isMicMuted },
});

/**
 * Action: SetRemotePeerCamMuted
 * @param {string} socketId - socketID of peer this update is from
 * @param {boolean} isCamMuted - controls whether the camera is on or off for the current user
 * @returns a reducer action
 */
export const setRemotePeerCamMuted = (
    socketId: string,
    isCamMuted?: boolean
) => ({
    type: ActionType.SetRemotePeerCamMuted,
    payload: { socketId, isCamMuted },
});
/**
 * Action: DismissAlertBanner
 * @returns a reducer action
 */
export const dismissAlertBanner = () => ({
    type: ActionType.SetAlertBanner,
    payload: { alertBanner: null },
});

/**
 * Action: ToggleModalCreateAddress
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleModalCreateAddress = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalCreateAddress,
    payload: { isOpen: display, resolver },
});

/**
 * Action: ToggleModalExample
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleModalExample = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalExample,
    payload: { isOpen: display, resolver },
});

/**
 * Action: ToggleModalSignup
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleModalSignup = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalSignup,
    payload: { isOpen: display, resolver },
});

/**
 * Action: ToggleModalLogin
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const toggleModalLogin = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalLogin,
    payload: { isOpen: display, resolver },
});

export const newRankOrder = (from: string, rankOrder: RankUpdate) => ({
    type: ActionType.SetRank,
    payload: { from, rankOrder },
});

export const setUser = (
    id?: string,
    name?: string,
    avatarUrl: string | null = null
) => {
    const payload = id ? { id, name, avatarUrl } : null;
    return {
        type: ActionType.SetUser,
        payload,
    };
};

export const removeVoter = (voter: string) => ({
    type: ActionType.RemoveVoter,
    payload: { voter },
});
