import {
    isLoaderInitMessage,
    buildPluginCallRequest,
} from "@psibase/supervisor-lib/messaging";

import {
    siblingUrl,
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
} from "@psibase/common-lib";

import { ResultCache } from "@psibase/supervisor-lib/messaging/PluginCallRequest";

interface FrameInfo {
    id: string;
    service: string;
    src: string;
}

export class Plugin {
    public id: QualifiedPluginId;

    private cache: ResultCache[] = [];

    private loadIframe: Promise<HTMLIFrameElement>;

    private getIframeReadyListener(
        resolve: (
            value: HTMLIFrameElement | PromiseLike<HTMLIFrameElement>,
        ) => void,
        frameInfo: FrameInfo,
    ) {
        return (message: MessageEvent<any>) => {
            if (message.origin !== new URL(frameInfo.src).origin) {
                return;
            }

            if (!isLoaderInitMessage(message.data)) {
                return;
            }

            resolve(document.getElementById(frameInfo.id) as HTMLIFrameElement);
        };
    }

    private addIframe(): FrameInfo {
        const iframe = document.createElement("iframe");
        iframe.id = `iframe-${this.id.service}`;
        iframe.src = siblingUrl(null, this.id.service) + "/common/wasm-loader";
        iframe.style.display = "none";

        let { readyState } = document;
        if (readyState === "complete" || readyState === "interactive") {
            document.body.appendChild(iframe);
        } else {
            document.addEventListener("DOMContentLoaded", () => {
                document.body.appendChild(iframe);
            });
        }

        return {
            id: iframe.id,
            service: this.id.service,
            src: iframe.src,
        };
    }

    constructor(id: QualifiedPluginId) {
        this.id = id;
        this.loadIframe = new Promise<HTMLIFrameElement>((resolve, reject) => {
            const frameInfo = this.addIframe();
            setTimeout(() => {
                reject(
                    new Error(
                        `Timeout loading iframe ${id.service}:${id.plugin}`,
                    ),
                );
            }, 2000);
            window.addEventListener(
                "message",
                this.getIframeReadyListener(resolve, frameInfo),
            );
        });
    }

    loadMemory(resultCache: ResultCache[]) {
        this.cache = resultCache;
    }

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

        const iframe = await this.loadIframe;
        iframe.contentWindow?.postMessage(
            buildPluginCallRequest({ caller, args, resultCache: this.cache }),
            siblingUrl(null, this.id.service),
        );
    }
}
