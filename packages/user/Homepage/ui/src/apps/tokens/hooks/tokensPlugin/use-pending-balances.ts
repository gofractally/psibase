import { useQuery } from "@tanstack/react-query";

import {
    SharedBalNode,
    fetchOpenLinesOfCredit,
} from "@/apps/tokens/lib/graphql/ui";

import QueryKey from "@/lib/queryKeys";

import { Quantity } from "@shared/lib/quantity";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export interface PendingBalance {
    balance: Quantity;
    creditor: Account;
    debitor: Account;
    id: number;
    label: string;
}

export const useUserPendingBalance = (
    username: Account | undefined | null,
    tokenId: number | undefined = undefined,
) => {
    return useQuery<PendingBalance[]>({
        queryKey: QueryKey.userLinesOfCredit(username),
        enabled: !!username,
        queryFn: async () => {
            const res = await fetchOpenLinesOfCredit(
                zAccount.parse(username),
                tokenId,
            );
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
