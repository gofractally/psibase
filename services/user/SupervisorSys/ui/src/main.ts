import { FunctionCallArgs } from "../../../CommonSys/common/messaging/supervisor";
import {
  FunctionCallRequest,
  buildMessageIFrameInitialized,
  PluginCallResponse,
  isFunctionCallRequest,
  isPluginCallResponse,
  generateRandomString,
  buildPluginCallRequest,
} from "@messaging";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys here
  </div>
`;

interface FunctionCallParam<T = any> {
  service: string;
  method: string;
  params: T;
}

// Connect spins up the supervisor iframe,
// The app sends a message to supervisor for app2,
// Supervisor spins up app2 in an iframe
// Sends a message to app2, app2 sends a message back to supervisor
// Supervisor sends a message back to app1

const getLoaderDomain = (subDomain = "supervisor-sys"): string => {
  const currentUrl = window.location.href;
  const url = new URL(currentUrl);
  const hostnameParts = url.hostname.split(".");

  hostnameParts.shift();
  hostnameParts.unshift(subDomain);
  url.hostname = hostnameParts.join(".");

  return url.origin + "/loader";
};

const buildIFrameId = (service: string) => `iframe-${service}`;

const initiateLoader = async (service: string): Promise<void> => {
  const iframe = document.createElement("iframe");
  iframe.src = getLoaderDomain(service);
  iframe.style.display = "none";
  iframe.id = buildIFrameId(service);

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

const sendPluginCallRequest = (param: FunctionCallRequest) => {
  const id = generateRandomString();
  const message = buildPluginCallRequest(id, param.payload.args);

  const iframe = document.getElementById(
    buildIFrameId(param.payload.args.service)
  );
  if (!iframe)
    throw new Error(
      `Failed to find iframe for service ${param.payload.args.service}`
    );
};

const addToTx = async (param: FunctionCallParam) => {
  console.log("supervisor addToTx", param);
  return param;
};

const onFunctionCallRequest = (message: FunctionCallRequest) => {
  // TODO Fulfill
  console.log(message);
  // Append to pending functioncalls
  addRootFunctionCall(message);
  sendPluginCallRequest();
};

const onPluginCallResponse = (message: PluginCallResponse) => {
  // TODO Fulfill
  console.log(message);
};

const onRawEvent = (message: MessageEvent<any>) => {
  console.log("Supervisor-sys Raw Event Received:", message);
  if (isFunctionCallRequest(message.data)) {
    // TODO Assert origin of supervisor-sys
    onFunctionCallRequest(message.data);
  } else if (isPluginCallResponse(message.data)) {
    // TODO Assert origin of plugin call
    onPluginCallResponse(message.data);
  }
};

addEventListener("message", onRawEvent);

const initializeSupervisor = () => {
  window.parent.postMessage(buildMessageIFrameInitialized(), "*");
};

initializeSupervisor();
