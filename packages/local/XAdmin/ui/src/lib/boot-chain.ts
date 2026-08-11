import { boot } from "wasm-transpiled";

import { BootState, PackageInfo } from "@/types";

import { queryClient } from "@shared/lib/query-client";

import { chain } from "./chain-endpoints";
import { exportKeyToPEM } from "./keys";
import { queryKeys } from "./query-keys";

type BootChainParams = {
    packages: PackageInfo[];
    producerName: string;
    blockSigningPubKey: CryptoKey | undefined;
    txSigningPubKeyPem: string | undefined;
    compression: number;
    onProgressUpdate: (state: BootState) => void;
};

/**
 * Push post-genesis boot transactions.
 *
 * create_boot_transactions requires these to be pushed (and applied) in order:
 * during boot the node pops expected hashes from the front of the boot list.
 * Concurrent in-flight pushes can race sequence assignment and apply out of
 * order, so we wait for each wait_for=applied response before starting the next.
 *
 * The (completed, started) fields from wasm are progress metadata for the
 * multi-step loader only.
 */
async function pushBootTransactions(
    transactions: [Uint8Array, number, number][],
    labels: string[],
    onProgressUpdate: (state: BootState) => void,
): Promise<boolean> {
    for (const [t, completed, started] of transactions) {
        onProgressUpdate(["push", completed + 1, started + 1, labels]);
        const trace = await chain.pushArrayBufferTransaction(t.buffer);
        if (trace.error) {
            onProgressUpdate(trace);
            console.error(trace.error);
            return false;
        }
    }
    return true;
}

export const bootChain = async ({
    packages,
    producerName,
    blockSigningPubKey,
    txSigningPubKeyPem,
    compression,
    onProgressUpdate,
}: BootChainParams): Promise<void> => {
    try {
        // Prep was a waterfall (config → packages → key). These are independent.
        const configReady = (async () => {
            try {
                await chain.extendConfig({ producer: producerName });
                queryClient.invalidateQueries({ queryKey: queryKeys.config });
            } catch {
                throw new Error("Failed to set producer name");
            }
        })();

        const packagesReady = chain.getPackages(packages.map((p) => p.file));

        const keyReady = (async (): Promise<string | undefined> => {
            if (!blockSigningPubKey) return undefined;
            try {
                return await exportKeyToPEM(blockSigningPubKey, "PUBLIC KEY");
            } catch {
                throw new Error(
                    "Failed to export public key to PEM format during boot",
                );
            }
        })();

        let fetchedPackages: ArrayBuffer[];
        let blockSigningPubKeyPem: string | undefined;
        try {
            [, fetchedPackages, blockSigningPubKeyPem] = await Promise.all([
                configReady,
                packagesReady,
                keyReady,
            ]);
        } catch (e) {
            const message =
                e instanceof Error ? e.message : "Boot preparation failed";
            onProgressUpdate(message);
            return;
        }

        const packageBuffers = fetchedPackages.map(
            (buf) => new Uint8Array(buf),
        );

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

        onProgressUpdate(["push", 0, 1, labels]);
        const bootTrace = await chain.pushArrayBufferBoot(
            boot_transaction.buffer,
        );
        if (bootTrace.error) {
            onProgressUpdate(bootTrace);
            console.error(bootTrace.error);
            return;
        }

        const ok = await pushBootTransactions(
            transactions,
            labels,
            onProgressUpdate,
        );
        if (!ok) {
            onProgressUpdate({ type: "BootComplete", success: false });
            return;
        }

        onProgressUpdate(["push", labels.length, labels.length, labels]);
        onProgressUpdate({ type: "BootComplete", success: true });
    } catch (e) {
        onProgressUpdate({ type: "BootComplete", success: false });
        console.error(e);
    }
};
