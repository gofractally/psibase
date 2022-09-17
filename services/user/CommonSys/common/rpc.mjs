import {
    privateStringToKeyPair,
    publicKeyPairToFracpack,
    signatureToFracpack,
} from "/common/keyConversions.mjs";
import hashJs from "https://cdn.skypack.dev/hash.js";

let rootDomain = "";

export async function getRootDomain() {
    if (rootDomain) {
        return rootDomain;
    } else {
        rootDomain = await getJson("/common/rootdomain");
        return rootDomain;
    }
}

export async function siblingUrl(baseUrl, service, path) {
    const rootDomain = await getRootDomain();

    let loc;
    if (!baseUrl) loc = location;
    else loc = new URL(baseUrl);
    return (
        loc.protocol +
        "//" +
        (service ? service + "." : "") +
        rootDomain +
        ":" +
        loc.port +
        "/" +
        (path || "").replace(/^\/+/, "")
    );
}
export class RPCError extends Error {
    constructor(message, trace) {
        super(message);
        this.trace = trace;
    }
}

export async function throwIfError(response) {
    if (!response.ok) throw new RPCError(await response.text());
    return response;
}

export async function get(url, options = {}) {
    return await throwIfError(await fetch(url, { ...options, method: "GET" }));
}

export async function getText(url) {
    return await (await get(url)).text();
}

export async function getJson(url) {
    return await (
        await get(url, { headers: { Accept: "application/json" } })
    ).json();
}

export async function postText(url, text) {
    return await throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "text",
            },
            body: text,
        })
    );
}

export async function postGraphQL(url, graphql) {
    return await throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/graphql",
            },
            body: graphql,
        })
    );
}

export async function postJson(url, json) {
    return await throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(json),
        })
    );
}

export async function postArrayBuffer(url, arrayBuffer) {
    return await throwIfError(
        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
            },
            body: arrayBuffer,
        })
    );
}

export async function postTextGetJson(url, text) {
    return await (await postText(url, text)).json();
}

export async function postGraphQLGetJson(url, graphQL) {
    return await (await postGraphQL(url, graphQL)).json();
}

export async function postJsonGetJson(url, json) {
    return await (await postJson(url, json)).json();
}

export async function postJsonGetText(url, json) {
    return await (await postJson(url, json)).text();
}

export async function postJsonGetArrayBuffer(url, json) {
    return await (await postJson(url, json)).arrayBuffer();
}

export async function postArrayBufferGetJson(url, arrayBuffer) {
    return await (await postArrayBuffer(url, arrayBuffer)).json();
}

export async function getTaposForHeadBlock(baseUrl = "") {
    return await getJson(baseUrl.replace(/\/+$/, "") + "/common/tapos/head");
}

export async function packAction(baseUrl, action) {
    let { sender, service, method, data, rawData } = action;
    if (!rawData) {
        rawData = uint8ArrayToHex(
            new Uint8Array(
                await postJsonGetArrayBuffer(
                    await siblingUrl(
                        baseUrl,
                        service,
                        "/pack_action/" + method
                    ),
                    data
                )
            )
        );
    }
    return { sender, service, method, rawData };
}

export async function packActions(baseUrl, actions) {
    return await Promise.all(
        actions.map((action) => packAction(baseUrl, action))
    );
}

export async function packTransaction(baseUrl, transaction) {
    return await postJsonGetArrayBuffer(
        baseUrl.replace(/\/+$/, "") + "/common/pack/Transaction",
        {
            ...transaction,
            actions: await packActions(baseUrl, transaction.actions),
        }
    );
}

export async function packSignedTransaction(baseUrl, signedTransaction) {
    if (typeof signedTransaction.transaction !== "string")
        signedTransaction = {
            ...signedTransaction,
            transaction: uint8ArrayToHex(
                new Uint8Array(
                    await packTransaction(
                        baseUrl,
                        signedTransaction.transaction
                    )
                )
            ),
        };
    return await postJsonGetArrayBuffer(
        baseUrl.replace(/\/+$/, "") + "/common/pack/SignedTransaction",
        signedTransaction
    );
}

export async function pushPackedSignedTransaction(baseUrl, packed) {
    const trace = await postArrayBufferGetJson(
        baseUrl.replace(/\/+$/, "") + "/native/push_transaction",
        packed
    );
    if (trace.error) throw new RPCError(trace.error, trace);
    return trace;
}

export async function packAndPushSignedTransaction(baseUrl, signedTransaction) {
    return await pushPackedSignedTransaction(
        baseUrl,
        await packSignedTransaction(baseUrl, signedTransaction)
    );
}

export async function signTransaction(baseUrl, transaction, privateKeys) {
    const keys = (privateKeys || []).map((k) => {
        if (typeof k === "string") return privateStringToKeyPair(k);
        else return k;
    });
    const claims = keys.map((k) => ({
        service: "verifyec-sys",
        rawData: uint8ArrayToHex(publicKeyPairToFracpack(k)),
    }));
    transaction = new Uint8Array(
        await packTransaction(baseUrl, { ...transaction, claims })
    );
    const digest = new hashJs.sha256().update(transaction).digest();
    const proofs = keys.map((k) =>
        uint8ArrayToHex(
            signatureToFracpack({
                keyType: k.keyType,
                signature: k.keyPair.sign(digest),
            })
        )
    );
    return { transaction: uint8ArrayToHex(transaction), proofs };
}

/**
 * Description: Signs and pushes a transaction object to the baseUrl endpoint
 *
 * @param {String} baseUrl - The URL endpoint to which to push the signed transaction
 * @param {Object} transaction - A JSON object that follows the transaction schema to define a collection of actions to execute
 * @param {Array} privateKeys - An array of strings that represent private keys used to sign this transaction
 */
export async function signAndPushTransaction(
    baseUrl,
    transaction,
    privateKeys
) {
    return await packAndPushSignedTransaction(
        baseUrl,
        await signTransaction(baseUrl, transaction, privateKeys)
    );
}

export function uint8ArrayToHex(data) {
    let result = "";
    for (const x of data) result += ("00" + x.toString(16)).slice(-2);
    return result.toUpperCase();
}

export function hexToUint8Array(hex) {
    if (typeof hex !== "string")
        throw new Error("Expected string containing hex digits");
    if (hex.length % 2) throw new Error("Odd number of hex digits");
    const l = hex.length / 2;
    const result = new Uint8Array(l);
    for (let i = 0; i < l; ++i) {
        const x = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(x)) throw new Error("Expected hex string");
        result[i] = x;
    }
    return result;
}

export const ErrorCodes = {
    invalidResource: 404,
    serverError: 500,
};

export const ErrorMessages = [
    {
        code: ErrorCodes.invalidResource,
        message: "Error 404: Resource not found",
    },
    {
        code: ErrorCodes.serverError,
        message: "Error 500: Server error, possibly incorrect transaction data",
    },
];

export const MessageTypes = {
    Action: "Action", // An action send to an on-chain application
    Query: "Query", // A query to another client-side applet, expect a response
    Operation: "Operation", // A procedure which can include multiple other queries, actions, and operations
    QueryResponse: "QueryResponse", // A response to a prior query
    OperationResponse: "OperationResponse",
};

export class AppletId {
    constructor(appletName, subPath = "") {
        this.name = appletName;
        this.subPath = subPath;
    }

    get fullPath() {
        let suffix = this.subPath !== "" ? "/" + this.subPath : "";
        return this.name + suffix;
    }

    equals(appletId) {
        return this.name === appletId.name && this.subPath === appletId.subPath;
    }

    async url() {
        return await siblingUrl(null, this.name, this.subPath);
    }

    static fromFullPath(fullPath) {
        const startOfSubpath = fullPath.indexOf("/");
        let subPath =
            startOfSubpath !== -1 ? fullPath.substring(startOfSubpath) : "";
        let applet =
            startOfSubpath !== -1
                ? fullPath.substring(0, startOfSubpath)
                : fullPath;
        return new this(applet, subPath);
    }

    static fromObject(obj) {
        return new this(obj.name, obj.subPath);
    }
}

var ops = []; // Operations defined by an applet

var qrs = []; // Queries defined by an applet

var queryCallbacks = []; // Callbacks automatically generated for responding to queries

export function storeCallback(callback) {
    let callbackId = queryCallbacks.length;
    queryCallbacks.push({ callbackId, callback });
    return callbackId;
}

var promises = [];
export function storePromise(resolve, reject) {
    let callbackId = promises.length;
    promises.push({ callbackId, resolve, reject });
    return callbackId;
}

export function executeCallback(callbackId, response) {
    const cb = queryCallbacks.find((q) => q.callbackId === callbackId);

    if (!cb) {
        console.error("Callback with ID " + callbackId + " not found.");
        return false;
    }

    try {
        cb.callback(response);
    } catch (e) {
        console.error("Error calling callback with ID " + callbackId, e);
    }
    // Remove the callback to flag it was executed
    delete cb.callback;
    return true;
}

export function executePromise(callbackId, response, errors) {
    const promise = promises.find((q) => q.callbackId === callbackId);
    if (!promise) {
        console.error("Promise with ID " + callbackId + " not found.");
        return false;
    }

    if (errors.length > 0) promise.reject(errors);
    else promise.resolve(response);

    return true;
}

async function sendToParent(message) {
    let sendMessage = async () => {
        parentIFrame.sendMessage(message, await siblingUrl(null, null, null));
    };

    if ("parentIFrame" in window) {
        sendMessage();
    } else {
        console.log("Message queued");
        bufferedMessages.push(sendMessage);
    }
}

let redirectIfAccessedDirectly = async () => {
    try {
        if (window.self === window.top) {
            // We are the top window. Redirect needed.
            const applet = window.location.hostname.substring(
                0,
                window.location.hostname.indexOf(".")
            );
            window.location.replace(
                await siblingUrl(null, "", "/applet/" + applet)
            );
        }
    } catch (e) {
        // The browser blocked access to window.top due to the same origin policy,
        //   therefore we are in an iframe, all is well.
    }
};

export function verifyFields(obj, fieldNames) {
    var missingField = false;

    fieldNames.forEach((fieldName) => {
        if (!obj.hasOwnProperty(fieldName)) {
            missingField = true;
        }
    });

    return !missingField;
}

let handleErrorCode = (code) => {
    if (code === undefined) return false;

    let recognizedError = ErrorMessages.some((err) => {
        if (err.code === code) {
            console.error(err.message);
            return true;
        }
        return false;
    });
    if (!recognizedError)
        console.error(
            "Message from core contains unrecognized error code: " + error
        );

    return true;
};

var contractName = "";
export async function getContractName() {
    if (contractName !== "") {
        return contractName;
    } else {
        contractName = await getJson("/common/thisservice");
        return contractName;
    }
}

let messageRouting = [
    {
        type: MessageTypes.Operation,
        fields: ["identifier", "params", "callbackId"],
        route: async (payload) => {
            let { identifier, params, callbackId } = payload;
            let responsePayload = { callbackId, response: null, errors: [] };
            let contractName = await getContractName();
            let op = ops.find((o) => o.id === identifier);
            var errors = [];
            if (op === undefined) {
                responsePayload.errors.push(
                    "Service " +
                        contractName +
                        ' has no operation, "' +
                        identifier +
                        '"'
                );
            } else {
                try {
                    let res = await op.exec(params);
                    if (res !== undefined) responsePayload.response = res;
                } catch (e) {
                    responsePayload.errors.push(e);
                }
            }

            sendToParent({
                type: MessageTypes.OperationResponse,
                payload: responsePayload,
            });

            return true;
        },
    },
    {
        type: MessageTypes.Query,
        fields: ["identifier", "params", "callbackId"],
        route: async (payload) => {
            let { identifier, params, callbackId } = payload;
            let responsePayload = { callbackId, response: null, errors: [] };

            try {
                let contractName = await getContractName();
                let qu = qrs.find((q) => q.id === identifier);
                if (qu === undefined) {
                    responsePayload.errors.push(
                        "Service " +
                            contractName +
                            ' has no query, "' +
                            identifier +
                            '"'
                    );
                } else {
                    try {
                        responsePayload.response = await qu.exec(params);
                    } catch (e) {
                        responsePayload.errors.push(e);
                    }
                }
            } catch (e) {
                console.error("fail to process query message", e);
                responsePayload.errors.push(e);
            }

            sendToParent({
                type: MessageTypes.QueryResponse,
                payload: responsePayload,
            });
        },
    },
    {
        type: MessageTypes.QueryResponse,
        fields: ["callbackId", "response", "errors"],
        route: (payload) => {
            let { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
    {
        type: MessageTypes.OperationResponse,
        fields: ["callbackId", "response", "errors"],
        route: (payload) => {
            let { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
];

let bufferedMessages = [];

export async function initializeApplet(initializer = () => {}) {
    await redirectIfAccessedDirectly();

    let rootUrl = await siblingUrl(null, null, null);
    window.iFrameResizer = {
        targetOrigin: rootUrl,
        onReady: async () => {
            for (const bufferedMessage of bufferedMessages) {
                await bufferedMessage();
            }
            bufferedMessages = [];
        },
        onMessage: (msg) => {
            let { type, payload } = msg;
            if (type === undefined || payload === undefined) {
                console.error("Malformed message received from core");
                return;
            }

            let route = messageRouting.find((m) => m.type === type);
            if (route === undefined) {
                console.error("Message from core specifies unknown route.");
                return;
            }

            if (!verifyFields(payload, route.fields)) {
                console.error("Message from core failed validation checks");
                return;
            }

            if (handleErrorCode(payload.error)) return;

            route.route(payload);
        },
    };

    await import("/common/iframeResizer.contentWindow.js");

    await initializer();
}

function set({ targetArray, newElements }, caller) {
    let valid = newElements.every((e) => {
        if (!verifyFields(e, ["id", "exec"])) {
            return false;
        }
        return true;
    });

    if (!valid) {
        console.error(
            caller + ': All elements must have "id" and "exec" properties'
        );
        return;
    }

    if (targetArray.length === 0) targetArray.push(...newElements);
    else {
        valid = newElements.every((e) => {
            if (targetArray.find((t) => t.id === e.id)) return false;
            else return true;
        });
        if (!valid) {
            console.error(caller + ": Same element defined twice.");
            return;
        }
        targetArray.push(...newElements);
    }
}

/**
 * Description: Sets the operations supported by this applet.
 * Call this from within the initialization function provided to initializeApplet.
 */
export function setOperations(operations) {
    set({ targetArray: ops, newElements: operations }, "setOperations");
}

/**
 * Description: Sets the queries supported by this applet.
 * Call this from within the initialization function provided to initializeApplet.
 */
export function setQueries(queries) {
    set({ targetArray: qrs, newElements: queries }, "setQueries");
}

/**
 * Description: Runs the specified operation
 *
 * @param {AppletId} appletId - An instance of AppletId that identifies the applet that handles the specified operation.
 * @param {String} name - The name of the operation to run.
 * @param {Object} params - The object containing all parameters expected by the operation handler.
 */
export function operation(appletId, name, params = {}) {
    const operationPromise = new Promise((resolve, reject) => {
        // Will leave memory hanging if we don't get a response as expected
        let callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Operation,
            payload: { callbackId, appletId, name, params },
        });
    });

    return operationPromise;
}

/**
 * Description: Calls the specified action on the blockchain
 *
 * @param {String} application - The name of the application that defines the action.
 * @param {String} actionName - The name of the action being called.
 * @param {Object} params - The object containing all parameters expected by the action.
 * @param {String} sender - Optional parameter to explicitly specify a sender. If no sender is provided,
 *  the currently logged in user is assumed to be the sender.
 */
export function action(application, actionName, params, sender = null) {
    sendToParent({
        type: MessageTypes.Action,
        payload: { application, actionName, params, sender },
    });
}

/**
 * Description: Calls the specified query on another applet.
 * Returns a promise that resolves with the result of the query.
 *
 * @param {AppletId} appletId - An instance of AppletId that identifies the applet that handles the specified query.
 * @param {String} name - The name of the query being executed.
 * @param {Object} params - The object containing all parameters expected by the query handler.
 */
export function query(appletId, name, params = {}) {
    const queryPromise = new Promise((resolve, reject) => {
        // Will leave memory hanging if we don't get a response as expected
        let callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Query,
            payload: { callbackId, appletId, name, params },
        });
    });

    return queryPromise;
}
