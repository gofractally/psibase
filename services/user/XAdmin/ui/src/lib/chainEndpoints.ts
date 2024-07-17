import {
    PsinodeConfigUpdate,
    psinodeConfigSchema,
} from "../configuration/interfaces";
import {
    postJson,
    getJson,
    postArrayBufferGetJson,
    getArrayBuffer,
} from "@psibase/common-lib";
import { putJson } from "../helpers";
import { z } from "zod";

type Buffer = number[];

const Peers = z
    .object({
        id: z.number(),
        endpoint: z.string(),
        url: z.string().optional(),
    })
    .strict()
    .array();

class Chain {
    public async getPeers() {
        return Peers.parse(await getJson("/native/admin/peers"));
    }

    public async getConfig() {
        return psinodeConfigSchema.parse(await getJson("/native/admin/config"));
    }

    public async getPackages(fileNames: string[]): Promise<ArrayBuffer[]> {
        return Promise.all(
            fileNames.map((fileName) => getArrayBuffer(`/packages/${fileName}`))
        );
    }

    public async updateConfig(config: PsinodeConfigUpdate): Promise<void> {
        const existingConfig = await this.getConfig();
        const newConfig = psinodeConfigSchema.parse({
            ...existingConfig,
            ...config,
        });
        const result = await putJson("/native/admin/config", newConfig);
        if (!result.ok) {
            throw "Update failed";
        }
    }

    public async disconnectPeer(id: number): Promise<void> {
        await postJson("/native/admin/disconnect", { id });
    }

    public pushArrayBufferBoot(buffer: Buffer) {
        return postArrayBufferGetJson("/native/push_boot", buffer);
    }

    public pushArrayBufferTransaction(buffer: Buffer) {
        return postArrayBufferGetJson("/native/push_transaction", buffer);
    }

    public async restart(): Promise<void> {
        await postJson("/native/admin/shutdown", {
            restart: true,
        });
    }

    public async shutdown(): Promise<void> {
        await postJson("/native/admin/shutdown", {});
    }

    public async connect(config: { url: string }): Promise<void> {
        await postJson("/native/admin/connect", config);
    }
}

export const chain = new Chain();
