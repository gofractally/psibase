import { AlertBannerType } from "components";
import { CastedRanks } from "pages/meeting/helpers";
import { CandidateVoteStatus } from "pages/meeting/helpers/consensus";
import { LocalParticipant } from "pages/meeting/model";
import { ParticipantType } from "pages/meeting/types";

export interface ContextType {
    state: State;
    dispatch: React.Dispatch<Action>;
}

export interface DefaultModalState {
    isOpen: boolean;
    resolver: ((success: boolean) => void) | null;
}

export interface DefaultRankState {
    rawRanks: CastedRanks;
    calculatedRanks?: CandidateVoteStatus[];
    unranked: CandidateVoteStatus[];
}

export type LocalPeer = {
    peer: LocalParticipant | null;
    isMicMuted: boolean;
    isCamMuted: boolean;
};

export type State = {
    alertBanner: AlertBannerType;
    accountMenu: DefaultModalState;
    isNavDrawerOpen: boolean;
    localParticipant: ParticipantType;
    remoteParticipants: ParticipantType[];
    modalExample: DefaultModalState;
    modalCreateAddress: DefaultModalState;
    modalSignup: DefaultModalState;
    modalLogin: DefaultModalState;
    rankState: DefaultRankState;
    user: {
        id: string;
        name: string;
        avatarUrl: string | null;
    } | null;
};

export type Action = { type: ActionType; payload: any };

export enum ActionType {
    ToggleAccountMenu = "TOGGLE_ACCOUNT_MENU",
    ToggleModalCreateAddress = "TOGGLE_MODAL_CREATE_ADDRESS",
    ToggleModalExample = "TOGGLE_MODAL_EXAMPLE",
    ToggleNavDrawer = "TOGGLE_NAV_DRAWER",
    SetAlertBanner = "SET_ALERT_BANNER",
    ToggleModalSignup = "TOGGLE_MODAL_SIGNUP",
    ToggleModalLogin = "TOGGLE_MODAL_LOGIN",
    SetLocalParticipant = "SET_LOCAL_PARTICIPANT",
    SetLocalPeerMicMuted = "SET_LOCAL_PEER_MIC_MUTED",
    SetLocalPeerCamMuted = "SET_LOCAL_PEER_CAM_MUTED",
    SetRemoteParticpant = "SET_REMOTE_PARTICIPANT",
    SetRemoteStream = "SET_REMOTE_STREAM",
    SetRemotePeerUserData = "SET_REMOTE_PEER_USER_DATA",
    AddRemotePeer = "ADD_REMOTE_PEER",
    AddReplaceRemoteParticipantList = "REPLACE_REMOTE_PARTICIPANT_LIST",
    RemoveRemotePeer = "REMOVE_REMOTE_PEER",
    UpdateRemotePeerTracksStatus = "UPDATE_REMOTE_PEER_TRACKS_STATUS",
    SetRemotePeerMicMuted = "SET_REMOTE_PEER_MIC_MUTED",
    SetRemotePeerCamMuted = "SET_REMOTE_PEER_CAM_MUTED",
    SetUser = "SET_USER",
    RemoveVoter = "REMOVE_VOTER",
    SetRank = "SET_RANK",
}

export type DefaultModalResolver = (value: boolean) => void;
export interface DefaultModalToggleArgs {
    display: boolean;
    resolver: DefaultModalResolver | null;
}
