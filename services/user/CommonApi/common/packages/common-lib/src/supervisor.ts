import { siblingUrl } from "./rpc";
import {
    QualifiedFunctionCallArgs,
    toString,
} from "./messaging/FunctionCallRequest";
import { PluginId, QualifiedPluginId } from "./messaging/PluginId";
import { buildPreLoadPluginsRequest } from "./messaging/PreLoadPluginsRequest";
import {
    isSupervisorInitialized,
    isFunctionCallResponse,
    FunctionCallResponse,
    FunctionCallArgs,
    FunctionCallRequest,
    isPluginError,
    isGenericError,
} from "./messaging";

const SupervisorIFrameId = "iframe-supervisor" as const;

const getSupervisorHref = (subDomain = "supervisor"): string => {
    const currentUrl = window.location.href;
    const url = new URL(currentUrl);
    const hostnameParts = url.hostname.split(".");

    hostnameParts.shift();
    hostnameParts.unshift(subDomain);
    url.hostname = hostnameParts.join(".");

    return url.origin;
};

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

const supervisorOrigin = siblingUrl(null, "supervisor");

const my = new URL(window.location.href);
const myOrigin = `${my.protocol}//${my.hostname}${my.port ? ":" + my.port : ""}`;

// Convenient library for users to interact with the supervisor.
export class Supervisor {
    public isSupervisorInitialized = false;

    private pendingRequest: {
        call: FunctionCallArgs;
        resolve: (result: unknown) => void;
        reject: (result: unknown) => void;
    } | null = null;

    private onLoadPromise?: (value?: unknown) => void;

    constructor(public options?: Options) {
        const supervisorSrc = options?.supervisorSrc || getSupervisorHref();
        this.listenToRawMessages();
        setupSupervisorIFrame(supervisorSrc);
    }

    listenToRawMessages() {
        window.addEventListener("message", (event) =>
            this.handleRawEvent(event),
        );
    }

    handleRawEvent(messageEvent: MessageEvent) {
        if (
            messageEvent.origin !== myOrigin &&
            messageEvent.origin !== supervisorOrigin
        ) {
            console.log("Received unauthorized message. Ignoring.");
            return;
        }

        if (messageEvent.origin !== supervisorOrigin) {
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

    onSupervisorInitialized() {
        this.isSupervisorInitialized = true;
        if (this.onLoadPromise) {
            this.onLoadPromise();
        }
    }

    onFunctionCallResponse(response: FunctionCallResponse) {
        if (!this.pendingRequest) {
            throw Error(`Received unexpected response from supervisor.`);
        }
        const expected = this.pendingRequest.call;
        const received = response.call;
        const unexpected =
            expected.method !== received.method ||
            expected.service !== received.service;

        const { result } = response;
        if (isPluginError(result)) {
            const { service, plugin } = result.pluginId;

            console.error(`Call to ${toString(response.call)} failed`);
            console.error(`[${service}:${plugin}] ${result.message}`);
            this.pendingRequest.reject(result);
            return;
        }

        if (isGenericError(result)) {
            console.error(`Call to ${toString(response.call)} failed`);
            console.error(result.message);
            this.pendingRequest.reject(result);
            return;
        }

        if (unexpected) {
            // Could be infra error rather than plugin error, printing to console to increase probability
            // that it gets reported.
            const msg = `Expected reply to ${toString(expected)} but received reply to ${toString(received)}`;
            console.warn(msg);
            this.pendingRequest.reject(msg);
            return;
        }

        this.pendingRequest.resolve(response.result);
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

    functionCall(args: FunctionCallArgs) {
        const iframe = this.getSupervisorIframe();

        const fqArgs: QualifiedFunctionCallArgs = {
            ...args,
            plugin: args.plugin || "plugin",
        };

        return new Promise((resolve, reject) => {
            this.pendingRequest = { call: args, resolve, reject };
            const message: FunctionCallRequest = {
                type: "FUNCTION_CALL_REQUEST",
                args: fqArgs,
            };
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage(message, supervisorOrigin);
            } else {
                reject("Failed to get supervisor iframe");
            }
        });
    }

    public async onLoaded() {
        if (this.isSupervisorInitialized) return;
        return new Promise((resolve) => {
            this.onLoadPromise = resolve;
        });
    }

    preLoadPlugins(plugins: PluginId[]) {
        // Fully qualify any plugins with default values
        let fqPlugins: QualifiedPluginId[] = plugins.map((plugin) => ({
            ...plugin,
            plugin: plugin.plugin || "plugin",
        }));

        const message = buildPreLoadPluginsRequest(fqPlugins);

        const iframe = this.getSupervisorIframe();
        if (!iframe.contentWindow)
            throw new Error(
                `Failed to get content window from supervisor iframe`,
            );
        iframe.contentWindow.postMessage(message, supervisorOrigin);
    }
}
