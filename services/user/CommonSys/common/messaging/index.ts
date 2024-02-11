import {
    isIFrameIntialized,
    isFunctionCallResponse,
    FunctionCallResponse,
    FunctionCallArgs,
    FunctionCallRequest,
} from "./supervisor";

const generateRandomString = (): string => {
    const chars = "0123456789abcdef";
    let randomString = "";

    for (let i = 0; i < 32; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        randomString += chars[randomIndex];
    }

    return randomString;
};

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

export class Supervisor {
    public isSupervisorInitialized = false;

    private pendingRequests: {
        id: string;
        resolve: (result: unknown) => void;
        reject: (result: unknown) => void;
    }[] = [];

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
        if (isIFrameIntialized(messageEvent.data)) {
            this.onSupervisorIntialized();
        } else if (isFunctionCallResponse(messageEvent.data)) {
            this.onFunctionCallResponse(messageEvent.data);
        }
    }

    onSupervisorIntialized() {
        console.log("Supervisor successfully initialized. 🔥");
        this.isSupervisorInitialized = true;
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

    functionCall(args: FunctionCallArgs) {
        if (!this.isSupervisorInitialized)
            throw new Error(`Supervisor is not initialized`);
        const id = generateId();
        console.log(this.pendingRequests, "pending requests.");

        return new Promise((resolve, reject) => {
            this.pendingRequests.push({ id, resolve, reject });
            const iframe = document.getElementById(
                SupervisorIFrameId
            ) as HTMLIFrameElement;
            if (!iframe)
                throw new Error(`Failed to find supervisor-sys iframe`);
            if (!iframe.contentWindow)
                throw new Error(`Failed to access iframe contentWindow`);
            const message: FunctionCallRequest = {
                type: "FUNCTION_CALL_REQUEST",
                payload: {
                    id,
                    args,
                },
            };
            iframe.contentWindow.postMessage(message, "*");
        });
    }
}
