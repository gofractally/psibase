import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

export const zGetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
    })
    .optional();

export const getAccount = async (
    accountName: string,
): Promise<z.infer<typeof zGetAccountReturn>> => {
    try {
        const res = zGetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return res;
    } catch (e) {
        // TODO: read this error, actually throw if there's something wrong, other than being invalid
        console.error(e);
        return undefined;
    }
};
