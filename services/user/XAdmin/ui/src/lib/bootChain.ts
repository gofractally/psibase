import { boot } from "wasm-transpiled";

import { BootState, PackageInfo } from "@/types";

import { chain } from "./chainEndpoints";
import { exportKeyToPEM } from "./keys";
import { queryKeys } from "./queryKeys";
import { queryClient } from "../main";

type BootChainParams = {
    packages: PackageInfo[];
    producerName: string;
    blockSigningPubKey: CryptoKey | undefined;
    txSigningPubKey: CryptoKey | undefined;
    compression: number;
    onProgressUpdate: (state: BootState) => void;
};

export const bootChain = async ({
    packages,
    producerName,
    blockSigningPubKey,
    txSigningPubKey,
    compression,
    onProgressUpdate,
}: BootChainParams): Promise<void> => {
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
        const packageBuffers = fetchedPackages.map(
            (buf) => new Uint8Array(buf)
        );

        let blockSigningPubKeyPem: string | undefined;
        let txSigningPubKeyPem: string | undefined;
        try {
            if (blockSigningPubKey) {
                blockSigningPubKeyPem = await exportKeyToPEM(
                    blockSigningPubKey,
                    "PUBLIC KEY"
                );
            }
            if (txSigningPubKey) {
                txSigningPubKeyPem = await exportKeyToPEM(
                    txSigningPubKey,
                    "PUBLIC KEY"
                );
            }
        } catch (e) {
            onProgressUpdate(
                "Failed to export public key to PEM format during boot"
            );
            return;
        }

        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.

        const [boot_transaction, transactions] = boot.bootTransactions(
            producerName,
            packageBuffers,
            blockSigningPubKeyPem,
            txSigningPubKeyPem,
            compression
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
