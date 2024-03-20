// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
//        NOT FUNCTIONAL YET
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

const currentActions = [];
let callerService = "uninitialized";
let callerDomain = "uninitialized";
let myDomain = "uninitialized";
let myService = "uninitialized";

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

  // post-graphql-get-json: func(url: string, data: string) -> result<string, string>;
  postGraphqlGetJson(url, graphQL)
  {
    const res = postGraphQL(url, graphQL);
    return res.json();
  }
}

export const client = {
  senderAppServiceAccount() {
    return callerService;
  },
  senderAppDomain() {
    return callerDomain;
  },
  myServiceAccount() {
    return myService;
  },
  myServiceDomain() {
    return myDomain;
  }
}

// interface client {
//   use types.{origination-data};
//   get-sender-app: func() -> result<origination-data, string>;
//   get-root-domain: func() -> result<string, string>;
//   get-service-name: func() -> result<string, string>;
// }
