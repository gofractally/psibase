import { connectToParent, connectToChild } from "penpal";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    SupervisorSys
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

const isValidFunctionCallParam = (param: any): param is FunctionCallParam =>
  typeof param === "object" &&
  param !== null &&
  "service" in param &&
  "method" in param &&
  "params" in param;

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
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);

  console.log(
    "Received params on the supervisor, now passing to the loader...",
    param
  );

  const { service } = param;

  const connection = await getConnection(service);
  console.log(`Created / Fetched connection to ${service}`, connection);
  const res = await connection.functionCall(param);
  console.log(`Received ${res} from ${service}`);

  return {
    res,
    service,
  };
};

const getLoggedInUser = async () => "alice";

const connection = connectToParent({
  methods: {
    functionCall,
    addToTx,
    getLoggedInUser,
  },
});

connection.promise.then((parent) => {
  console.info("this one!");
  // @ts-ignore
  parent.add(3, 1).then((total) => console.log(total));
});

// Create an iframe with a source of https://app.psibase.io/plugin.html
// and append it to the DOM.
//
// For POC purposes we will include the plugin.html
// It will request the WASM component from https://app.psibase.io/plugin.wasm (Which needs to be manually uploaded for now for the POC)
// It also listens for window.postMessage through penpal, and it will transpile the wasm
// Listening for window.postMessage it will WASM.transfer('alice', 'bob', 3, 'tokens man!');
//

// Await the compiled WASM
// Just create a vanilla VITE and figure out how to transpile it in the vanilla world.
// Function is called `call` no params, returns a string

// npm create vite@latest App1 -- --template react-ts
// psibase -a http://psibase.127.0.0.1.sslip.io:8079 upload-tree psispace-sys / ./dist/ -S app2
