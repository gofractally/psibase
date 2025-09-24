import { boot } from "wasm-transpiled";

import { BootState, PackageInfo } from "@/types";

import { queryClient } from "../main";
import { chain } from "./chainEndpoints";
import { exportKeyToPEM } from "./keys";
import { queryKeys } from "./queryKeys";

type BootChainParams = {
    packages: PackageInfo[];
    producerName: string;
    blockSigningPubKey: CryptoKey | undefined;
    txSigningPubKeyPem: string | undefined;
    compression: number;
    onProgressUpdate: (state: BootState) => void;
};

export const bootChain = async ({
    packages,
    producerName,
    blockSigningPubKey,
    txSigningPubKeyPem,
    compression,
    onProgressUpdate,
}: BootChainParams): Promise<void> => {
    try {
        try {
            await chain.extendConfig({
                producer: producerName,
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.config });
        } catch {
            onProgressUpdate("Failed to set producer name");
            return;
        }

        const fetchedPackages: ArrayBuffer[] = await chain.getPackages(
            packages.map((pack) => pack.file),
        );
        const packageBuffers = fetchedPackages.map(
            (buf) => new Uint8Array(buf),
        );

        let blockSigningPubKeyPem: string | undefined;
        // let txSigningPubKeyPem: string | undefined;
        try {
            if (blockSigningPubKey) {
                blockSigningPubKeyPem = await exportKeyToPEM(
                    blockSigningPubKey,
                    "PUBLIC KEY",
                );
            }
            // if (txSigningPubKey) {
            //     txSigningPubKeyPem = await exportKeyToPEM(
            //         txSigningPubKey,
            //         "PUBLIC KEY",
            //     );
            // }
        } catch {
            onProgressUpdate(
                "Failed to export public key to PEM format during boot",
            );
            return;
        }

        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.

        const [boot_transaction, transactions, txlabels] =
            boot.bootTransactions(
                producerName,
                packageBuffers,
                blockSigningPubKeyPem,
                txSigningPubKeyPem,
                compression,
            );

        const labels = ["Initializing chain", ...txlabels];

        let i = 1;
        onProgressUpdate(["push", 0, 1, labels]);
        const trace = await chain.pushArrayBufferBoot(boot_transaction.buffer);
        if (trace.error) {
            onProgressUpdate(trace);
            console.error(trace.error);
            return;
        }
        i++;

        for (const [t, completed, started] of transactions) {
            onProgressUpdate(["push", completed + 1, started + 1, labels]);
            const trace = await chain.pushArrayBufferTransaction(t.buffer);
            if (trace.error) {
                onProgressUpdate(trace);
                return;
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            i++;
        }
        onProgressUpdate(["push", labels.length, labels.length, labels]);
        onProgressUpdate({ type: "BootComplete", success: true });
    } catch (e) {
        onProgressUpdate({ type: "BootComplete", success: false });
        console.error(e);
    }
};
