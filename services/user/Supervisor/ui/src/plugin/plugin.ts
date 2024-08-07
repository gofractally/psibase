import { siblingUrl, QualifiedPluginId } from "@psibase/common-lib";

import { HostInterface } from "../hostInterface";
import { InvalidCall, PluginDownloadFailed, PluginInvalid } from "./errors";
import { assertTruthy, parser, wasmFromUrl } from "../utils";
import { DownloadFailed } from "../errors";
import { loadPlugin } from "../component-loading/loader";
import { ComponentAPI } from "../witExtraction";

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

    private methodExists(intf: string | undefined, method: string) {
        if (!this.componentAPI) {
            throw new PluginInvalid(this.id);
        }

        const { exportedFuncs } = this.componentAPI;

        if (intf !== undefined) {
            const foundInterface = exportedFuncs.interfaces.find(
                (i) => i.name === intf,
            );
            return foundInterface?.funcs.some((f) => f === method);
        }

        return exportedFuncs.funcs.some((f) => f === method);
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
        this.componentAPI = p.parse("comp", bin) as ComponentAPI;
        return this.componentAPI;
    }

    async getDependencies(): Promise<QualifiedPluginId[]> {
        const api = await this.parsed;

        return api.importedFuncs.interfaces.map((intf) => ({
            service: intf.namespace,
            plugin: intf.package,
        }));
    }

    private async doReady(): Promise<void> {
        const api = await this.parsed;
        this.pluginModule = await loadPlugin(this.bytes!, this.host, api);
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
}
