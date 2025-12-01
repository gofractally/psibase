import {
    SharedBalNode,
    fetchOpenLinesOfCredit,
} from "@/apps/tokens/lib/graphql/ui";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { Quantity } from "@shared/lib/quantity";

export interface PendingBalance {
    balance: Quantity;
    creditor: z.infer<typeof zAccount>;
    debitor: z.infer<typeof zAccount>;
    id: number;
    label: string;
}

export const useUserPendingBalance = (
    username: z.infer<typeof zAccount> | undefined | null,
    tokenId: number | undefined = undefined,
) => {
    return useQuery<PendingBalance[]>({
        queryKey: QueryKey.userLinesOfCredit(username),
        enabled: !!username,
        queryFn: async () => {
            const res = await fetchOpenLinesOfCredit(zAccount.parse(username), tokenId);
            const xformSharedBalNode = (sbn: SharedBalNode): PendingBalance => {
                const quan = new Quantity(
                    sbn.balance,
                    sbn.token.precision,
                    sbn.token.id,
                    sbn.token.symbol,
                );

                return {
                    balance: quan,
                    creditor: sbn.creditor,
                    debitor: sbn.debitor,
                    id: sbn.token.id,
                    label: sbn.token.symbol ?? "ID:" + sbn.token.id,
                };
            };

            return res.map(xformSharedBalNode);
        },
    });
};
