import React, { useMemo, useReducer } from "react";

import { omit } from "lodash-es";

import { CastedRanks } from "pages/meeting/helpers";
import { parseRanks } from "pages/meeting/helpers/consensus";

import * as StoreTypes from "./types";
import { store } from "./hooks";

const defaultModalState: StoreTypes.DefaultModalState = {
    isOpen: false,
    resolver: null,
};

// TODO: combine localParticipant and remoteParticipants into single array
// perhaps with localParticipant simply being a pointer to a single element in the array
// so we don't need these useless init values here?
const initialState: StoreTypes.State = {
    alertBanner: "set-up-profile",
    accountMenu: defaultModalState,
    isNavDrawerOpen: false,
    localParticipant: {
        participantId: "",
        socketId: "",
        isLocal: true,
        peer: null,
        peerUserData: {
            participantId: "",
            name: "",
            photo: null,
        },
        tracks: {
            isMicMuted: false,
            isCamMuted: false,
        },
    },
    remoteParticipants: [],
    modalExample: defaultModalState,
    modalCreateAddress: defaultModalState,
    modalSignup: defaultModalState,
    modalLogin: defaultModalState,
    rankState: {
        rawRanks: {},
        unranked: [],
        calculatedRanks: undefined,
    },
    user: null,
};

const reducer = (
    state: StoreTypes.State,
    action: StoreTypes.Action
): StoreTypes.State => {
    const { type, payload } = action;
    switch (type) {
        case StoreTypes.ActionType.SetAlertBanner:
            return { ...state, alertBanner: payload.alertBanner };
        case StoreTypes.ActionType.SetLocalParticipant:
            return {
                ...state,
                localParticipant: {
                    ...state.localParticipant,
                    participantId: payload.localParticipant.participantId,
                    peer: payload.localParticipant,
                    stream: payload.localParticipant.localStream,
                    peerUserData: payload.localParticipant.peerUserData,
                },
            };
        case StoreTypes.ActionType.SetLocalPeerMicMuted:
            return {
                ...state,
                localParticipant: {
                    ...state.localParticipant,
                    tracks: {
                        ...state.localParticipant.tracks,
                        isMicMuted: payload.isMicMuted,
                    },
                },
            };
        case StoreTypes.ActionType.SetLocalPeerCamMuted:
            return {
                ...state,
                localParticipant: {
                    ...state.localParticipant,
                    tracks: {
                        ...state.localParticipant.tracks,
                        isCamMuted: payload.isCamMuted,
                    },
                },
            };
        case StoreTypes.ActionType.SetRemotePeerUserData:
            return {
                ...state,
                remoteParticipants: state.remoteParticipants.map((p) => {
                    if (p.socketId === payload.socketId) {
                        return {
                            ...p,
                            peerUserData: payload.userData,
                        };
                    } else {
                        return p;
                    }
                }),
            };
        case StoreTypes.ActionType.SetRemoteStream:
            return {
                ...state,
                remoteParticipants: [
                    ...state.remoteParticipants.map((p) => {
                        if (p.socketId === payload.socketId) {
                            return {
                                ...p,
                                stream: payload.stream,
                            };
                        } else {
                            return p;
                        }
                    }),
                ],
            };
        case StoreTypes.ActionType.UpdateRemotePeerTracksStatus:
            return {
                ...state,
                remoteParticipants: [
                    ...state.remoteParticipants.map((p) => {
                        if (p.socketId === payload.socketId) {
                            return {
                                ...p,
                                tracks: {
                                    ...p.tracks,
                                    ...payload.tracksStatus,
                                },
                            };
                        } else {
                            return p;
                        }
                    }),
                ],
            };
        case StoreTypes.ActionType.AddReplaceRemoteParticipantList:
            return {
                ...state,
                remoteParticipants: payload.updatedRemoteParticipantList,
            };
        case StoreTypes.ActionType.AddRemotePeer:
            return {
                ...state,
                remoteParticipants: [
                    ...state.remoteParticipants,
                    {
                        participantId: payload.participantId,
                        socketId: payload.socketId,
                        isLocal: false,
                        peer: payload.remotePeer,
                        peerUserData: {
                            participantId: payload.participantId,
                            name: "",
                            photo: null,
                        },
                        tracks: {
                            isMicMuted: false,
                            isCamMuted: false,
                        },
                        stream: payload.remotePeer.stream,
                    },
                ],
            };
        case StoreTypes.ActionType.RemoveRemotePeer:
            return {
                ...state,
                remoteParticipants: state.remoteParticipants.filter(
                    (p) => p.socketId !== payload.socketId
                ),
            };
        case StoreTypes.ActionType.SetUser:
            return { ...state, user: payload };
        case StoreTypes.ActionType.ToggleAccountMenu:
            return { ...state, accountMenu: payload };
        case StoreTypes.ActionType.ToggleNavDrawer:
            return { ...state, isNavDrawerOpen: !state.isNavDrawerOpen };
        case StoreTypes.ActionType.ToggleModalExample:
            return { ...state, modalExample: payload };
        case StoreTypes.ActionType.ToggleModalCreateAddress:
            return { ...state, modalCreateAddress: payload };
        case StoreTypes.ActionType.ToggleModalSignup:
            return { ...state, modalSignup: payload };
        case StoreTypes.ActionType.ToggleModalLogin:
            return { ...state, modalLogin: payload };
        case StoreTypes.ActionType.RemoveVoter: {
            const newRankState: CastedRanks = omit(
                state.rankState.rawRanks,
                payload.voter
            );

            const { ranked, unranked } = parseRanks(newRankState);

            console.log("RemoveVoter", { newRankState, ranked, unranked });

            return {
                ...state,
                rankState: {
                    rawRanks: newRankState,
                    calculatedRanks: ranked,
                    unranked,
                },
            };
        }
        case StoreTypes.ActionType.SetRank: {
            const newRankState: CastedRanks = {
                ...state.rankState.rawRanks,
                [payload.from]: payload.rankOrder,
            };
            const { ranked, unranked } = parseRanks(newRankState);

            return {
                ...state,
                rankState: {
                    rawRanks: newRankState,
                    calculatedRanks: ranked,
                    unranked,
                },
            };
        }
        default:
            return state;
    }
};

const Provider = store.Provider;

export const StateProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, dispatch] = useReducer(reducer, initialState);

    // ensure unrelated <WebApp /> rerenders of provider do not cause consumers to rerender
    // https://hswolff.com/blog/how-to-usecontext-with-usereducer/#performance-concerns
    const contextValue = useMemo(() => {
        return { state, dispatch };
    }, [state, dispatch]);

    return <Provider value={contextValue}>{children}</Provider>;
};
