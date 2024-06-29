import { siblingUrl } from "@psibase/common-lib";
import { isLoaderInitMessage } from "@psibase/supervisor-lib/messaging";
import { Plugin } from "./plugin/Plugin";
import { HostInterface } from "./HostInterface";

interface FrameInfo {
    id: string;
    service: string;
    src: string;
}

export class ServiceContext {
    private service: string;
    private plugins: Plugin[] = [];
    private hostInterface: HostInterface;

    private loadIframe: Promise<HTMLIFrameElement>;

    private iframeReadyListener(
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
        iframe.id = `iframe-${this.service}`;
        iframe.src = siblingUrl(null, this.service) + "/common/wasm-loader";
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
            service: this.service,
            src: iframe.src,
        };
    }

    constructor(service: string, hostInterface: HostInterface) {
        this.service = service;

        this.hostInterface = hostInterface;

        this.loadIframe = new Promise<HTMLIFrameElement>((resolve, reject) => {
            const frameInfo = this.addIframe();

            // Set load timeout
            setTimeout(() => {
                // Won't do anything if the promise has already been resolved.
                reject(
                    new Error(`Timeout loading service context for ${service}`),
                );
            }, 2000);

            window.addEventListener(
                "message",
                this.iframeReadyListener(resolve, frameInfo),
            );
        });
    }

    loadPlugin(plugin: string): Plugin {
        let p: Plugin | undefined = this.plugins.find(
            (p) => p.id.service == this.service && p.id.plugin == plugin,
        );
        if (p) {
            return p;
        }

        p = new Plugin(
            { service: this.service, plugin },
            this.hostInterface,
            this.loadIframe,
        );
        this.plugins.push(p);
        return p;
    }
}
