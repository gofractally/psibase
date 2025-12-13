import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

const CredentialSchema = z.object({
    account: z.string(),
    key: z.string(),
});

export const useImportExisting = (
    options: UseMutationOptions<
        void,
        Error,
        z.infer<typeof CredentialSchema>
    > = {},
) => {
    return useMutation({
        mutationFn: async (credential: z.infer<typeof CredentialSchema>) => {
            const validatedCredential = CredentialSchema.parse(credential);
            await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "prompt",
                method: "importExisting",
                params: [[validatedCredential]],
            });
        },
        ...options,
    });
};
