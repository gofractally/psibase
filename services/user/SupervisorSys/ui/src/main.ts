import {
  FunctionCallRequest,
  buildMessageIFrameInitialized,
  PluginCallResponse,
  isFunctionCallRequest,
  isPluginCallResponse,
  FunctionCallArgs,
  PluginCallPayload,
  generateRandomString,
  buildPluginCallRequest,
  buildFunctionCallResponse,
  isPreLoadServicesRequest,
  PreLoadServicesRequest,
  isPluginCallFailure,
  PluginCallFailure,
  FunctionCallResult,
} from "@psibase/common-lib/messaging";

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

interface PendingFunctionCall<T = any> {
  id: string;
  args: FunctionCallArgs;
  result?: T;
  nestedCalls: PendingFunctionCall[];
}

let pendingFunctionCalls: PendingFunctionCall[] = [];

const addRootFunctionCall = (message: FunctionCallRequest) => {
  const idAlreadyExists = pendingFunctionCalls.some(
    (call) => call.id == message.payload.id
  );
  if (idAlreadyExists)
    throw new Error(
      `Cannot create new pending function call, ID ${message.payload.id} already exists`
    );

  pendingFunctionCalls.push({
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
  iframe.contentWindow?.postMessage(buildPluginCallRequest(param), "*");
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

const sendFunctionCallResponse = (id: string, response: any) => {
  window.parent.postMessage(buildFunctionCallResponse(id, response), "*");
};

const checkForResolution = () => {
  const checkForTrigger = (funCall: PendingFunctionCall): void => {
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
          method: args.method,
          params: args.params,
          result,
        })),
      };

      sendPluginCallRequest(message);
    }
    funCall.nestedCalls.forEach(checkForTrigger);
  };
  pendingFunctionCalls
    .filter((x) => typeof x.result !== undefined)
    .forEach(checkForTrigger);

  const toSend = pendingFunctionCalls.filter((call) => !!call.result);
  toSend.forEach(({ id, result }) => {
    sendFunctionCallResponse(id, result);
  });
  pendingFunctionCalls = pendingFunctionCalls.filter(
    (funcCall) => !toSend.some((x) => x.id == funcCall.id)
  );
};

const onPluginCallResponse = (message: PluginCallResponse) => {
  const id = message.payload.id;
  const updateFunctionCall = (funCall: PendingFunctionCall): void => {
    if (funCall.id == id) {
      funCall.result = message.payload.result;
    } else {
      funCall.nestedCalls.forEach(updateFunctionCall);
    }
  };

  pendingFunctionCalls.forEach(updateFunctionCall);
  checkForResolution();
};

const updatePendingFunctionCall = <T>(
  array: PendingFunctionCall<T>[],
  targetId: string,
  updateFunction: (call: PendingFunctionCall<T>) => PendingFunctionCall<T>
): PendingFunctionCall<T>[] => {
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
  calls: PendingFunctionCall<T>[],
  targetId: string
): PendingFunctionCall<T> | undefined => {
  const foundCall = calls.find(
    (call: PendingFunctionCall<T>) => call.id === targetId
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
  const toExecute = findFunctionCallById(pendingFunctionCalls, id);
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
            method: x.args.method,
            service: x.args.service,
            params: x.args.params,
            result: undefined,
          })
        ),
    }
  );
};

const onPluginCallFailure = (message: PluginCallFailure) => {
  const { id, method, params, service } = message.payload;
  const subId = generateRandomString();

  pendingFunctionCalls = updatePendingFunctionCall(
    pendingFunctionCalls,
    id,
    (pending): PendingFunctionCall => {
      const nestedCalls: PendingFunctionCall[] = [
        ...pending.nestedCalls,
        {
          args: {
            method,
            params,
            service,
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

const onPreloadServicesRequest = ({
  payload
}: PreLoadServicesRequest): void => {
  payload.services.forEach(getLoader);
    payload.services.forEach(getLoader);
};

const generateSubdomain = (subDomain?: string): string => {
  const currentUrl = new URL(window.location.href);
  const hostnameParts = currentUrl.hostname.split(".");

  hostnameParts.shift();
  if (subDomain) {
      hostnameParts.unshift(subDomain);
  }
  currentUrl.hostname = hostnameParts.join(".");

  return currentUrl.origin;
};

const isMessageFromApplication = (message: MessageEvent) => {
  const isTop = message.source == window.top;
  const isParent = message.source == window.parent;
  const isSameRootDomain =
      message.origin.endsWith(generateSubdomain().slice("https://".length)) &&
      message.origin.startsWith("https://");
  return isTop && isParent && isSameRootDomain;
};

const isMessageFromChild = (message: MessageEvent): boolean => {
  const originIsChild = loadedServices
      .map(generateSubdomain)
      .includes(message.origin);
  const isTop = message.source == window.top;
  const isParent = message.source == window.parent;
  return originIsChild && !isTop && !isParent;
};

const onRawEvent = (message: MessageEvent<any>) => {
  if (isMessageFromApplication(message)) {
      if (isFunctionCallRequest(message.data)) {
          onFunctionCallRequest(message.data);
      } else if (isPreLoadServicesRequest(message.data)) {
          onPreloadServicesRequest(message.data);
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