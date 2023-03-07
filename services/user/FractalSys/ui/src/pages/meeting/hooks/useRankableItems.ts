import { useEffect, useState } from "react";

import { UniqueIdentifier } from "@dnd-kit/core";

import { Items } from "components/ranking";
import { useUser } from "hooks";
import { actions, useGlobalStore } from "store";

import { P2PComms, RankUpdate } from "../helpers";
import { ParticipantType, UserData } from "../types";

const initialItems: Items = {
    ranked: [],
    unranked: [],
};

const isRankUpdate = (data: RankUpdate | Items): data is RankUpdate =>
    "ranked" in data && "unranked" in data;

const isNotIncluded =
    (idsToDrop: UniqueIdentifier[]) => (user: UniqueIdentifier | UserData) => {
        const identifier = (user as UserData).participantId || (user as string);
        return !idsToDrop.includes(identifier);
    };

export const useRankableItems = (remotePeers: ParticipantType[]) => {
    const { user } = useUser();
    // NOTE: only the local user's Rank info is stored in the globalStore
    //   Remote Rank orders are held in rankableItemValues
    const { dispatch } = useGlobalStore();

    const [rankableItemValues, setRankableItemValues] =
        useState<Items>(initialItems);

    // We must track user data separate from peer data. The latter can disappear at any moment,
    // but we must gracefully update the state when it does.
    const [rankableItemData, setRankableItemData] = useState<UserData[]>([]);

    useEffect(() => {
        if (isRankUpdate(rankableItemValues)) {
            P2PComms.broadcastRanks(rankableItemValues);
            dispatch(actions.newRankOrder("me", rankableItemValues));
        } else {
            throw new Error(
                `Unrecognised type in rankableItemValues ${rankableItemValues}`
            );
        }
    }, [rankableItemValues]);

    // add self to unranked list
    useEffect(() => {
        if (!user) {
            setRankableItemValues(initialItems);
            setRankableItemData([]);
        } else {
            setRankableItemValues((items) => ({
                ...items,
                unranked: [...items.unranked, user.participantId],
            }));
        }
    }, [user?.participantId]);

    const listedParticipantIds = [
        ...rankableItemValues.ranked,
        ...rankableItemValues.unranked,
    ];
    const remoteParticipants = remotePeers
        .map((rp) => rp.peerUserData)
        .filter((ud) => !!ud.name)
        .filter(Boolean) as UserData[];

    // add or remove others from list
    useEffect(() => {
        if (!user) return;

        // only consider peers with UserData
        const connectedPeerIds = remoteParticipants
            .filter(Boolean)
            .filter((participant) => participant.name)
            .map((participant): UniqueIdentifier => participant.participantId);
        const newlyJoinedParticipantIds = connectedPeerIds.filter(
            isNotIncluded(listedParticipantIds)
        );
        const newlyJoinedParticipantNames = remoteParticipants
            .filter(isNotIncluded(listedParticipantIds))
            .map((p) => p.name);

        const staleParticipantIds = listedParticipantIds
            .filter((id) => id !== user.participantId)
            .filter(isNotIncluded(connectedPeerIds));

        const newlyJoinedParticipants = remoteParticipants.filter(
            (participant) =>
                newlyJoinedParticipantIds.includes(participant.participantId)
        );
        const noUpdatesRequired =
            newlyJoinedParticipantIds.length + staleParticipantIds.length === 0;

        if (noUpdatesRequired) return;

        setRankableItemData((data) =>
            [...data, ...newlyJoinedParticipants].filter(
                isNotIncluded(staleParticipantIds)
            )
        );

        setRankableItemValues((items) => ({
            ranked: items.ranked.filter(isNotIncluded(staleParticipantIds)),
            unranked: [
                ...items.unranked,
                ...newlyJoinedParticipantNames,
            ].filter(isNotIncluded(staleParticipantIds)),
        }));
    }, [remoteParticipants.length, user?.participantId]);

    return {
        rankableItemValues,
        rankableItemData: user ? [...rankableItemData, user] : rankableItemData,
        setRankableItemValues,
    };
};

export default {
    useRankableItems,
};
