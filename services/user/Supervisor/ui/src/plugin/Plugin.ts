import {
    buildPluginCallRequest,
    isPreloadCompleteMessage,
    isPluginCallResponse,
    isPluginSyncCall,
    PluginCallResponse,
    PluginSyncCall,
    buildPreloadStartMessage,
} from "@psibase/supervisor-lib/messaging";

import {
    siblingUrl,
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
} from "@psibase/common-lib";

import { ResultCache } from "@psibase/supervisor-lib/messaging/PluginCallRequest";
import { HostInterface } from "../HostInterface";
import {
    CallHandler,
    addCallHandler,
    registerCallHandlers,
} from "../WindowMessaging";

export class Plugin {
    public id: QualifiedPluginId;

    private cache: ResultCache[] = [];

    private host: HostInterface;

    private origin: string;

    private callHandlers: CallHandler[] = [];

    private loadPlugin: Promise<void>;

    private iframe: HTMLIFrameElement | undefined;

    private shouldHandleMessage(message: MessageEvent<any>): boolean {
        const fromMyIframe =
            siblingUrl(null, this.id.service) == message.origin;
        const isTop = message.source == window.top;
        const isParent = message.source == window.parent;
        return fromMyIframe && !isTop && !isParent;
    }

    private onPluginResponse(message: MessageEvent<PluginCallResponse<any>>) {
        this.host.addActions(this.origin, message.data.actions);
        this.host.setResult(this.origin, message.data.result);
    }

    private onSyncCall(message: MessageEvent<PluginSyncCall>) {
        this.host.syncCall(this.origin, message.data.args);
    }

    private pluginReadyListener(resolve: () => void) {
        return (message: MessageEvent<any>) => {
            if (!this.shouldHandleMessage(message)) {
                return;
            }

            if (!isPreloadCompleteMessage(message.data)) {
                return;
            }

            this.host.registerDependencies(
                this.origin,
                message.data.payload.dependencies,
            );

            resolve();
        };
    }

    private async addPlugin(loadIframe: Promise<HTMLIFrameElement>) {
        this.iframe = await loadIframe;
        this.iframe.contentWindow?.postMessage(
            buildPreloadStartMessage([this.id.plugin]),
            this.origin,
        );
    }

    constructor(
        id: QualifiedPluginId,
        host: HostInterface,
        loadIframe: Promise<HTMLIFrameElement>,
    ) {
        this.id = id;
        this.host = host;
        this.origin = siblingUrl(null, this.id.service);

        this.loadPlugin = new Promise<void>((resolve, reject) => {
            this.addPlugin(loadIframe);

            // Set load timeout
            setTimeout(() => {
                // Won't do anything if the promise has already been resolved.
                reject(
                    new Error(
                        `Timeout loading plugin ${id.service}:${id.plugin}`,
                    ),
                );
            }, 2000);

            window.addEventListener(
                "message",
                this.pluginReadyListener(resolve),
            );
        });

        addCallHandler(this.callHandlers, isPluginCallResponse, (msg) =>
            this.onPluginResponse(msg),
        );
        addCallHandler(this.callHandlers, isPluginSyncCall, (msg) =>
            this.onSyncCall(msg),
        );
        registerCallHandlers(this.callHandlers, (msg) =>
            this.shouldHandleMessage(msg),
        );
    }

    loadMemory(resultCache: ResultCache[]) {
        this.cache = resultCache;
    }

    // TODO: Consider if a plugin runs an infinite loop. We need a way to terminate the
    //   current call and report the faulty plugin.
    // And also if there's a request for IO, then the timer needs to be paused. IO has no timeout.
    // If the popup is blocked, this is considered an error, but a special error code is returned to the
    //   application so it can instruct the user to enable popups. But since it's an error, cache is
    //   cleared and stack emptied.

    // Call a function on this plugin
    async call(
        caller: string,
        intf: string | undefined,
        method: string,
        params: any[],
    ) {
        const args: QualifiedFunctionCallArgs = {
            service: this.id.service,
            plugin: this.id.plugin,
            intf,
            method,
            params,
        };

        await this.loadPlugin;

        // iframe must be valid if loadPlugin resolved
        this.iframe!.contentWindow?.postMessage(
            buildPluginCallRequest({ caller, args, resultCache: this.cache }),
            this.origin,
        );
    }
}
