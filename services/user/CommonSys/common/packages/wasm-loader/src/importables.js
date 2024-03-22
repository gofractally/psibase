const UNINITIALIZED = "uninitialized";

const currentActions = [];
let callerService = UNINITIALIZED;
let callerOrigin = UNINITIALIZED;
let myService = UNINITIALIZED;
let myOrigin = UNINITIALIZED;

function isEqualUint8Array(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

function actionExists(service, action, args) {
  return currentActions.some(item => 
    item.service === service && 
    item.action === action && 
    isEqualUint8Array(item.args, args)
  );
}

function pluginId(namespace, pkg) {
  return {
      service: namespace,
      plugin: pkg,
  }
}

function commonErr(val) {
  return {
    code: 0,
    producer: pluginId("common", "plugin"),
    message: val,
  };
}

function send(req) {
  console.log(`[http] Send (browser) ${req.uri}`);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open(req.method.toString(), req.uri, false);
    const requestHeaders = new Headers(req.headers);
    for (let [name, value] of requestHeaders.entries()) {
      if (name !== "user-agent" && name !== "host") {
        xhr.setRequestHeader(name, value);
      }
    }
    xhr.send(req.body && req.body.length > 0 ? req.body : null);
    const body = xhr.response ? new TextEncoder().encode(xhr.response) : undefined;
    const headers = [];
    xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((line) => {
      var parts = line.split(': ');
      var key = parts.shift();
      var value = parts.join(': ');
      headers.push([key, value]);
    });
    return {
      status: xhr.status,
      headers,
      body,
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

function postGraphQL(url, graphql) {
  send({
    uri: url,
    method: "POST",
    headers: {
        "Content-Type": "application/graphql",
    },
    body: graphql,
  });
}


export const server = {
  // add-action-to-transaction: func(service: string, action: string, args: list<u8>) -> result<_, string>;
  addActionToTransaction(service, action, args) {
    // Todo - figure out how to return stuff
    // if (actionExists(service, action, args)) {
    //   return "action already exists";
    // } else {
      currentActions.push({service, action, args});
    //return;
    //}
  },

  postGraphqlGetJson(url, graphQL)
  {
    try {
      const res = postGraphQL(url, graphQL);
    }
    catch (e) {
      if (e instanceof Error) {
        throw commonErr(`Query failed: ${e.message}`);
      }
      throw commonErr("GraphQL query failed.");
    }

    return res.json();
  }
}

export const client = {
  //-> result<origination-data, error>;
  getSenderApp() {
    if (callerOrigin === UNINITIALIZED ||
        callerService === UNINITIALIZED) {
          throw commonErr("Error filling common:plugin imports.");
    } else {
      return {
        app: callerService,
        origin: callerOrigin,
      };
    }
  },

  //-> result<string, error>;
  myServiceAccount() {
    if (myService === UNINITIALIZED)
      throw CommonErr("Error filling common:plugin imports.");
    else
      return myService;
  },

  //-> result<string, error>;
  myServiceOrigin() {
    if (myOrigin === UNINITIALIZED)
      throw CommonErr("Error filling common:plugin imports.");
    else
      return myOrigin;
  }
}


