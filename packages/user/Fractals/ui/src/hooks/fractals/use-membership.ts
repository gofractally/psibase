import { useQuery } from "@tanstack/react-query";

import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import {
    type Membership,
    getMembership,
} from "@shared/domains/fractal/lib/graphql/getMembership";
import { MemberStatus } from "@shared/domains/fractal/lib/schemas/MemberStatus";
import { queryClient } from "@shared/lib/query-client";
import { zAccount } from "@shared/lib/schemas/account";

const queryFn = async (fractal: string, user: string) => {
    try {
        return await getMembership(
            zAccount.parse(fractal),
            zAccount.parse(user),
        );
    } catch (error) {
        const message = "Error getting membership";
        console.error(message, error);
        throw new Error(message);
    }
};

export const useMembership = (
    fractal: OptionalAccount,
    user: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.membership(fractal, user),
        enabled: Boolean(fractal && user),
        queryFn: () => queryFn(fractal!, user!),
    });

export const setDefaultMembership = (
    fractal: OptionalAccount,
    user: OptionalAccount,
) => {
    queryClient.setQueryData(QueryKey.membership(fractal, user), () => {
        const defaultMember: Membership = {
            fractal: zAccount.parse(fractal),
            account: zAccount.parse(user),
            createdAt: new Date().toISOString(),
            memberStatus: MemberStatus.Citizen,
        };
        return defaultMember;
    });
};
