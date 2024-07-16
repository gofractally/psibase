function pluginId(namespace, pkg) {
    return {
        service: namespace,
        plugin: pkg,
    };
}

function commonErr(val) {
    return {
        code: 0,
        producer: pluginId("common", "plugin"),
        message: val,
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
            return commonErr(`${xhr.response}`);
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
            body,
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
            "Content-Type": "application/graphql",
        },
        body: graphql,
    });
}

function isValidAction(s) {
    return /^[a-zA-Z0-9]+$/.test(s);
}

export const server = {
    // add-action-to-transaction: func(service: string, action: string, args: list<u8>) -> result<_, string>;
    addActionToTransaction(action, args) {
        if (!isValidAction(action)) {
            return CommonErr(`Invalid action name: ${JSON.stringify(action)}`);
        }

        host.addAction({
            service: host.getSelf().app,
            action,
            args: Uint8Array.from(args),
        });
    },

    postGraphqlGetJson(graphQL) {
        try {
            const res = postGraphQL(`${host.getSelf().origin}/graphql`, graphQL);
            return res.body;
        } catch (e) {
            if (e instanceof Error) {
                return CommonErr(`Query failed: ${e.message}`);
            }
            return CommonErr("GraphQL query failed.");
        }
    },
};

export const client = {
    //->result<origination-data, error>;
    getSenderApp() {
        const caller = host.getCaller();
        if (caller === undefined)
            return CommonErr("Error determining caller");
        return caller;
    },

    //-> result<string, error>;
    myServiceAccount() {
        const acc = host.getSelf().app;
        if (acc === undefined)
            return CommonErr("Error determining self app");
        return acc;
    },

    //-> result<string, error>;
    myServiceOrigin() {
        return host.getSelf().origin;
    },
};
