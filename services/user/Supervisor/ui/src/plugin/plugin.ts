import {
    QualifiedPluginId,
    assertTruthy,
    pluginString,
    siblingUrl,
} from "@psibase/common-lib";

import { loadPlugin } from "../component-loading/loader";
import { DownloadFailed } from "../errors";
import { HostInterface } from "../hostInterface";
import { parser, wasmFromUrl } from "../utils";
import { ComponentAPI } from "../witExtraction";
import { InvalidCall, PluginDownloadFailed, PluginInvalid } from "./errors";

export class Plugin {
    private host: HostInterface;

    private componentAPI: ComponentAPI | undefined;

    private bytes: Uint8Array | undefined;

    id: QualifiedPluginId;

    fetched: Promise<Uint8Array>;

    parsed: Promise<ComponentAPI>;

    ready: Promise<void>;

    // A module dynamically generated from a bundle including: transpiled component, wasi shims, and imports
    private pluginModule: any;

    private resources: Map<number, any> = new Map();
    private nextResourceHandle: number = 1;

    private methodExists(intf: string | undefined, method: string) {
        if (!this.componentAPI) {
            throw new PluginInvalid(this.id);
        }

        const { exportedFuncs } = this.componentAPI;

        if (intf !== undefined) {
            const foundInterface = exportedFuncs.interfaces.find(
                (i) => i.name === intf,
            );
            return foundInterface?.funcs.some((f) => f.name === method);
        }

        return exportedFuncs.funcs.some((f) => f.name === method);
    }

    private async doFetchPlugin(): Promise<Uint8Array> {
        const { service, plugin } = this.id;
        const url = siblingUrl(null, service, `/${plugin}.wasm`);
        try {
            this.bytes = await wasmFromUrl(url);
            return this.bytes;
        } catch (e) {
            if (e instanceof DownloadFailed) {
                throw new PluginDownloadFailed(this.id);
            }
            throw e;
        }
    }

    private async doParse(): Promise<ComponentAPI> {
        const bin = await this.fetched;
        const p = await parser();
        try {
            this.componentAPI = p.parse("comp", bin) as ComponentAPI;
        } catch (e) {
            console.error(`Error parsing plugin: ${pluginString(this.id)}`);
            throw e;
        }

        return this.componentAPI;
    }

    async getDependencies(): Promise<QualifiedPluginId[]> {
        let api: ComponentAPI | undefined;
        try {
            api = await this.parsed;
            return api.importedFuncs.interfaces.map((intf) => ({
                service: intf.namespace,
                plugin: intf.package,
            }));
        } catch (e: any) {
            if (e instanceof PluginDownloadFailed) {
                return [];
            } else {
                throw e;
            }
        }
    }

    private async doReady(): Promise<void> {
        const api = await this.parsed;
        const privileged = this.id.service === "host";
        this.pluginModule = await loadPlugin(this.id.service,privileged, this.bytes!, this.host, api);
    }

    constructor(id: QualifiedPluginId, host: HostInterface) {
        this.id = id;
        this.host = host;
        this.bytes = undefined;
        this.fetched = this.doFetchPlugin();
        this.parsed = this.doParse();
        this.ready = this.doReady();
    }

    // Called by the supervisor to call into a plugin wasm
    call(intf: string | undefined, method: string, params: any[]) {
        if (!this.methodExists(intf, method)) {
            assertTruthy(this.componentAPI, "Component API undefined");
            console.info(
                "[Debug info] Valid exports:",
                this.componentAPI.exportedFuncs,
            );
            throw new InvalidCall(this.id, intf, method);
        }

        if (this.bytes === undefined || this.pluginModule === undefined) {
            throw new PluginInvalid(this.id);
        }

        const func =
            typeof intf === "undefined" || intf === ""
                ? this.pluginModule[method]
                : this.pluginModule[intf][method];

        return func(...params);
    }

    resourceCall(intf: string | undefined, type: string, handle: number | undefined, method: string, params: any[]) {
        if (this.bytes === undefined || this.pluginModule === undefined) {
            throw new PluginInvalid(this.id);
        }

        if (method === "constructor") {
            if (handle !== undefined) {
                throw new InvalidCall(this.id, intf, `Handle is not allowed for ${type}.constructor`);
            }
            const module = intf ? this.pluginModule[intf] : this.pluginModule;
            const resourceClass = module?.[type];
            if (!resourceClass) {
                throw new InvalidCall(this.id, intf, `${type}.constructor`);
            }
            
            const resource = new resourceClass(...params);
            const resourceHandle = this.nextResourceHandle++;
            this.resources.set(resourceHandle, resource);
            
            return resourceHandle;
        }

        if (handle === undefined) {
            throw new InvalidCall(this.id, intf, `${type}.${method} call missing handle`);
        }

        const resource = this.resources.get(handle);
        if (!resource) {
            throw new InvalidCall(this.id, intf, `${type}.${method} invalid handle`);
        }

        if (typeof resource[method] !== 'function') {
            throw new InvalidCall(this.id, intf, `${type}.${method} is not a function`);
        }

        return resource[method](...params);
    }

    // Gets the JSON interface for a plugin
    getJson(): string {
        assertTruthy(this.componentAPI, "Component API undefined");
        return this.componentAPI.debug;
    }
}
