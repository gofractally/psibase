import {
    QualifiedPluginId,
    assertTruthy,
    pluginString,
    siblingUrl,
} from "@psibase/common-lib";

import { kebabToCamel, kebabToPascal } from "../case";
import { slog, watchHang } from "../debug";
import { CompiledPlugin } from "../component-loading";
import {
    ServiceMap,
    compilePlugin,
    getPluginService,
} from "../component-loading/loader";
import { DownloadFailed } from "../errors";
import { HostInterface } from "../host-interface";
import { settleOrPrompt } from "../prompt-signal";
import {
    invokePluginExport,
    isThenable,
    networkName,
    parser,
    settleWith,
    wasmFromUrl,
} from "../utils";
import { ComponentAPI } from "../wit-extraction";
import { InvalidCall, PluginDownloadFailed, PluginInvalid } from "./errors";

export class Plugin {
    private host: HostInterface;

    private componentAPI: ComponentAPI | undefined;

    private bytes: Uint8Array | undefined;

    id: QualifiedPluginId;

    fetched: Promise<Uint8Array>;

    parsed: Promise<ComponentAPI>;

    services: Promise<ServiceMap | null>;

    // Resolves when the plugin is compiled (cheap — no Memory allocated).
    // After this, instantiate() can be called to allocate Memory.
    ready: Promise<void>;

    private compiledPlugin: CompiledPlugin | undefined;
    private pluginModule: any;

    private resources: Map<number, any> = new Map();
    private nextResourceHandle: number = 1;

    // Nested JSPI entry into the same component deadlocks jco. host:http
    // calls back into accounts:query get-current-user while get-account is
    // suspended; answer that from JS instead of re-entering wasm.
    private activeCalls = 0;

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
        // The homepage service is served from the configured network name's
        // subdomain. Fetching it via the "homepage" alias would redirect,
        // which breaks authenticated (preflighted) requests.
        const host =
            service === "homepage" && networkName ? networkName : service;
        const url = siblingUrl(null, host, `/${plugin}.wasm`);
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
            const services = await this.services;
            return api.importedFuncs.interfaces
                .filter(
                    (intf) =>
                        intf.namespace !== "wasi" &&
                        intf.namespace !== "supervisor",
                )
                .map((intf) => ({
                    service: getPluginService(services, intf.namespace),
                    plugin: intf.package,
                }));
        } catch (e: any) {
            if (e instanceof PluginDownloadFailed) {
                return [];
            } else {
                console.error(
                    `Error fetching dependencies of plugin: ${pluginString(this.id)}`,
                );
                throw e;
            }
        }
    }

    private async doReady(): Promise<void> {
        const api = await this.parsed;
        const services = await this.services;
        const privileged = this.id.service === "host";
        this.compiledPlugin = await compilePlugin(
            this.id.service,
            privileged,
            this.bytes!,
            this.host,
            api,
            services,
        );
    }

    private get isInstantiated(): boolean {
        return this.pluginModule !== undefined;
    }

    constructor(
        id: QualifiedPluginId,
        host: HostInterface,
        services: Promise<ServiceMap | null>,
    ) {
        this.id = id;
        this.host = host;
        this.bytes = undefined;
        this.services = services;
        this.fetched = this.doFetchPlugin();
        this.parsed = this.doParse();
        this.ready = this.doReady();
    }

    async instantiate(): Promise<void> {
        if (this.pluginModule) return;
        // Background compile of unrelated plugins may have created this
        // Plugin object before jco finished. Skip until it is ready so a
        // branding/login call does not wait on invite transpile.
        if (!this.compiledPlugin) return;
        const { exports } = await this.compiledPlugin.instantiate();
        this.pluginModule = exports;
    }

    dispose(): boolean {
        if (!this.isInstantiated) return false;

        this.pluginModule = undefined;
        this.resources.clear();
        this.nextResourceHandle = 1;
        this.activeCalls = 0;
        return true;
    }

    call(intf: string | undefined, method: string, params: any[]) {
        if (!this.methodExists(intf, method)) {
            assertTruthy(this.componentAPI, "Component API undefined");
            console.info(
                "[Debug info] Valid exports:",
                this.componentAPI.exportedFuncs,
            );
            throw new InvalidCall(this.id, intf, method);
        }

        if (!this.isInstantiated) {
            throw new PluginInvalid(this.id);
        }

        const jsMethod = kebabToCamel(method);
        const label = `${this.id.service}:${this.id.plugin}/${intf ?? ""}->${method} active=${this.activeCalls}`;
        slog(`call ${label}`);
        // connectAccount → host:auth set-logged-in-user → get-query-token
        // runs while this transact instance already has start-tx open.
        // A second promising export on the same component leaves jco's
        // task busy, so the later finish-tx hangs forever. Login does not
        // use TX_ACTIONS, so it can run on a fresh instantiate.
        if (
            this.id.service === "transact" &&
            this.id.plugin === "plugin" &&
            jsMethod === "getQueryToken"
        ) {
            slog(`getQueryToken isolated instance`);
            return this.callOnFreshInstance(intf, method, params);
        }
        // invite accept → transact add-action → on-actions-sender re-enters
        // the same invite component (activeCalls>0) and jco deadlocks.
        if (
            this.activeCalls > 0 &&
            this.compiledPlugin &&
            typeof intf === "string" &&
            intf.startsWith("transact-hook")
        ) {
            slog(`nested hook ${label} -> isolated instance`);
            return this.callOnFreshInstance(intf, method, params);
        }
        if (this.activeCalls > 0) {
            if (jsMethod === "getCurrentUser") {
                return undefined;
            }
            if (jsMethod === "isLoggedIn") {
                return false;
            }
            // host:http get_auth_token calls this while set-logged-in-user
            // is already suspended on the same host:auth instance.
            if (jsMethod === "getActiveQueryToken") {
                return undefined;
            }
        }

        const func =
            typeof intf === "undefined" || intf === ""
                ? this.pluginModule[jsMethod]
                : this.pluginModule[kebabToCamel(intf)][jsMethod];

        this.activeCalls++;
        try {
            const raw = invokePluginExport(func, params);
            const watched = isThenable(raw)
                ? watchHang(`wasm ${label}`, () => Promise.resolve(raw))
                : raw;
            if (!isThenable(raw)) {
                slog(`done sync ${label}`);
            }
            return settleWith(settleOrPrompt(watched), () => {
                this.activeCalls--;
                if (isThenable(raw)) {
                    slog(`done ${label}`);
                }
            });
        } catch (e) {
            this.activeCalls--;
            slog(`throw ${label}`, e);
            throw e;
        }
    }

    private callOnFreshInstance(
        intf: string | undefined,
        method: string,
        params: any[],
    ): Promise<unknown> {
        const compiled = this.compiledPlugin;
        if (!compiled) {
            throw new PluginInvalid(this.id);
        }
        const jsMethod = kebabToCamel(method);
        return watchHang(`isolated ${this.id.service}:${method}`, async () => {
            slog(`isolated instantiate ${this.id.service}:${this.id.plugin} ${method}`);
            const { exports } = await compiled.instantiate();
            const module = exports as Record<string, Record<string, unknown>>;
            const func = (
                typeof intf === "undefined" || intf === ""
                    ? (exports as Record<string, unknown>)[jsMethod]
                    : module[kebabToCamel(intf)][jsMethod]
            ) as (...args: unknown[]) => unknown;
            slog(`isolated wasm start ${method}`);
            return settleOrPrompt(invokePluginExport(func, params));
        });
    }

    resourceCall(
        intf: string | undefined,
        type: string,
        handle: number | undefined,
        method: string,
        params: any[],
    ) {
        if (!this.isInstantiated) {
            throw new PluginInvalid(this.id);
        }

        const jsType = kebabToPascal(type);
        const jsMethod = kebabToCamel(method);

        if (method === "constructor") {
            if (handle !== undefined) {
                throw new InvalidCall(
                    this.id,
                    intf,
                    `Handle is not allowed for ${type}.constructor`,
                );
            }
            const module = intf
                ? this.pluginModule[kebabToCamel(intf)]
                : this.pluginModule;
            const resourceClass = module?.[jsType];
            if (!resourceClass) {
                throw new InvalidCall(this.id, intf, `${type}.constructor`);
            }

            const resource = new resourceClass(...params);
            const resourceHandle = this.nextResourceHandle++;
            this.resources.set(resourceHandle, resource);

            return resourceHandle;
        }

        if (handle === undefined) {
            throw new InvalidCall(
                this.id,
                intf,
                `${type}.${method} call missing handle`,
            );
        }

        const resource = this.resources.get(handle);
        if (!resource) {
            throw new InvalidCall(
                this.id,
                intf,
                `${type}.${method} invalid handle`,
            );
        }

        if (typeof resource[jsMethod] !== "function") {
            throw new InvalidCall(
                this.id,
                intf,
                `${type}.${method} is not a function`,
            );
        }

        return settleOrPrompt(resource[jsMethod](...params));
    }

    getJson(): string {
        assertTruthy(this.componentAPI, "Component API undefined");
        return this.componentAPI.debug;
    }
}
