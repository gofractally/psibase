import { siblingUrl } from "./rpc";
import {
    buildFunctionCallRequest,
    toString,
} from "./messaging/function-call-request";
import {
    PluginId,
    pluginString,
    QualifiedPluginId,
} from "./messaging/plugin-id";
import { buildPreLoadPluginsRequest } from "./messaging/preload-plugins-request";
import {
    isSupervisorInitialized,
    isSupervisorStartupFailed,
    isFunctionCallResponse,
    FunctionCallResponse,
    FunctionCallArgs,
    buildGetJsonRequest,
    isPluginErrorObject,
    isGenericErrorObject,
    PluginError,
    GenericError,
    isRedirectErrorObject,
} from "./messaging";
import { assertTruthy } from "./utils";
import { handlePluginUserPrompt } from "./prompts";

const SupervisorIFrameId = "iframe-supervisor" as const;

type SupervisorLoadState =
    | { status: "pending" }
    | { status: "ready" }
    | { status: "failed"; error: GenericError };

interface LoadWaiter {
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}

interface Options {
    supervisorSrc?: string;
}

export type AutoRedirectConfig = {
    enabled: boolean;
    returnPath: string;
};

const setupSupervisorIFrame = (src: string) => {
    const iframe = document.createElement("iframe");
    iframe.id = SupervisorIFrameId;
    iframe.src = src;
    iframe.style.display = "none";

    if (
        document.readyState === "complete" ||
        document.readyState === "interactive"
    ) {
        document.body.appendChild(iframe);
    } else {
        document.addEventListener("DOMContentLoaded", () => {
            document.body.appendChild(iframe);
        });
    }
};

const my = new URL(window.location.href);
const myOrigin = `${my.protocol}//${my.hostname}${my.port ? ":" + my.port : ""}`;

// Convenient library for users to interact with the supervisor.
export class Supervisor {
    private static instance: Supervisor;
    private loadState: SupervisorLoadState = { status: "pending" };
    private iframeCreated = false;
    private supervisorSrc: string;

    private constructor(options?: Options) {
        this.supervisorSrc =
            options?.supervisorSrc || siblingUrl(undefined, "supervisor");
        this.listenToRawMessages();
    }

    public static getInstance(options?: Options) {
        if (!Supervisor.instance) {
            Supervisor.instance = new Supervisor(options);
            return Supervisor.instance;
        }

        if (
            options?.supervisorSrc &&
            Supervisor.instance.supervisorSrc !== options.supervisorSrc
        ) {
            console.warn(
                "Supervisor has already been instantiated with different options. New options have been ignored.",
            );
        }

        return Supervisor.instance;
    }

    private ensureIFrame() {
        if (this.iframeCreated) {
            return;
        }
        this.iframeCreated = true;
        setupSupervisorIFrame(this.supervisorSrc);
    }

    private pendingRequests: {
        id: string;
        details: string;
        autoRedirectConfig: AutoRedirectConfig;
        resolve: (result: unknown) => void;
        reject: (result: unknown) => void;
    }[] = [];

    private removePendingRequestById(id: string) {
        const request = this.pendingRequests.find((req) => req.id === id);
        this.pendingRequests = this.pendingRequests.filter(
            (req) => req.id !== id,
        );
        return request;
    }

    private onLoadPromiseResolvers: LoadWaiter[] = [];

    private listenToRawMessages() {
        window.addEventListener("message", (event) =>
            this.handleRawEvent(event),
        );
    }

    private handleRawEvent(messageEvent: MessageEvent) {
        if (
            messageEvent.origin !== myOrigin &&
            messageEvent.origin !== this.supervisorSrc
        ) {
            return;
        }

        if (messageEvent.origin !== this.supervisorSrc) {
            return;
        }

        try {
            if (isSupervisorInitialized(messageEvent.data)) {
                this.onSupervisorInitialized();
            } else if (isSupervisorStartupFailed(messageEvent.data)) {
                this.onSupervisorStartupFailed(
                    messageEvent.data.payload.message,
                );
            } else if (isFunctionCallResponse(messageEvent.data)) {
                this.onFunctionCallResponse(messageEvent.data);
            }
        } catch (e) {
            if (e instanceof Error) {
                console.error(e.message);
                return;
            }
            console.error(`Unrecognized error: ${JSON.stringify(e, null, 2)}`);
        }
    }

    public get isSupervisorInitialized(): boolean {
        return this.loadState.status === "ready";
    }

    private onSupervisorInitialized() {
        this.loadState = { status: "ready" };
        this.settleLoadWaiters((waiter) => waiter.resolve());
    }

    private onSupervisorStartupFailed(message: string) {
        const error = new GenericError(message);
        this.loadState = { status: "failed", error };
        this.settleLoadWaiters((waiter) => waiter.reject(error));
    }

    private settleLoadWaiters(settle: (waiter: LoadWaiter) => void) {
        const waiters = this.onLoadPromiseResolvers;
        this.onLoadPromiseResolvers = [];
        waiters.forEach(settle);
    }

    private onFunctionCallResponse(response: FunctionCallResponse) {
        const pendingRequest = this.pendingRequests.find(
            (req) => req.id === response.id,
        );
        if (!pendingRequest) {
            throw Error(`Received unexpected response from supervisor.`);
        }

        const { result } = response;

        const resolved = this.removePendingRequestById(response.id);
        assertTruthy(resolved, "Resolved pending request");

        if (isRedirectErrorObject(result)) {
            if (pendingRequest.autoRedirectConfig.enabled) {
                handlePluginUserPrompt(
                    result,
                    pendingRequest.autoRedirectConfig.returnPath,
                );
            } else {
                pendingRequest.reject(result);
            }
            return;
        }
        if (isPluginErrorObject(result)) {
            const { service, plugin } = result.pluginId;

            console.error(`Call to ${resolved.details} failed`);
            console.error(`[${service}:${plugin}] ${result.message}`);
            const resultAsError = new PluginError(
                result.pluginId,
                result.message,
            );
            pendingRequest.reject(resultAsError);
            return;
        }

        if (isGenericErrorObject(result)) {
            console.error(`Call to ${resolved.details} failed`);
            console.error(result.message);
            const resultAsError = new GenericError(result.message);
            pendingRequest.reject(resultAsError);
            return;
        }

        pendingRequest.resolve(response.result);
    }

    private getSupervisorIframe(): HTMLIFrameElement {
        if (!this.isSupervisorInitialized)
            throw new Error(`Supervisor is not initialized`);
        const iframe = document.getElementById(
            SupervisorIFrameId,
        ) as HTMLIFrameElement;
        if (!iframe) throw new Error(`Failed to find supervisor iframe`);
        if (!iframe.contentWindow)
            throw new Error(`Failed to access iframe contentWindow`);
        return iframe;
    }

    private async sendRequest(
        description: string,
        autoRedirectConfig: AutoRedirectConfig,
        request: any,
    ): Promise<any> {
        await this.onLoaded();
        const iframe = this.getSupervisorIframe();

        return new Promise((resolve, reject) => {
            this.pendingRequests.push({
                id: request.id,
                details: description,
                autoRedirectConfig,
                resolve,
                reject,
            });
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage(request, this.supervisorSrc);
            } else {
                reject("Failed to get supervisor iframe");
            }
        });
    }

    private async onLoaded() {
        this.ensureIFrame();
        if (this.loadState.status === "failed") throw this.loadState.error;
        if (this.loadState.status === "ready") return;
        return new Promise((resolve, reject) => {
            this.onLoadPromiseResolvers.push({ resolve, reject });
        });
    }

    public functionCall(
        args: FunctionCallArgs,
        autoRedirectConfig: AutoRedirectConfig = {
            enabled: true,
            returnPath: "/",
        },
    ) {
        const request = buildFunctionCallRequest(args);
        return this.sendRequest(toString(args), autoRedirectConfig, request);
    }

    public getJson(plugin: QualifiedPluginId) {
        const request = buildGetJsonRequest(plugin);
        const autoRedirectConfig: AutoRedirectConfig = {
            enabled: true,
            returnPath: "/",
        };
        return this.sendRequest(
            `Get JSON: ${pluginString(plugin)}`,
            autoRedirectConfig,
            request,
        );
    }

    public preLoadPlugins(plugins: PluginId[]) {
        // Fully qualify any plugins with default values
        const fqPlugins: QualifiedPluginId[] = plugins.map((plugin) => ({
            ...plugin,
            plugin: plugin.plugin || "plugin",
        }));

        const request = buildPreLoadPluginsRequest(fqPlugins);
        const autoRedirectConfig: AutoRedirectConfig = {
            enabled: false,
            returnPath: "/",
        };
        return this.sendRequest(
            `Preload plugins: ${fqPlugins.map((p) => `${p.service}:${p.plugin}`).join(", ")}`,
            autoRedirectConfig,
            request,
        );
    }
}

export const getSupervisor = Supervisor.getInstance;
