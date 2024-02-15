import {
  FunctionCallRequest,
  buildMessageIFrameInitialized,
  PluginCallResponse,
  isFunctionCallRequest,
  isPluginCallResponse,
  FunctionCallArgs,
  isPluginCallRequest,
  PluginCallRequest,
  PluginCallPayload,
  generateRandomString,
  buildPluginCallRequest,
  buildFunctionCallResponse,
} from "@messaging";

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

const getLoader = async (service: string): Promise<HTMLIFrameElement> => {
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
  from: string
) => {
  console.log(param, "was plugin call request to send x from", from);
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
    },
    "fun"
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

      sendPluginCallRequest(message, "checkfortrigger");
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

const onPluginCallRequest = (message: PluginCallRequest) => {
  const parentId = message.payload.id;
  const subId = generateRandomString();

  const addToPendingFunctionCall = (pendingCall: PendingFunctionCall) => {
    if (pendingCall.id == parentId) {
      pendingCall.nestedCalls.push({
        id: subId,
        args: message.payload.args,
        nestedCalls: [],
      });

      console.log(message.payload, pendingCall, "shouldnt be undefined");

      sendPluginCallRequest(
        {
          id: subId,
          args: message.payload.args,
          precomputedResults: [],
        },
        "add to pending function call"
      );
    }
    pendingCall.nestedCalls.forEach(addToPendingFunctionCall);
  };

  pendingFunctionCalls.forEach(addToPendingFunctionCall);
};

const onRawEvent = (message: MessageEvent<any>) => {
  if (isFunctionCallRequest(message.data)) {
    // TODO Assert origin of supervisor-sys
    onFunctionCallRequest(message.data);
  } else if (isPluginCallResponse(message.data)) {
    // TODO Assert origin of plugin call
    onPluginCallResponse(message.data);
  } else if (isPluginCallRequest(message.data)) {
    // TODO Assert origin of plugin call request
    onPluginCallRequest(message.data);
  }
};

addEventListener("message", onRawEvent);

const initializeSupervisor = () => {
  window.parent.postMessage(buildMessageIFrameInitialized(), "*");
};

initializeSupervisor();
