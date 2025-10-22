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
    counterParty: z.infer<typeof Account>;
    credit: LineOfCredit | undefined;
    debit: LineOfCredit | undefined;
}

export const useUserLinesOfCredit = (
    username: z.infer<typeof Account> | undefined | null,
) => {
    return useQuery<Output[]>({
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

            const creditCounterParties = credits.map(
                (credit) => credit.debitor,
            );
            const debitCounterParties = debits.map((debit) => debit.creditor);
            const counterParties = new Set([
                ...creditCounterParties,
                ...debitCounterParties,
            ]);

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

            return pendingTransactions;
        },
    });
};
