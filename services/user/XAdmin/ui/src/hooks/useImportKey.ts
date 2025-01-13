import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/queryKeys";
import { exportKeyToPEM } from "@/lib/keys";

const ImportKeyParams = z.object({
    privateKey: z.instanceof(CryptoKey),
    account: z.string(),
});

export const useImportKey = () =>
    useMutation<void, Error, z.infer<typeof ImportKeyParams>>({
        mutationKey: queryKeys.importKey,
        mutationFn: async (data) => {
            const { privateKey, account } = ImportKeyParams.parse(data);

            const key = await exportKeyToPEM(privateKey, "PRIVATE KEY");

            // supervisor is only available after the chain boots
            const s = await import("@psibase/common-lib");
            const supervisor = new s.Supervisor();

            void (await supervisor.functionCall({
                method: "importKey",
                params: [key],
                service: "auth-sig",
                intf: "keyvault",
            }));

            void (await supervisor.functionCall({
                method: "importAccount",
                params: [account],
                service: "accounts",
                intf: "admin",
            }));
        },
    });
