import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import {
    Membership,
    getMembership,
} from "@/lib/graphql/fractals/getMembership";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { MemberStatus } from "@/lib/zod/MemberStatus";

export const useMembership = (
    fractal: OptionalAccount,
    user: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.membership(fractal, user),
        enabled: !!(fractal && user),
        queryFn: async () =>
            getMembership(zAccount.parse(fractal), zAccount.parse(user)),
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
