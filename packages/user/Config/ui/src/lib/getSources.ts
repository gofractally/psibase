import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zAccount } from "./zod/Account";

const zPackageSource = z
    .object({
        url: z.string().optional(),
        account: zAccount.optional(),
    })
    .strict();

export type PackageSource = z.infer<typeof zPackageSource>;

export const getSources = async (owner = "root") => {
    const res = await supervisor.functionCall({
        service: "packages",
        intf: "queries",
        method: "getSources",
        params: [owner],
    });

    return zPackageSource.array().parse(res);
};
