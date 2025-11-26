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
}

interface Output {
    counterParty: z.infer<typeof zAccount>;
    credit: LineOfCredit | undefined;
    debit: LineOfCredit | undefined;
}

export const useUserLinesOfCredit = (
    username: z.infer<typeof zAccount> | undefined | null,
) => {
    return useQuery<Output[]>({
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
                };
            };

            // TODO: remove credits and debits
            const credits: LineOfCredit[] = res.map(transformLOC);
            const debits: LineOfCredit[] = res.map(transformLOC);

            const creditCounterParties = credits.map(
                (credit) => credit.debitor,
            );
            const debitCounterParties = debits.map((debit) => debit.creditor);
            const counterParties = new Set([
                ...creditCounterParties,
                ...debitCounterParties,
            ]);
            console.info("Counter parties:", counterParties);
            const pendingTransactions = Array.from(counterParties).map(
                (counterParty) => {
                    const credit = credits.find(
                        (credit) => credit.debitor === counterParty,
                    );
                    const debit = debits.find(
                        (debit) => debit.creditor === counterParty,
                    );
                    return {
                        counterParty,
                        credit,
                        debit,
                    };
                },
            );
            console.info("Pending transactions:", pendingTransactions);

            return pendingTransactions;
        },
    });
};
