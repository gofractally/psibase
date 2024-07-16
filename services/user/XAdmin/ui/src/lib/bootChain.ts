import { PsinodeConfig } from "@/configuration/interfaces";
import { putJson } from "../helpers";
import { BootState, PackageInfo } from "@/types";
import {
    getJson,
    getArrayBuffer,
    postArrayBuffer,
    postArrayBufferGetJson,
} from "@psibase/common-lib";
import * as wasm from "wasm-psibase";

const updateConfig = async (config: PsinodeConfig) => {
    const result = await putJson("/native/admin/config", config);
    if (!result.ok) {
        throw "Update failed";
    }
};

export const bootChain = async (
    packages: PackageInfo[],
    producerName: string,
    existingConfig: PsinodeConfig | undefined,
    onConfigUpdate: () => void,
    onProgressUpdate: (state: BootState) => void
): Promise<void> => {
    try {
        // Set producer name
        if (existingConfig && producerName !== existingConfig.producer) {
            try {
                await updateConfig({
                    ...existingConfig,
                    producer: producerName,
                });
                onConfigUpdate();
            } catch (e) {
                onProgressUpdate("Failed to set producer name");
                return;
            }
        }

        const fetchedPackages: ArrayBuffer[] = await Promise.all(
            packages.map((pack) => getArrayBuffer(`/packages/${pack.file}`))
        );

        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.

        const [boot_transaction, transactions] =
            wasm.js_create_boot_transactions(producerName, fetchedPackages);

        let i = 1;
        onProgressUpdate(["push", i, transactions.length + 1]);
        const trace = await postArrayBufferGetJson(
            "/native/push_boot",
            boot_transaction.buffer
        );
        if (trace.error) {
            onProgressUpdate(trace);
            console.error(trace.error);
            return;
        }
        i++;

        for (const t of transactions) {
            console.log(`Pushing transaction number: ${i}`);
            onProgressUpdate(["push", i + 1, transactions.length + 1]);
            let trace = await postArrayBufferGetJson(
                "/native/push_transaction",
                t.buffer
            );
            console.log(trace, "is the trace");
            if (trace.error) {
                onProgressUpdate(trace);
                console.error(trace.error);
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
