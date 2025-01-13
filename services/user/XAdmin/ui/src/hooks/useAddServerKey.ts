import { useMutation } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { chain } from "@/lib/chainEndpoints";
import { exportKeyToDER, generateP256Key } from "@/lib/keys";

export const useAddServerKey = () =>
    useMutation<CryptoKeyPair, string>({
        mutationKey: queryKeys.addServerKey,
        mutationFn: async () => {
            const keyPair = await generateP256Key();
            const privateDER = await exportKeyToDER(
                keyPair.privateKey,
                "PRIVATE KEY"
            );

            chain.addServerKey(privateDER);
            return keyPair;
        },
        onError: (err) => {
            console.log("ERROR:", err);
        },
    });
