import {
  FunctionCallRequest,
  isFunctionCallRequest,
} from "../../../CommonSys/common/messaging/supervisor/FunctionCallRequest";
import {
  PluginCallResponse,
  isPluginCallResponse,
} from "../../../CommonSys/common/messaging/supervisor/PluginCallResponse";
import { buildMessageIFrameInitialized } from "./messaging/IFrameIntialized";
import { connectToChild } from "penpal";

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

interface PenpalObj {
  functionCall: (param: FunctionCallParam) => Promise<any>;
}

const loadedServices: { service: string; obj: PenpalObj }[] = [];

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

const getConnection = async (service: string): Promise<PenpalObj> => {
  // const existingService = loadedServices.find((s) => s.service === service);
  // if (existingService) return existingService.obj;
  const obj = await createIFrameService(service);
  console.log(obj, "is my iframe service");
  loadedServices.push({ service, obj });

  return obj;
};

const createIFrameService = async (service: string): Promise<PenpalObj> => {
  const iframe = document.createElement("iframe");
  iframe.src = getLoaderDomain(service);
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

  const connection = connectToChild({
    iframe,
    methods: {
      functionCall,
      addToTx,
      add: (a: number, b: number) => a + b,
    },
  });

  return connection.promise as unknown as Promise<PenpalObj>;
};

const addToTx = async (param: FunctionCallParam) => {
  console.log("supervisor addToTx", param);
  return param;
};

const functionCall = async (param: FunctionCallParam) => {
  console.log(
    "Received params on the supervisor, now passing to the loader...",
    param
  );

  const { service } = param;

  const connection = await getConnection(service);
  console.log(`Created / Fetched connection to ${service}`, connection);
  const res = await connection.functionCall(param);
  console.log(`Received ${res} from ${service} on Supervisor-Sys`);

  return {
    res,
    service,
  };
};

const onFunctionCallRequest = (message: FunctionCallRequest) => {
  // TODO Fulfill
  console.log(message);
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

console.log({ name });

initializeSupervisor();
