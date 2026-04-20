/**
 * Memory model — context for everything in this folder
 *
 * A psibase plugin is a WebAssembly *component* that decomposes (via jco)
 * into one or more *core modules* — typically a primary core plus a WASI
 * preview1 adapter and lift/lower trampolines. Each instantiated core
 * module gets its own WebAssembly.Instance, and the ones that own memory
 * each export their own WebAssembly.Memory.
 *
 * On 64-bit V8 each WebAssembly.Memory reserves ~10GB of *virtual address
 * space* (VAS) under the guard-page allocation scheme, regardless of how
 * little physical RAM the plugin actually touches. With dozens of plugins
 * loaded, VAS exhaustion (not RAM exhaustion) is what makes further
 * instantiations fail with "RangeError: WebAssembly.Memory(): could not
 * allocate memory".
 *
 * The supervisor mitigates this by *call-scoping* plugin instances:
 *   - Plugins are fetched + parsed + compiled eagerly during preload.
 *     Compilation is cheap — no Memory allocated.
 *   - Plugins are *instantiated* (Memory allocated) just before the
 *     synchronous call chain runs, and *disposed* in finally(). Disposal
 *     drops the pluginModule reference; V8 reclaims the Memory on the
 *     next GC.
 *   - The compiledPlugin handle (a WebAssembly.Module) is retained so
 *     the next entry() can re-instantiate without re-fetching or
 *     re-compiling.
 *
 * The component-parser utility WASM (loaded once at supervisor startup,
 * see utils.ts) is the only WASM allocation retained between entry()
 * calls.
 *
 * Subsequent comments in this folder assume this context and will not
 * re-derive it. Look here when something talks about "VAS", "Memory",
 * "dispose", or "retained" without further explanation.
 */

import {
    QualifiedPluginId,
    assertTruthy,
    pluginString,
    siblingUrl,
} from "@psibase/common-lib";

import { compilePlugin } from "../component-loading/loader";
import { CompiledPlugin } from "../component-loading";
import { DownloadFailed } from "../errors";
import { HostInterface } from "../host-interface";
import { parser, wasmFromUrl } from "../utils";
import { ComponentAPI } from "../wit-extraction";
import { InvalidCall, PluginDownloadFailed, PluginInvalid } from "./errors";

// Buffered GC reclaim log. The FinalizationRegistry callback fires when
// V8 collects a disposed plugin's instance module. Batches labels that
// arrive within ~50ms into a single line. (Instrumentation — see
// instrumentation.ts REMOVAL CHECKLIST.)
const gcQueue: string[] = [];
let gcFlushScheduled = false;
function flushGcQueue() {
    if (gcQueue.length === 0) {
        gcFlushScheduled = false;
        return;
    }
    const labels = gcQueue.splice(0);
    console.log(
        `[gc] reclaimed ${labels.length} plugin(s): [${labels.join(", ")}]`,
    );
    gcFlushScheduled = false;
}
const gcRegistry: FinalizationRegistry<string> | null =
    typeof FinalizationRegistry !== "undefined"
        ? new FinalizationRegistry<string>((label) => {
              gcQueue.push(label);
              if (!gcFlushScheduled) {
                  gcFlushScheduled = true;
                  setTimeout(flushGcQueue, 50);
              }
          })
        : null;

// Per-plugin instrumentation captured during preload, consumed once by
// Instrumentation.collectPreloadStats(). coreCount/memoryCount are
// deterministic per compiled component.
export interface PluginStats {
    fetchMs?: number;
    fetchBytes?: number;
    compileMs?: number;
    coreCount?: number;
    memoryCount?: number;
    reported: boolean;
}

export class Plugin {
    private host: HostInterface;

    private componentAPI: ComponentAPI | undefined;

    private bytes: Uint8Array | undefined;

    id: QualifiedPluginId;

    fetched: Promise<Uint8Array>;

    parsed: Promise<ComponentAPI>;

    // Resolves once the plugin is compiled. ensureInstantiated() must
    // still be called before use.
    ready: Promise<void>;

    stats: PluginStats = { reported: false };

    private compiledPlugin: CompiledPlugin | undefined;
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
        const t0 = performance.now();
        try {
            this.bytes = await wasmFromUrl(url);
            this.stats.fetchMs = performance.now() - t0;
            this.stats.fetchBytes = this.bytes.byteLength;
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
        const t0 = performance.now();
        this.compiledPlugin = await compilePlugin(
            this.id.service,
            privileged,
            this.bytes!,
            this.host,
            api,
        );
        this.stats.compileMs = performance.now() - t0;
    }

    constructor(id: QualifiedPluginId, host: HostInterface) {
        this.id = id;
        this.host = host;
        this.bytes = undefined;
        this.fetched = this.doFetchPlugin();
        this.parsed = this.doParse();
        this.ready = this.doReady();
    }

    get isInstantiated(): boolean {
        return this.pluginModule !== undefined;
    }

    async ensureInstantiated(): Promise<void> {
        if (this.pluginModule) return;
        if (!this.compiledPlugin) throw new PluginInvalid(this.id);
        const { exports, coreCount, memoryCount } =
            await this.compiledPlugin.instantiate();
        this.pluginModule = exports;
        this.stats.coreCount = coreCount;
        this.stats.memoryCount = memoryCount;
        gcRegistry?.register(
            this.pluginModule,
            `${this.id.service}:${this.id.plugin}`,
        );
    }

    dispose(): void {
        this.pluginModule = undefined;
        this.resources.clear();
        this.nextResourceHandle = 1;
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

        if (this.pluginModule === undefined) {
            throw new PluginInvalid(this.id);
        }

        const func =
            typeof intf === "undefined" || intf === ""
                ? this.pluginModule[method]
                : this.pluginModule[intf][method];

        return func(...params);
    }

    resourceCall(
        intf: string | undefined,
        type: string,
        handle: number | undefined,
        method: string,
        params: any[],
    ) {
        if (this.pluginModule === undefined) {
            throw new PluginInvalid(this.id);
        }

        if (method === "constructor") {
            if (handle !== undefined) {
                throw new InvalidCall(
                    this.id,
                    intf,
                    `Handle is not allowed for ${type}.constructor`,
                );
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

        if (typeof resource[method] !== "function") {
            throw new InvalidCall(
                this.id,
                intf,
                `${type}.${method} is not a function`,
            );
        }

        return resource[method](...params);
    }

    getJson(): string {
        assertTruthy(this.componentAPI, "Component API undefined");
        return this.componentAPI.debug;
    }
}
