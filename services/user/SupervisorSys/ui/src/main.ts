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

// Example usage
const url = "https://account-sys.psibase.127.0.0.1.sslip.io:8080";
const subdomain = extractSubdomain(url);

console.log(subdomain); // Output: account-sys

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
  createBaseDomain(subDomain) + "/loader";

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
      console.log("EEEE", event);
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

interface PendingFunctionCall<T = any | undefined> {
  id: string;
  args: FunctionCallArgs;
  result: T;
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

const sendPluginCallRequest = async (param: PluginCallPayload) => {
  const iframe = await getLoader(param.args.service);
  iframe.contentWindow?.postMessage(param, "*");
};

const onFunctionCallRequest = (message: FunctionCallRequest) => {
  console.log("onFunctionCallRequest:", message);
  // Append to pending functioncalls
  addRootFunctionCall(message);
  sendPluginCallRequest({
    id: message.payload.id,
    args: message.payload.args,
    precomputedResults: [],
  });
};

const checkForResolution = () => {
  const checkForTrigger = (funCall: PendingFunctionCall): void => {
    const isAllSettled = funCall.nestedCalls.every(
      (call) => typeof call.result !== undefined
    );
    if (isAllSettled) {
      sendPluginCallRequest({
        id: funCall.id,
        args: funCall.args,
        precomputedResults: funCall.nestedCalls.map(({ id, args, result }) => ({
          id,
          service: args.service,
          method: args.method,
          params: args.params,
          result,
        })),
      });
    }
    funCall.nestedCalls.forEach(checkForTrigger);
  };
  pendingFunctionCalls.forEach(checkForTrigger);
};

const onPluginCallResponse = (message: PluginCallResponse) => {
  // TODO Fulfill
  console.log(message);
  // update the pre-cached data...

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
  console.log(message, "plugin call request, yet to be fulfilled...");
  // create a new id for this request and put it in the nest.

  const parentId = message.payload.id;
  const subId = generateRandomString();
  pendingFunctionCalls.forEach((call) => {});
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
