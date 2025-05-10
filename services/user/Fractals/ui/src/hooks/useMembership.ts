import { getMembership, MembershipResult } from "@/lib/graphql/fractals/getMembership";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { MemberStatus } from "@/lib/zod/MemberStatus";
import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

export const useMembership = (fractal: OptionalAccount, user: OptionalAccount) =>
  useQuery({
    queryKey: QueryKey.membership(fractal, user),
    enabled: !!(fractal && user),
    queryFn: async () => getMembership(zAccount.parse(fractal), zAccount.parse(user)),
  });



export const setDefaultMembership = (fractal: OptionalAccount, user: OptionalAccount) => {

  queryClient.setQueryData(QueryKey.membership(fractal, user), () => {

    const defaultMember: MembershipResult = {
      fractal: zAccount.parse(fractal),
      account: zAccount.parse(user),
      createdAt: new Date().toISOString(),
      memberStatus: MemberStatus.Citizen,
      reputation: 0,
      rewardBalance: 0,
      rewardStartTime: '',
      rewardWait: 0
    }
    return defaultMember;

  })
}