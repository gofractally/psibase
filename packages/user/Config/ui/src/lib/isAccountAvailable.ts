import { z } from "zod";

import { supervisor } from "@/supervisor";

export const AccountNameStatus = z.enum(["Available", "Taken", "Invalid"]);

const GetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export const isAccountAvailable = async (
    accountName: string,
): Promise<z.infer<typeof AccountNameStatus>> => {
    try {
        const res = GetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return AccountNameStatus.parse(res ? "Taken" : "Available");
    } catch (e) {
        console.error(e);
        return AccountNameStatus.parse("Invalid");
    }
};
