import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

export const zAccountNameStatus = z.enum(["Available", "Taken", "Invalid"]);
const zGetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export const isAccountAvailable = async (
    accountName: string,
): Promise<z.infer<typeof zAccountNameStatus>> => {
    try {
        const res = zGetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return zAccountNameStatus.parse(res ? "Taken" : "Available");
    } catch (e) {
        // TODO: read this error, actually throw if there's something wrong, other than being invalid
        console.error(e);
        return zAccountNameStatus.parse("Invalid");
    }
};

export const useAccountStatus = (account: string | undefined) =>
    useQuery<z.infer<typeof zAccountNameStatus>>({
        queryKey: QueryKey.userAccount(account),
        queryFn: async () => {
            return isAccountAvailable(zAccount.parse(account));
        },
        staleTime: 10000,
        enabled: !!account,
    });
