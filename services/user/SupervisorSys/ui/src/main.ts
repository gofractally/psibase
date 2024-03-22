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
    isErrorResult,
    QualifiedPluginId
} from "@psibase/common-lib/messaging";
import { LoaderPreloadComplete, buildPreloadStartMessage, isLoaderInitMessage, isPreloadCompleteMessage } from "@psibase/common-lib/messaging/supervisor/LoaderInitialized";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys here
  </div>
`;

const context = new CallContext();
const callStack = context.callStack;

const createLoaderDomain = (subDomain = "supervisor-sys") =>
    siblingUrl(null, subDomain) + "/common/wasm-loader";

const buildIFrameId = (service: string) => `iframe-${service}`;

interface PluginManagers {
    [service: string]: string[];
}
const autoArrayInit = {
    get: (target: PluginManagers, service: string): string[] => {
        if (!target[service]) {
            target[service] = [];
        }
        return target[service];
    }
};

const pluginManagers: PluginManagers = new Proxy({}, autoArrayInit);

const addPluginManager = (pluginId: QualifiedPluginId): boolean => {
    const {service, plugin} = pluginId;
    if (!pluginManagers[service].includes(plugin))
    {
        pluginManagers[service].push(plugin);
        return true;
    }
    return false;
};

const getOnLoaderInit = (frameInfo: FrameInfo, resolve: (value: HTMLIFrameElement | PromiseLike<HTMLIFrameElement>) => void) => {
    return (message: MessageEvent<any>) => {
        if (isLoaderInitMessage(message.data)) {
            // Is message from the right child?
            if (message.origin !== new URL(frameInfo.src).origin) return;

            const loader = document.getElementById(frameInfo.id) as HTMLIFrameElement;
            if (!(loader && loader.contentWindow)) {
                console.error(`${frameInfo.service} sent LOADER_INITIALIZED, but the loader is not ready to receive messages.`);
                return;
            }

            resolve(loader);
        }
    };
}

interface FrameInfo {
    id: string,
    service: string,
    src: string
}

const addIframe = (service: string) => {
    const iframe = document.createElement("iframe");
    iframe.id = buildIFrameId(service);
    iframe.src = createLoaderDomain(service);
    iframe.style.display = "none";

    let {readyState} = document;
    if (readyState === "complete" || readyState === "interactive") {
        document.body.appendChild(iframe);
    } else {
        document.addEventListener("DOMContentLoaded", () => {
            document.body.appendChild(iframe);
        });
    }

    return {id: iframe.id, service, src: iframe.src};
}

const getLoader = async (
    service: string
): Promise<HTMLIFrameElement> => {

    // Get loader if it exists
    const iFrameId = buildIFrameId(service);
    const loader = document.getElementById(iFrameId) as HTMLIFrameElement;
    if (loader) return loader;

    // Otherwise, create it
    let frameInfo = addIframe(service);

    return new Promise((resolve) => {
        // Only resolve this promise when we receive the LOADER_INITIALIZED message back
        window.addEventListener("message", getOnLoaderInit(frameInfo, resolve));
    });
};

const prepareServicePlugins = async (service: string, plugins: string[]) => {
    let loader = await getLoader(service);

    loader.contentWindow!.postMessage(
        buildPreloadStartMessage(plugins),
        siblingUrl(null, service)
    );
}

const sendPluginCallRequest = async (param: PluginCallPayload) => {
    const iframe = await getLoader(param.args.service);
    iframe.contentWindow?.postMessage(
        buildPluginCallRequest(param),
        siblingUrl(null, param.args.service)
    );

    let {service, plugin} = param.args;
    addPluginManager({service, plugin});
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
            `Plugin call resolution already in progress: ${toString(
                callStack.peekBottom()!.args
            )}`
        );
    }

    callStack.push({
        caller: new URL(origin).origin,
        args: message.args
    });
    processTop();

    // TODO: Consider if a plugin runs an infinite loop. We need a way to terminate the
    //   current callstack, and report the faulty plugin that never returned.
    //   And also if there's a request for IO, then the timer needs to be paused. IO has no timeout.
    //   If the popup is blocked, this is considered an error, but a special error code is returned to the
    //     application so it can instruct the user to enable popups. But since it's an error, cache is
    //     cleared and stack emptied.
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
            if (callStack.peek()!.caller == origin) {
                // If this happens, it's the secondary sync call notification that can happen.
                // It can be safely ignored. This check can be removed once this issue is 
                //   resolved: https://github.com/bytecodealliance/jco/issues/405 and the sync 
                //   call throw in the loader is moved from within the import to the catch handler.
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
        caller: new URL(origin).origin,
        args: message.payload
    });

    processTop();
};

const onPreloadPluginsRequest = async ({ payload }: PreLoadPluginsRequest): Promise<void> => {
    let {plugins} = payload;
    // Get all loaders
    await Promise.all(plugins.map((pluginId: QualifiedPluginId) => {
        return getLoader(pluginId.service);
    }));

    // Load plugins
    plugins.forEach(addPluginManager);

    for (const [service, plugins] of Object.entries(pluginManagers)) {
        prepareServicePlugins(service, plugins);
    }
};

const onPreloadComplete = async ({ payload: _payload }: LoaderPreloadComplete) => {
    // TODO: Use dependencies from the payload to DFS load other plugins
}

const isMessageFromApplication = (message: MessageEvent) => {
    const isTop = message.source == window.top;
    const isParent = message.source == window.parent;
    const isSameRootDomain =
        message.origin.endsWith(siblingUrl().slice("https://".length)) &&
        message.origin.startsWith("https://");
    return isTop && isParent && isSameRootDomain;
};

const isMessageFromChild = (message: MessageEvent): boolean => {
    const originIsChild = Object.entries(pluginManagers)
        .map(([service, _]) => siblingUrl(null, service))
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
            } else if (isPreloadCompleteMessage(message.data)) {
                onPreloadComplete(message.data);
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
