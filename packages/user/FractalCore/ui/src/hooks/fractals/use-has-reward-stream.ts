import { useQuery } from "@tanstack/react-query";

import { hasRewardStream } from "@/lib/graphql/fractals/has-reward-stream";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";

export const useHasRewardStream = (
    fractal: OptionalAccount,
    owner: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.rewardStream(fractal, owner),
        enabled: !!fractal && !!owner && zAccount.safeParse(owner).success,
        queryFn: () => hasRewardStream(fractal!, zAccount.parse(owner)),
    });
