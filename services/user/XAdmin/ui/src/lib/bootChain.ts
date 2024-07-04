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

export const runBoot = async (
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

        // fetch packages
        let fetchedPackages: ArrayBuffer[] = [];
        let i = 0;
        for (let info of packages) {
            onProgressUpdate(["fetch", i, packages.length]);
            fetchedPackages.push(
                await getArrayBuffer(`/packages/${info.file}`)
            );
            i++;
        }
        // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
        // in a dev environment.
        let [boot_transactions, transactions] =
            wasm.js_create_boot_transactions(producerName, fetchedPackages);
        onProgressUpdate(["push", 0, transactions.length + 1]);
        let trace = await postArrayBufferGetJson(
            "/native/push_boot",
            boot_transactions.buffer
        );
        if (trace.error) {
            onProgressUpdate(trace);
            console.error(trace.error);
            return;
        }
        i = 1;
        for (const t of transactions) {
            console.log(`Pushing transaction number: ${i}`);
            onProgressUpdate(["push", i, transactions.length + 1]);
            let trace = await postArrayBufferGetJson(
                "/native/push_transaction",
                t.buffer
            );
            if (trace.error) {
                onProgressUpdate(trace);
                console.error(trace.error);
                return;
            }
            i++;
        }
        onProgressUpdate("Boot successful.");
    } catch (e) {
        onProgressUpdate("Boot failed.");
        console.error(e);
    }
};
