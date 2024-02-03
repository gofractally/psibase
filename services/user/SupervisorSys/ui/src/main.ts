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

interface Func {
  service: string;
  method: string;
}

export interface CachedFunction extends Func {
  params: string;
  result: any;
}

interface PenpalObj {
  functionCall: (
    param: FunctionCallParam,
    cachedFunction: CachedFunction[]
  ) => Promise<any>;
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
  // if (existingService) {
  //   console.log(`recycling existing service;`);
  //   return existingService.obj;
  // }
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
      pluginCall,
      add: (a: number, b: number) => a + b,
    },
  });

  return connection.promise as unknown as Promise<PenpalObj>;
};

const addToTx = async (param: FunctionCallParam) => {
  console.log("supervisor addToTx", param);
  return param;
};

type Result<T = any> = { tag: "Ok"; value: T } | { tag: "Loading" };

const cachedFunctions: CachedFunction[] = [];

const functionCall = async (
  param: FunctionCallParam,
  attempt = 0
): Promise<{ res: any; service: string }> => {
  console.log(cachedFunctions, "is cached functions on supervisor");
  if (!isValidFunctionCallParam(param))
    throw new Error(`Invalid function call param.`);

  console.log(
    "Received params on the supervisor, now passing to the loader...",
    param
  );

  const { service } = param;

  const connection = await getConnection(service);
  console.log(`Created / Fetched connection to ${service}`, connection);
  const res = (await connection.functionCall(param, cachedFunctions)) as Result;
  if (res.tag == "Loading") {
    const maxAttempts = 10;
    const isTooManyAttempts = attempt >= maxAttempts;
    if (isTooManyAttempts) {
      throw new Error(`Exceeded max attempts of ${maxAttempts}`);
    } else {
      return functionCall(param, attempt + 1);
    }
  } else if (res.tag == "Ok") {
    return {
      res: res.value,
      service,
    };
  } else {
    throw new Error(`Unrecognised tag returned`);
  }
};

const getLoggedInUser = async () => "alice";

const pluginCall = async (x: any) => {
  console.log(`PLUGINCALL GOT`, x);
  const res = await functionCall(x);
  console.log(`PLUGINCALL RETURNED`, res);
  cachedFunctions.push({ ...x, result: res.res });
};

const connection = connectToParent({
  methods: {
    functionCall,
    addToTx,
    getLoggedInUser,
  },
});

connection.promise.then((parent) => {
  parent
    // @ts-ignore
    .add(3, 1)
    // @ts-ignore
    .then((total) => console.log("Called add on parent and got: ", total));
});
