import { useMutation } from "@tanstack/react-query";

import { exportKeyToPEM } from "@/lib/keys";
import { queryKeys } from "@/lib/queryKeys";

type ImportKeyParams = {
    privateKey?: CryptoKey;
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
