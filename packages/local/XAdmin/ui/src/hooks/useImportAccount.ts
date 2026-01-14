import { useMutation } from "@tanstack/react-query";
import z from "zod";

import { queryKeys } from "@/lib/queryKeys";

const zCredentialSchema = z.object({
    account: z.string(),
    key: z.string(),
});

type ImportKeyParams = {
    privateKey?: string;
    account: string;
};

export const useImportAccount = () =>
    useMutation<void, Error, ImportKeyParams>({
        mutationKey: queryKeys.importKey,
        mutationFn: async (data) => {
            const { privateKey, account } = data;

            // supervisor is only available after the chain boots
            const { getSupervisor } = await import("@psibase/common-lib");
            const supervisor = getSupervisor();

            const credential = { account, key: privateKey };
            const validatedCredential = zCredentialSchema.parse(credential);

            await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "prompt",
                method: "importExisting",
                params: [[validatedCredential]],
            });
        },
    });
