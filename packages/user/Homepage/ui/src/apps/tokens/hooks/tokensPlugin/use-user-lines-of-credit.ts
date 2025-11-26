import {
    SharedBalNode,
    fetchOpenLinesOfCredit,
} from "@/apps/tokens/lib/graphql/ui";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { Quantity } from "@shared/lib/quantity";

export interface LineOfCredit {
    balance: Quantity;
    creditor: z.infer<typeof zAccount>;
    debitor: z.infer<typeof zAccount>;
    id: number;
    label: string;
}

export const useUserLinesOfCredit = (
    username: z.infer<typeof zAccount> | undefined | null,
) => {
    return useQuery<LineOfCredit[]>({
        queryKey: QueryKey.userLinesOfCredit(username),
        enabled: !!username,
        queryFn: async () => {
            const res = await fetchOpenLinesOfCredit(zAccount.parse(username));
            const transformLOC = (loc: SharedBalNode): LineOfCredit => {
                const quan = new Quantity(
                    loc.balance,
                    loc.token.precision,
                    loc.token.id,
                    loc.token.symbol,
                );

                return {
                    balance: quan,
                    creditor: loc.creditor,
                    debitor: loc.debitor,
                    id: loc.token.id,
                    label: loc.token.symbol ?? "ID:" + loc.token.id,
                };
            };

            return res.map(transformLOC);
        },
    });
};
