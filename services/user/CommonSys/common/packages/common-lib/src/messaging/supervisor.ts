import { generateRandomString } from "./generateRandomString";
import { generateSubdomain } from "./generateSubdomain";
import { buildPreLoadServicesRequest } from "./supervisor/PreLoadServicesRequest";
import {
    isIFrameInitialized,
    isFunctionCallResponse,
    FunctionCallResponse,
    FunctionCallArgs,
    FunctionCallRequest,
} from "./supervisor/index";

const generateId = () => generateRandomString();

const SupervisorIFrameId = "iframe-supervisor-sys" as const;

const getSupervisorHref = (subDomain = "supervisor-sys"): string => {
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

const supervisorOrigin = generateSubdomain('supervisor-sys');

export class Supervisor {
    public isSupervisorInitialized = false;

    private pendingRequests: {
        id: string;
        resolve: (result: unknown) => void;
        reject: (result: unknown) => void;
    }[] = [];

    private onLoadPromise?: (value?: unknown) => void;

    constructor(public options?: Options) {
        const supervisorSrc = options?.supervisorSrc || getSupervisorHref();
        this.listenToRawMessages();
        setupSupervisorIFrame(supervisorSrc);
    }

    listenToRawMessages() {
        window.addEventListener("message", (event) =>
            this.handleRawEvent(event)
        );
    }

    handleRawEvent(messageEvent: MessageEvent) {
        // TODO check the sources of these events, e.g. the origin, what iframe did it come from?;
        if (isIFrameInitialized(messageEvent.data)) {
            this.onSupervisorInitialized();
        } else if (isFunctionCallResponse(messageEvent.data)) {
            this.onFunctionCallResponse(messageEvent.data);
        }
    }

    onSupervisorInitialized() {
        console.log("Supervisor successfully initialized. 🔥");
        this.isSupervisorInitialized = true;
        if (this.onLoadPromise) {
            this.onLoadPromise();
        }
    }

    onFunctionCallResponse(response: FunctionCallResponse) {
        const request = this.pendingRequests.find(
            (req) => req.id == response.payload.id
        );
        if (request) {
            request.resolve(response.payload.result);
        } else {
            console.error(
                `Received request response but is not a pending request on app.`
            );
        }
    }

    private getSupervisorIframe(): HTMLIFrameElement {
        if (!this.isSupervisorInitialized)
            throw new Error(`Supervisor is not initialized`);
        const iframe = document.getElementById(
            SupervisorIFrameId
        ) as HTMLIFrameElement;
        if (!iframe) throw new Error(`Failed to find supervisor-sys iframe`);
        if (!iframe.contentWindow)
            throw new Error(`Failed to access iframe contentWindow`);
        return iframe;
    }

    functionCall(args: FunctionCallArgs) {
        const id = generateId();
        const iframe = this.getSupervisorIframe();

        return new Promise((resolve, reject) => {
            this.pendingRequests.push({ id, resolve, reject });
            const message: FunctionCallRequest = {
                type: "FUNCTION_CALL_REQUEST",
                payload: {
                    id,
                    args,
                },
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

    preLoadServices(services: string[]) {
        const message = buildPreLoadServicesRequest(services);
        const iframe = this.getSupervisorIframe();
        if (!iframe.contentWindow)
            throw new Error(
                `Failed to get content window from supervisor iframe`
            );
        iframe.contentWindow.postMessage(message, supervisorOrigin);
    }
}
