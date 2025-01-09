import { useMutation } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { chain } from "@/lib/chainEndpoints";
import { exportKeyToDER, generateP256Key } from "@/lib/keys";

export const useAddServerKey = () =>
    useMutation<CryptoKey, string>({
        mutationKey: queryKeys.addServerKey,
        mutationFn: async () => {
            const { publicKey, privateKey } = await generateP256Key();
            const privateDER = await exportKeyToDER(privateKey, "PRIVATE KEY");

            // TODO: Remove the next three lines
            const publicDER = await exportKeyToDER(publicKey, "PUBLIC KEY");
            console.log("PRIVATE:", privateDER);
            console.log("PUBLIC:", publicDER);

            chain.addServerKey(privateDER);
            return privateKey;
        },
        onError: (err) => {
            console.log("ERROR:", err);
        },
    });
