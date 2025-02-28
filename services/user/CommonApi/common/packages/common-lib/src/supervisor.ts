import { siblingUrl } from "./rpc";
import {
    buildFunctionCallRequest,
    toString,
} from "./messaging/FunctionCallRequest";
import {
    PluginId,
    pluginString,
    QualifiedPluginId,
} from "./messaging/PluginId";
import { buildPreLoadPluginsRequest } from "./messaging/PreLoadPluginsRequest";
import {
    isSupervisorInitialized,
    isFunctionCallResponse,
    FunctionCallResponse,
    FunctionCallArgs,
    isPluginError,
    isGenericError,
    buildGetJsonRequest,
} from "./messaging";
import { assertTruthy } from "./utils";

const SupervisorIFrameId = "iframe-supervisor" as const;

interface Options {
    supervisorSrc?: string;
}

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
    isSupervisorInitialized = false;
    private supervisorSrc: string;

    constructor(options?: Options) {
        this.supervisorSrc =
            options?.supervisorSrc || siblingUrl(undefined, "supervisor");
        this.listenToRawMessages();
        setupSupervisorIFrame(this.supervisorSrc);
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

    private pendingRequests: {
        id: string;
        details: string;
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

    private onLoadPromiseResolvers: ((value?: unknown) => void)[] = [];

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
            console.log(
                "Received unauthorized message. Ignoring.",
                messageEvent,
            );
            return;
        }

        if (messageEvent.origin !== this.supervisorSrc) {
            return;
        }

        try {
            if (isSupervisorInitialized(messageEvent.data)) {
                this.onSupervisorInitialized();
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

    private onSupervisorInitialized() {
        this.isSupervisorInitialized = true;
        this.onLoadPromiseResolvers.forEach((resolver) => resolver());
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

        if (isPluginError(result)) {
            const { service, plugin } = result.pluginId;

            console.error(`Call to ${resolved.details} failed`);
            console.error(`[${service}:${plugin}] ${result.message}`);
            pendingRequest.reject(result);
            return;
        }

        if (isGenericError(result)) {
            console.error(`Call to ${resolved.details} failed`);
            console.error(result.message);
            pendingRequest.reject(result);
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

    private async sendRequest(description: string, request: any): Promise<any> {
        await this.onLoaded();
        const iframe = this.getSupervisorIframe();

        return new Promise((resolve, reject) => {
            this.pendingRequests.push({
                id: request.id,
                details: description,
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

    public functionCall(args: FunctionCallArgs) {
        const request = buildFunctionCallRequest(args);
        return this.sendRequest(toString(args), request);
    }

    public getJson(plugin: QualifiedPluginId) {
        const request = buildGetJsonRequest(plugin);
        return this.sendRequest(`Get JSON: ${pluginString(plugin)}`, request);
    }

    public async onLoaded() {
        if (this.isSupervisorInitialized) return;
        return new Promise((resolve) => {
            this.onLoadPromiseResolvers.push(resolve);
        });
    }

    public async preLoadPlugins(plugins: PluginId[]) {
        await this.onLoaded();
        // Fully qualify any plugins with default values
        const fqPlugins: QualifiedPluginId[] = plugins.map((plugin) => ({
            ...plugin,
            plugin: plugin.plugin || "plugin",
        }));

        const message = buildPreLoadPluginsRequest(fqPlugins);

        const iframe = this.getSupervisorIframe();
        if (!iframe.contentWindow)
            throw new Error(
                `Failed to get content window from supervisor iframe`,
            );
        iframe.contentWindow.postMessage(message, this.supervisorSrc);
    }
}

export const getSupervisor = Supervisor.getInstance;
