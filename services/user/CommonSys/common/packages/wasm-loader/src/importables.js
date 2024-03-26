const UNINITIALIZED = "uninitialized";

let callerService = UNINITIALIZED;
let callerOrigin = UNINITIALIZED;
let myService = UNINITIALIZED;
let myOrigin = UNINITIALIZED;

function pluginId(namespace, pkg) {
    return {
        service: namespace,
        plugin: pkg
    };
}

function commonErr(val) {
    return {
        code: 0,
        producer: pluginId("common", "plugin"),
        message: val
    };
}

function send(req) {
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
        if (xhr.status === 500) {
            throw commonErr(`${xhr.response}`);
        }
        const body = xhr.response || undefined;
        const headers = [];
        xhr.getAllResponseHeaders()
            .trim()
            .split(/[\r\n]+/)
            .forEach((line) => {
                var parts = line.split(": ");
                var key = parts.shift();
                var value = parts.join(": ");
                headers.push([key, value]);
            });
        return {
            status: xhr.status,
            headers,
            body
        };
    } catch (err) {
        throw new Error(err.message);
    }
}

function postGraphQL(url, graphql) {
    return send({
        uri: url,
        method: "POST",
        headers: {
            "Content-Type": "application/graphql"
        },
        body: graphql
    });
}

function isValidAction(s) {
    return /^[a-zA-Z0-9]+$/.test(s);
}

// This will be statically replaced
const actions = [];

function alreadyAdded(action, args) {
    let dupIndex = actions.findIndex((a) => a.action === action);
    if (dupIndex !== -1) {
        if (args !== actions[dupIndex].args) {
            throw new Error("Mismatched args");
        }
        return true;
    }
    return false;
}

export const server = {
    // add-action-to-transaction: func(service: string, action: string, args: list<u8>) -> result<_, string>;
    addActionToTransaction(action, args) {
        if (myService === UNINITIALIZED)
            throw commonErr("Error filling common:plugin imports.");
        else if (!isValidAction(action)) {
            throw commonErr(`Invalid action name: ${JSON.stringify(action)}`);
        }

        let strArgs = JSON.stringify(Array.from(args));
        let duplicate = false;
        try {
            duplicate = alreadyAdded(action, strArgs);
        } catch (e) {
            if (e instanceof Error && e.message === "Mismatched args") {
                throw commonErr(
                    "Attempted to add the same action (with different args) into a transaction."
                );
            }
        }

        if (duplicate) {
            return;
        } else {
            throw new Error(
                JSON.stringify({
                    type: "adding_action",
                    action,
                    args: strArgs
                })
            );
        }
    },
    // I think as long as groundhog day is a thing, we should only allow one of an action to be submitted
    // in a transaction, which will block anyone who tried to submit two actions (with different parameters).
    // This is because we can't distinguish from two genuinely different actions, and one action that uses
    // randomness for non-determininistic inputs between instances of groundhog day.

    postGraphqlGetJson(url, graphQL) {
        try {
            const res = postGraphQL(url, graphQL);
            return res.body;
        } catch (e) {
            if (e instanceof Error) {
                throw commonErr(`Query failed: ${e.message}`);
            }
            throw commonErr("GraphQL query failed.");
        }
    }
};

export const client = {
    //-> result<origination-data, error>;
    getSenderApp() {
        if (callerOrigin === UNINITIALIZED || callerService === UNINITIALIZED) {
            throw commonErr("Error filling common:plugin imports.");
        } else {
            return {
                app: callerService,
                origin: callerOrigin
            };
        }
    },

    //-> result<string, error>;
    myServiceAccount() {
        if (myService === UNINITIALIZED)
            throw CommonErr("Error filling common:plugin imports.");
        else return myService;
    },

    //-> result<string, error>;
    myServiceOrigin() {
        if (myOrigin === UNINITIALIZED)
            throw CommonErr("Error filling common:plugin imports.");
        else return myOrigin;
    }
};
