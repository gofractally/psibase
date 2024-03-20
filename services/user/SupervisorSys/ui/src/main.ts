import { siblingUrl } from "@psibase/common-lib";
import {
    FunctionCallRequest,
    buildMessageIFrameInitialized,
    PluginCallResponse,
    isFunctionCallRequest,
    isPluginCallResponse,
    PluginCallPayload,
    buildPluginCallRequest,
    buildFunctionCallResponse,
    isPreLoadPluginsRequest,
    PreLoadPluginsRequest,
    isPluginSyncCall,
    PluginSyncCall,
    CallContext,
    toString,
    isErrorResult
} from "@psibase/common-lib/messaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys here
  </div>
`;

const context = new CallContext();
const callStack = context.callStack;

const createBaseDomain = (subDomain = "supervisor-sys"): string => {
    const currentUrl = window.location.href;
    const url = new URL(currentUrl);
    const hostnameParts = url.hostname.split(".");

    hostnameParts.shift();
    hostnameParts.unshift(subDomain);
    url.hostname = hostnameParts.join(".");

    return url.origin;
};

const createLoaderDomain = (subDomain = "supervisor-sys") =>
    createBaseDomain(subDomain) + "/common/wasm-loader";

const buildIFrameId = (service: string) => `iframe-${service}`;

const loadedServices: string[] = [];

const upsertLoadedService = (service: string) => {
    if (loadedServices.includes(service)) return;
    loadedServices.push(service);
};

const getLoader = async (service: string): Promise<HTMLIFrameElement> => {
    upsertLoadedService(service);
    const iFrameId = buildIFrameId(service);
    const loader = document.getElementById(iFrameId) as HTMLIFrameElement;
    if (loader) return loader;

    const iframe = document.createElement("iframe");
    iframe.id = iFrameId;
    iframe.src = createLoaderDomain(service);
    iframe.style.display = "none";

    return new Promise((resolve) => {
        window.addEventListener("message", (event) => {
            // TODO: Check that the origin of this message is from a subdomain for which
            //   a loader request was made.
            if (event.data.type == "LOADER_INITIALIZED") {
                const loader = document.getElementById(
                    iFrameId
                ) as HTMLIFrameElement;
                resolve(loader);
                // TODO: send the loader the list of preloaded plugins so it can prepare them
            }
        });

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
    });
};

const sendPluginCallRequest = async (param: PluginCallPayload) => {
    const iframe = await getLoader(param.args.service);
    iframe.contentWindow?.postMessage(
        buildPluginCallRequest(param),
        siblingUrl(null, param.args.service)
    );
};

const processTop = () => {
    if (callStack.isEmpty()) return;
    let { caller, args } = callStack.peek()!;

    let resultCache = context.getCachedResults(args.service, args.plugin);

    sendPluginCallRequest({
        caller,
        args,
        resultCache
    });
};

const onFunctionCallRequest = (
    origin: string,
    message: FunctionCallRequest
) => {
    if (!callStack.isEmpty()) {
        throw Error(
            `Plugin call resolution already in progress: ${toString(callStack.peekBottom()!.args)}`
        );
    }

    let caller = new URL(origin).hostname;
    callStack.push({
        caller,
        args: message.args
    });
    processTop();

    // TODO: Consider if an unhandled exception happens in the loader,
    //   or if a plugin runs an infinite loop. We need a way to terminate the current callstack,
    //   and report the faulty plugin that never returned.
    // And also if there's a request for IO, then the timer needs to be paused. IO has no timeout.
    // If the popup is blocked, this is considered an error, but a special error code is returned to the
    //   application so it can instruct the user to enable popups. But since it's an error, cache is
    //   cleared and stack emptied.
};

// TODO - move callstack management into the context class, then the root app origin can be
// automatically handled in there.
const setApplicationOrigin = (origin: string) => {
    if (origin && !context.rootAppOrigin) {
        context.rootAppOrigin = origin;
    }
};

const verifyOriginOnTopOfStack = (origin: string) => {
    if (!callStack.isEmpty()) {
        let expectedHost = siblingUrl(null, callStack.peek()!.args.service);
        if (expectedHost != origin) {
            if (callStack.peek()!.caller == origin) 
            {   // This is the error that follows most sync calls. Swallow.
                console.log("TODO: remove me. Swallowing error following sync call.");
            }
            throw Error(
                `Plugins may only send messages when they are on top of the call stack.`
            );
        }
    } else {
        throw Error(
            `Plugin messages may only be processed when the call stack is non-empty.`
        );
    }
};

const isUnrecoverableError = (result: any) => {
    return isErrorResult(result) && result.errorType === "unrecoverable";
};

const onPluginCallResponse = (origin: string, message: PluginCallResponse) => {
    if (!context.rootAppOrigin)
        throw new Error(`Plugin responded to unknown root application origin.`);

    verifyOriginOnTopOfStack(origin);

    let returningCall = callStack.pop()!;

    if (callStack.isEmpty() || isUnrecoverableError(message.result)) {
        window.parent.postMessage(
            buildFunctionCallResponse(returningCall.args, message.result),
            context.rootAppOrigin
        );
        context.reset();
    } else {
        let topFrame = callStack.peek()!;
        let {
            service: callService,
            plugin: callPlugin,
            intf: callIntf,
            method: callMethod
        } = returningCall.args;

        context.addCacheObject({
            allowedService: topFrame.args.service,
            callService,
            callPlugin,
            callIntf,
            callMethod,
            args_json: JSON.stringify(returningCall.args.params),
            result: message.result
        });

        processTop();
    }
};

const onPluginSyncCall = (origin: string, message: PluginSyncCall) => {
    verifyOriginOnTopOfStack(origin);

    callStack.push({
        caller: new URL(origin).hostname,
        args: message.payload
    });

    processTop();
};

const onPreloadPluginsRequest = ({ payload }: PreLoadPluginsRequest): void => {
    payload.services.forEach(getLoader);
};

const isMessageFromApplication = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSameRootDomain =
        message.origin.endsWith(siblingUrl().slice("https://".length)) &&
        message.origin.startsWith("https://");
    return isTop && isParent && isSameRootDomain;
};

const isMessageFromChild = (message: MessageEvent): boolean => {
    const originIsChild = loadedServices
        .map((service) => siblingUrl(null, service))
        .includes(message.origin);
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    return originIsChild && !isTop && !isParent;
};

const onRawEvent = (message: MessageEvent<any>) => {
    try {
        if (isMessageFromApplication(message)) {
            setApplicationOrigin(message.origin);
            if (isFunctionCallRequest(message.data)) {
                onFunctionCallRequest(message.origin, message.data);
            } else if (isPreLoadPluginsRequest(message.data)) {
                onPreloadPluginsRequest(message.data);
            }
        } else if (isMessageFromChild(message)) {
            if (isPluginCallResponse(message.data)) {
                onPluginCallResponse(message.origin, message.data);
            } else if (isPluginSyncCall(message.data)) {
                onPluginSyncCall(message.origin, message.data);
            } 
        }
    } catch (e) {
        console.error(`Error in supervisor: ${e}`);
        context.reset();
    }
};

addEventListener("message", onRawEvent);

const initializeSupervisor = () => {
    window.parent.postMessage(buildMessageIFrameInitialized(), "*");
};

initializeSupervisor();
