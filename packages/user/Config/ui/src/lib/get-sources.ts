import { z } from "zod";

import { callPluginFunction, config } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

const zPackageSource = z
    .object({
        url: z.string().optional(),
        account: zAccount.optional(),
    })
    .strict();

export type PackageSource = z.infer<typeof zPackageSource>;

export const getSources = async (owner = "root") => {
    const res = await callPluginFunction(config.packaging.getSources, [owner]);

    return zPackageSource.array().parse(res);
};
