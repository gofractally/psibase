import type { Supervisor } from "@psibase/common-lib";

import { z } from "zod";

const zGetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export const doesAccountExist = async (
    accountName: string,
    supervisor: Supervisor,
): Promise<boolean> => {
    try {
        const res = zGetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return Boolean(res?.accountNum);
    } catch (e) {
        // TODO: read this error, actually throw if there's something wrong, other than being invalid
        console.error(e);
        return false;
    }
};
