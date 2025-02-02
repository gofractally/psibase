import {
    PsinodeConfigSelect,
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
import { recursiveFetch } from "./recursiveFetch";

type Buffer = number[];

export const Peer = z
    .object({
        id: z.number(),
        endpoint: z.string(),
        url: z.string().optional().nullable(),
    })
    .strict();

export const Peers = Peer.array();

export type PeersType = z.infer<typeof Peers>;
export type PeerType = z.infer<typeof Peer>;

export const StateEnum = z.enum(["persistent", "backup", "transient"]);

export const UIPeer = Peer.extend({
    state: StateEnum,
});

const schem = z.object({
    timestamp: z.string(),
    memory: z.object({
        database: z.coerce.number(),
        code: z.coerce.number(),
        data: z.coerce.number(),
        wasmMemory: z.coerce.number(),
        wasmCode: z.coerce.number(),
        unclassified: z.coerce.number(),
    }),
    tasks: z
        .object({
            id: z.number(),
            group: z.string(),
            user: z.string(),
            system: z.string(),
            pageFaults: z.string(),
            read: z.string(),
            written: z.string(),
        })
        .array(),
    transactions: z.object({
        unprocessed: z.coerce.number(),
        total: z.coerce.number(),
        failed: z.coerce.number(),
        succeeded: z.coerce.number(),
        skipped: z.coerce.number(),
    }),
});

class Chain {
    public async getPeers(): Promise<z.infer<typeof Peers>> {
        return Peers.parse(await getJson("/native/admin/peers"));
    }

    public async getStatus() {
        return getJson("/native/admin/status");
    }

    public async getConfig(): Promise<PsinodeConfigSelect> {
        const config = await getJson("/native/admin/config");
        return psinodeConfigSchema.parse(config);
    }

    public async getPackages(fileNames: string[]): Promise<ArrayBuffer[]> {
        return Promise.all(
            fileNames.map((fileName) => getArrayBuffer(`/packages/${fileName}`))
        );
    }

    private async mergeConfig(
        config: PsinodeConfigUpdate
    ): Promise<PsinodeConfigSelect> {
        const existingConfig = await this.getConfig();
        return psinodeConfigSchema.parse({
            ...existingConfig,
            ...config,
        });
    }

    public async addPeer(url: string): Promise<void> {
        const currentConfig = await this.getConfig();
        await this.updateConfigOnNode({
            ...currentConfig,
            peers: [...currentConfig.peers, url],
        });
        await recursiveFetch(async () => {
            const newConfig = await this.getConfig();
            return newConfig.peers.includes(url);
        });
    }

    public async removePeer(peerUrl: string): Promise<void> {
        const currentConfig = await this.getConfig();
        const existingPeer = currentConfig.peers.includes(peerUrl);
        if (!existingPeer) throw new Error(`No peer of ${peerUrl} was found.`);
        const withoutPeer = currentConfig.peers.filter(
            (peer) => peer !== peerUrl
        );
        await this.updateConfigOnNode({
            ...currentConfig,
            peers: withoutPeer,
        });

        await recursiveFetch(async () => {
            const newConfig = await this.getConfig();
            return !newConfig.peers.includes(peerUrl);
        });
    }

    public async extendConfig(config: PsinodeConfigUpdate): Promise<void> {
        const newConfig = await this.mergeConfig(config);
        await this.updateConfigOnNode(newConfig);
    }

    private async updateConfigOnNode(
        newConfig: PsinodeConfigSelect
    ): Promise<void> {
        const result = await putJson("/native/admin/config", newConfig);
        if (!result.ok) {
            throw "Update failed";
        }
    }

    public async disconnectPeer(id: number): Promise<void> {
        const currentPeers = await this.getPeers();
        const foundPeer = currentPeers.find((peer) => peer.id == id);
        if (!foundPeer)
            throw new Error(
                `Failed to find peer with ID ${id} in existing peers`
            );
        await postJson("/native/admin/disconnect", { id });
        await recursiveFetch(async () => {
            const newPeers = await this.getPeers();
            const isPeerExisting = newPeers.some(
                (peer) =>
                    peer.endpoint == foundPeer.endpoint &&
                    peer.id == foundPeer.id
            );
            return !isPeerExisting;
        });
    }

    public pushArrayBufferBoot(buffer: Buffer) {
        return postArrayBufferGetJson("/native/push_boot", buffer);
    }

    public pushArrayBufferTransaction(buffer: Buffer) {
        return postArrayBufferGetJson("/native/push_transaction", buffer);
    }

    public addServerKey(key: string) {
        return postJson("/native/admin/keys", {
            service: "verify-sig",
            rawData: key,
        });
    }

    public async restart(): Promise<void> {
        await postJson("/native/admin/shutdown", {
            restart: true,
        });
    }

    public async shutdown(): Promise<void> {
        await postJson("/native/admin/shutdown", {});
    }

    public async connect(config: { url: string }): Promise<any> {
        return postJson("/native/admin/connect", config);
    }

    public async performance() {
        return schem.parse(await getJson("/native/admin/perf"));
    }
}

export const chain = new Chain();
