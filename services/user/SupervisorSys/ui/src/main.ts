import {
  FunctionCallRequest,
  buildMessageIFrameInitialized,
  PluginCallResponse,
  isFunctionCallRequest,
  isPluginCallResponse,
  QualifiedFunctionCallArgs,
  PluginCallPayload,
  generateRandomString,
  buildPluginCallRequest,
  buildFunctionCallResponse,
  isPreLoadPluginsRequest,
  PreLoadPluginsRequest,
  isPluginCallFailure,
  PluginCallFailure,
  FunctionCallResult,
} from "@psibase/common-lib/messaging";
import { siblingUrl } from '@psibase/common-lib'

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys here
  </div>
`;

// Connect spins up the supervisor iframe,
// The app sends a message to supervisor for app2,
// Supervisor spins up app2 in an iframe
// Sends a message to app2, app2 sends a message back to supervisor
// Supervisor sends a message back to app1

const extractSubdomain = (urlString: string): string => {
  const url = new URL(urlString);

  const hostnameParts = url.hostname.split(".");

  if (hostnameParts.length >= 3) {
    return hostnameParts[0];
  }

  throw new Error(`Failed parsing sub-domain in ${urlString}`);
};

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
      if (event.data.type == "LOADER_INITIALIZED") {
        const service = extractSubdomain(event.origin);
        console.log(`✨ Successfully booted loader for service "${service}"`);
        const loader = document.getElementById(iFrameId) as HTMLIFrameElement;
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

interface CallStack<T = any> {
  id: string;
  args: QualifiedFunctionCallArgs;
  result?: T;
  nestedCalls: CallStack[];
}

let callStack: CallStack[] = [];

const addRootFunctionCall = (message: FunctionCallRequest) => {
  const idAlreadyExists = callStack.some(
    (call) => call.id == message.payload.id
  );
  if (idAlreadyExists)
    throw new Error(
      `Cannot create new pending function call, ID ${message.payload.id} already exists`
    );

  callStack.push({
    id: message.payload.id,
    args: message.payload.args,
    nestedCalls: [],
    result: undefined,
  });
};

const sendPluginCallRequest = async (
  param: PluginCallPayload,
) => {
  if (param.args == undefined) {
    throw new Error(`No args received on sendPluginCallRequest`);
  }
  const iframe = await getLoader(param.args.service);
  iframe.contentWindow?.postMessage(buildPluginCallRequest(param), siblingUrl(null, param.args.service));
};

const onFunctionCallRequest = (message: FunctionCallRequest) => {
  addRootFunctionCall(message);
  sendPluginCallRequest(
    {
      id: message.payload.id,
      args: message.payload.args,
      precomputedResults: [],
    }
  );
};

let rootApplicationOrigin: string;

const setApplicationOrigin = (origin: string) => {
  if (origin && !rootApplicationOrigin) {
    rootApplicationOrigin = origin;
  }
}

const sendFunctionCallResponse = (id: string, response: any) => {
  if (!rootApplicationOrigin) throw new Error(`Cannot send function call response when root application origin is not yet tracked.`)
  window.parent.postMessage(buildFunctionCallResponse(id, response), rootApplicationOrigin);
};

const checkForResolution = () => {
  const checkForTrigger = (funCall: CallStack): void => {
    const isAllSettledWithNoResult =
      funCall.nestedCalls.every((call) => typeof call.result !== undefined) &&
      !funCall.result;
    if (isAllSettledWithNoResult) {
      const message = {
        id: funCall.id,
        args: funCall.args,
        precomputedResults: funCall.nestedCalls.map(({ id, args, result }) => ({
          id,
          service: args.service,
          plugin: args.plugin,
          intf: args.intf,
          method: args.method,
          params: args.params,
          result,
        })),
      };

      sendPluginCallRequest(message);
    }
    funCall.nestedCalls.forEach(checkForTrigger);
  };
  callStack
    .filter((x) => typeof x.result !== undefined)
    .forEach(checkForTrigger);

  const toSend = callStack.filter((call) => !!call.result);
  toSend.forEach(({ id, result }) => {
    sendFunctionCallResponse(id, result);
  });
  callStack = callStack.filter(
    (funcCall) => !toSend.some((x) => x.id == funcCall.id)
  );
};

const onPluginCallResponse = (message: PluginCallResponse) => {
  const id = message.payload.id;
  const updateFunctionCall = (funCall: CallStack): void => {
    if (funCall.id == id) {
      funCall.result = message.payload.result;
    } else {
      funCall.nestedCalls.forEach(updateFunctionCall);
    }
  };

  callStack.forEach(updateFunctionCall);
  checkForResolution();
};

const updatePendingFunctionCall = <T>(
  array: CallStack<T>[],
  targetId: string,
  updateFunction: (call: CallStack<T>) => CallStack<T>
): CallStack<T>[] => {
  let idFound = false;
  const updatedArray = array.map((call) =>
    call.id === targetId
      ? ((idFound = true), updateFunction(call))
      : {
          ...call,
          nestedCalls: updatePendingFunctionCall(
            call.nestedCalls,
            targetId,
            updateFunction
          ),
        }
  );

  if (!idFound) {
    throw new Error(`ID '${targetId}' not found in the array.`);
  }

  return updatedArray;
};

const findFunctionCallById = <T>(
  calls: CallStack<T>[],
  targetId: string
): CallStack<T> | undefined => {
  const foundCall = calls.find(
    (call: CallStack<T>) => call.id === targetId
  );

  if (foundCall) {
    return foundCall;
  }

  for (const call of calls) {
    const nestedResult = findFunctionCallById(call.nestedCalls, targetId);
    if (nestedResult) {
      return nestedResult;
    }
  }
};

const executeCall = (id: string) => {
  const toExecute = findFunctionCallById(callStack, id);
  if (!toExecute) throw new Error(`Failed to find function call ID: ${id}`);

  sendPluginCallRequest(
    {
      args: toExecute.args,
      id,
      precomputedResults: toExecute.nestedCalls
        .filter((x) => !!x.result)
        .map(
          (x): FunctionCallResult => ({
            id: x.id,
            service: x.args.service,
            plugin: x.args.plugin,
            intf: x.args.intf,
            method: x.args.method,
            params: x.args.params,
            result: undefined,
          })
        ),
    }
  );
};

const onPluginCallFailure = (message: PluginCallFailure) => {
  const { id, service, plugin, intf, method, params } = message.payload;

  console.log(`Synchronous call detected: ${service}:${plugin}/${intf}->${method}`);

  const subId = generateRandomString();

  callStack = updatePendingFunctionCall(
    callStack,
    id,
    (pending): CallStack => {
      const nestedCalls: CallStack[] = [
        ...pending.nestedCalls,
        {
          args: {
            service,
            plugin,
            intf,
            method,
            params,
          },
          id: subId,
          nestedCalls: [],
          result: undefined,
        },
      ];

      return {
        ...pending,
        nestedCalls,
      };
    }
  );

  executeCall(subId);
};

const onPreloadPluginsRequest = ({
  payload,
}: PreLoadPluginsRequest): void => {
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
      .map(service => siblingUrl(null, service))
      .includes(message.origin);
  const isTop = message.source == window.top;
  const isParent = message.source == window.parent;
  return originIsChild && !isTop && !isParent;
};

const onRawEvent = (message: MessageEvent<any>) => {
  if (isMessageFromApplication(message)) {
      setApplicationOrigin(message.origin);
      if (isFunctionCallRequest(message.data)) {
          onFunctionCallRequest(message.data);
      } else if (isPreLoadPluginsRequest(message.data)) {
          onPreloadPluginsRequest(message.data);
      }
  } else if (isMessageFromChild(message)) {
      if (isPluginCallResponse(message.data)) {
          onPluginCallResponse(message.data);
      } else if (isPluginCallFailure(message.data)) {
          onPluginCallFailure(message.data);
      }
  }
};

addEventListener("message", onRawEvent);

const initializeSupervisor = () => {
  window.parent.postMessage(buildMessageIFrameInitialized(), "*");
};

initializeSupervisor();