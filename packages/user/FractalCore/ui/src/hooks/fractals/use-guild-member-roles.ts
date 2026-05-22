import type { Account } from "@shared/lib/schemas/account";

import { useCurrentUser } from "@shared/hooks/use-current-user";

import { useGuildAccount } from "../use-guild-account";
import { useGuildMembership } from "./use-guild-membership";

export const useGuildMemberRoles = (guild?: Account) => {
    const focusedGuild = useGuildAccount();
    const guildAccount = guild || focusedGuild;

    const {
        data: currentUser,
        isPending: isPendingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: membership,
        isPending: isPendingMembership,
        error: errorMembership,
    } = useGuildMembership(guildAccount, currentUser);

    if (!currentUser || !membership) {
        return {
            data: undefined,
            isPending: isPendingCurrentUser || isPendingMembership,
            error: errorCurrentUser || errorMembership,
        };
    }

    const isCandidate = membership?.isCandidate;
    const isRep = currentUser === membership?.guild?.rep?.member;
    const isCouncilMember = membership?.guild?.council?.includes(currentUser);

    return {
        data: {
            isCandidate,
            isRep,
            isCouncilMember,
            isGuildAdmin: isCouncilMember || isRep,
        },
        isPending: isPendingCurrentUser || isPendingMembership,
        error: errorCurrentUser || errorMembership,
    };
};
