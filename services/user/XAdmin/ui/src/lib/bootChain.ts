import * as wasm from "wasm-psibase";

import { BootState, PackageInfo } from "@/types";

import { chain } from "./chainEndpoints";
import { exportKeyToPEM } from "./keys";
import { queryKeys } from "./queryKeys";
import { queryClient } from "../main";

export const bootChain = async (
    packages: PackageInfo[],
    producerName: string,
    publicKey: CryptoKey | undefined,
    onProgressUpdate: (state: BootState) => void
): Promise<void> => {
    try {
        try {
            await chain.extendConfig({
                producer: producerName,
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.config });
        } catch (e) {
            onProgressUpdate("Failed to set producer name");
            return;
        }

        const fetchedPackages: ArrayBuffer[] = await chain.getPackages(
            packages.map((pack) => pack.file)
        );

        let publicKeyPem: string | undefined;
        try {
            if (publicKey) {
                publicKeyPem = await exportKeyToPEM(publicKey, "PUBLIC KEY");
            }
        } catch (e) {
            onProgressUpdate("Failed to export publicKey to PEM format");
            return;
        }

        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.

        const [boot_transaction, transactions] =
            wasm.js_create_boot_transactions(
                producerName,
                fetchedPackages,
                publicKeyPem,
                4
            );

        let i = 1;
        onProgressUpdate(["push", i, transactions.length + 1]);
        const trace = await chain.pushArrayBufferBoot(boot_transaction.buffer);
        if (trace.error) {
            onProgressUpdate(trace);
            console.error(trace.error);
            return;
        }
        i++;

        for (const t of transactions) {
            onProgressUpdate(["push", i + 1, transactions.length + 1]);
            let trace = await chain.pushArrayBufferTransaction(t.buffer);
            if (trace.error) {
                onProgressUpdate(trace);
                return;
            }
            i++;
        }
        onProgressUpdate({ type: "BootComplete", success: true });
    } catch (e) {
        onProgressUpdate({ type: "BootComplete", success: false });
        console.error(e);
    }
};
