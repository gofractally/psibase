import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/queryKeys";
import { exportKeyToPEM } from "@/lib/keys";

const ImportKeyParams = z.instanceof(CryptoKey);

export const useImportKey = () =>
    useMutation<void, Error, z.infer<typeof ImportKeyParams>>({
        mutationKey: queryKeys.importKey,
        mutationFn: async (data) => {
            const privateKey = ImportKeyParams.parse(data);

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
        },
    });
