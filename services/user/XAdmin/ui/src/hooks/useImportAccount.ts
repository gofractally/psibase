import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/queryKeys";
import { exportKeyToPEM } from "@/lib/keys";

const ImportKeyParams = z.object({
    privateKey: z.instanceof(CryptoKey).optional(),
    account: z.string(),
});

export const useImportAccount = () =>
    useMutation<void, Error, z.infer<typeof ImportKeyParams>>({
        mutationKey: queryKeys.importKey,
        mutationFn: async (data) => {
            const { privateKey, account } = ImportKeyParams.parse(data);

            // supervisor is only available after the chain boots
            const s = await import("@psibase/common-lib");
            const supervisor = new s.Supervisor();

            if (privateKey) {
                const key = await exportKeyToPEM(privateKey, "PRIVATE KEY");

                void (await supervisor.functionCall({
                    method: "importKey",
                    params: [key],
                    service: "auth-sig",
                    intf: "keyvault",
                }));
            }

            void (await supervisor.functionCall({
                method: "importAccount",
                params: [account],
                service: "accounts",
                intf: "admin",
            }));
        },
    });
