import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import {
    LineOfCreditNode,
    fetchOpenLinesOfCredit,
} from "@/apps/tokens/lib/graphql/ui";
import { Quantity } from "@/apps/tokens/lib/quantity";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

export interface LineOfCredit {
    balance: Quantity;
    creditor: z.infer<typeof Account>;
    debitor: z.infer<typeof Account>;
}

interface Output {
    credits: LineOfCredit[];
    debits: LineOfCredit[];
}

export const useUserLinesOfCredit = (
    username: z.infer<typeof Account> | undefined | null,
) => {
    return useQuery<Output>({
        queryKey: QueryKey.userLinesOfCredit(username),
        enabled: !!username,
        queryFn: async () => {
            console.log("USERNAME:", username);
            const res = await fetchOpenLinesOfCredit(Account.parse(username));

            const transformLOC = (loc: LineOfCreditNode): LineOfCredit => {
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
                };
            };

            const credits: LineOfCredit[] = res.credits.map(transformLOC);
            const debits: LineOfCredit[] = res.debits.map(transformLOC);

            return { credits, debits };
        },
    });
};
