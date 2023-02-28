import {
    privateStringToKeyPair,
    publicKeyPairToFracpack,
    signatureToFracpack,
} from "/common/keyConversions.mjs";
import hashJs from "https://cdn.skypack.dev/hash.js";

/** Global Values */
let rootDomain = "";
let contractName = "";

// Operations and Queries defined by an applet
const registeredOperations = [];
const registeredQueries = [];

const bufferedMessages = [];

// Callbacks automatically generated for responding to queries and ops
// Initialized with an anchor element on pos 0, to initialize ids at 1 and ease comparisons
const callbacks = [null];
const promises = [null];
const transactions = {};

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

    const loc = !baseUrl ? location : new URL(baseUrl);

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
    if (!response.ok) {
        throw new RPCError(await response.text());
    }
    return response;
}

export async function get(url, options = {}) {
    const res = await fetch(url, { ...options, method: "GET" });
    return throwIfError(res);
}

export async function getText(url) {
    const res = await get(url);
    return res.text();
}

export async function getJson(url) {
    const res = await get(url, { headers: { Accept: "application/json" } });
    return res.json();
}

export async function postText(url, text) {
    return throwIfError(
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
    return throwIfError(
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
    return throwIfError(
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
    return throwIfError(
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
    const res = await postText(url, text);
    return res.json();
}

export async function postGraphQLGetJson(url, graphQL) {
    const res = await postGraphQL(url, graphQL);
    return res.json();
}

export async function postJsonGetJson(url, json) {
    const res = await postJson(url, json);
    return res.json();
}

export async function postJsonGetText(url, json) {
    const res = await postJson(url, json);
    return res.text();
}

export async function postJsonGetArrayBuffer(url, json) {
    const res = await postJson(url, json);
    return res.arrayBuffer();
}

export async function postArrayBufferGetJson(url, arrayBuffer) {
    const res = await postArrayBuffer(url, arrayBuffer);
    return res.json();
}

export async function getTaposForHeadBlock(baseUrl = "") {
    const url = baseUrl.replace(/\/+$/, "") + "/common/tapos/head";
    return getJson(url);
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

export async function packAndDigestTransaction(baseUrl, transaction) {
    const packedBytes = new Uint8Array(
        await packTransaction(baseUrl, transaction)
    );
    const digest = new hashJs.sha256().update(packedBytes).digest();
    return { transactionHex: uint8ArrayToHex(packedBytes), digest };
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
    const signedTransaction = uint8ArrayToHex(transaction);
    const result = { transaction: signedTransaction, proofs };
    return result;
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
    try {
        console.log("Signing transaction...", {
            baseUrl,
            transaction,
            privateKeys,
        });
        const signedTransaction = await signTransaction(
            baseUrl,
            transaction,
            privateKeys
        );
        console.log("Successfully signed transaction", { signedTransaction });

        try {
            console.log("Pushing transaction...");
            const pushedTransaction = await packAndPushSignedTransaction(
                baseUrl,
                signedTransaction
            );
            console.log("Transaction pushed!", { pushedTransaction });
            return pushedTransaction;
        } catch (e) {
            console.error("Failed pushing transaction", e);
            throw new Error(e);
        }
    } catch (e) {
        console.error("Failed signing transaction", e);
        throw new Error(e);
    }
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
    TransactionReceipt: "TransactionReceipt",
    SetActiveAccount: "SetActiveAccount",
    ChangeHistory: "ChangeHistory", // Fired when the applet history changes
};

export class AppletId {
    constructor(appletName, subPath = "") {
        this.name = appletName;
        this.subPath = subPath;
    }

    toString() {
        return this.fullPath;
    }

    get fullPath() {
        const suffix = this.subPath !== "" ? "/" + this.subPath : "";
        return this.name + suffix;
    }

    equals(appletId) {
        return this.name === appletId.name && this.subPath === appletId.subPath;
    }

    url() {
        return siblingUrl(null, this.name, this.subPath);
    }

    static fromFullPath(fullPath) {
        const startOfSubpath = fullPath.indexOf("/");
        const subPath =
            startOfSubpath !== -1 ? fullPath.substring(startOfSubpath) : "";
        const applet =
            startOfSubpath !== -1
                ? fullPath.substring(0, startOfSubpath)
                : fullPath;
        return new this(applet, subPath);
    }

    static fromObject(obj) {
        return new this(obj.name, obj.subPath);
    }
}

export function storeCallback(callback) {
    const callbackId = callbacks.length;
    callbacks.push({ callbackId, callback });
    return callbackId;
}

export function storePromise(resolve, reject) {
    const callbackId = promises.length;
    promises.push({ callbackId, resolve, reject });
    return callbackId;
}

export function executeCallback(callbackId, response) {
    const cb = callbacks[callbackId];

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
    const promise = promises[callbackId];
    if (!promise) {
        console.error("Promise with ID " + callbackId + " not found.");
        return false;
    }

    if (errors && errors.length > 0) {
        promise.reject(errors);
    } else {
        promise.resolve(response);
    }
    // Remove the promise fns to flag it was executed
    delete promise.resolve;
    delete promise.reject;
    return true;
}

function sendToParent(message) {
    const sendMessage = async () => {
        parentIFrame.sendMessage(message, await siblingUrl(null, null, null));
    };

    if ("parentIFrame" in window) {
        sendMessage();
    } else {
        console.log("Message queued");
        bufferedMessages.push(sendMessage);
    }
}

const redirectIfAccessedDirectly = async () => {
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
    let missingField = false;

    fieldNames.forEach((fieldName) => {
        if (!obj.hasOwnProperty(fieldName)) {
            missingField = true;
        }
    });

    return !missingField;
}

const handleErrorCode = (code) => {
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

export async function getContractName() {
    if (contractName) {
        return contractName;
    } else {
        contractName = await getJson("/common/thisservice");
        return contractName;
    }
}

const messageRouting = [
    {
        type: MessageTypes.Operation,
        fields: ["identifier", "params", "callbackId"],
        route: async (payload) => {
            const { identifier, params, callbackId } = payload;
            const responsePayload = { callbackId, response: null, errors: [] };
            const contractName = await getContractName();
            const op = registeredOperations.find((o) => o.id === identifier);
            if (op) {
                try {
                    const res = await op.exec(params);
                    if (res !== undefined) responsePayload.response = res;
                } catch (e) {
                    responsePayload.errors.push(e);
                }
            } else {
                responsePayload.errors.push(
                    `Service ${contractName} has no operation "${identifier}"`
                );
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
            const { identifier, params, callbackId } = payload;
            const responsePayload = { callbackId, response: null, errors: [] };

            try {
                const contractName = await getContractName();
                const query = registeredQueries.find(
                    (q) => q.id === identifier
                );
                if (query) {
                    try {
                        responsePayload.response = await query.exec(params);
                    } catch (e) {
                        responsePayload.errors.push(e);
                    }
                } else {
                    responsePayload.errors.push(
                        `Service ${contractName} has no query "${identifier}"`
                    );
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
            const { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
    {
        type: MessageTypes.OperationResponse,
        fields: ["callbackId", "response", "errors"],
        route: (payload) => {
            const { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
    {
        type: MessageTypes.TransactionReceipt,
        fields: ["transactionId", "trace", "errors"],
        route: (payload) => {
            const { transactionId, trace, errors } = payload;
            const callbackId = transactions[transactionId];
            return callbackId
                ? executePromise(callbackId, trace, errors)
                : false;
        },
    },
];

export async function initializeApplet(initializer = () => {}) {
    await redirectIfAccessedDirectly();

    const rootUrl = await siblingUrl(null, null, null);
    window.iFrameResizer = {
        targetOrigin: rootUrl,
        onReady: async () => {
            for (const bufferedMessage of bufferedMessages) {
                await bufferedMessage();
            }
            bufferedMessages.splice(0, bufferedMessages.length);
        },
        onMessage: (msg) => {
            let { type, payload } = msg;
            if (type === undefined || payload === undefined) {
                console.error("Malformed message received from core");
                return;
            }

            const route = messageRouting.find((m) => m.type === type);
            if (!route) {
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

    console.info("setting up applet event listeners popstate");
    let currentHref = document.location.href;
    const body = document.querySelector("body");
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(() => {
            if (currentHref !== document.location.href) {
                console.info(">>> observed href mutation");
                sendHistoryChange();
                currentHref = document.location.href;
            }
        });
    });
    observer.observe(body, { childList: true, subtree: true });

    // required to detect back button
    window.onpopstate = (_event) => {
        if (currentHref !== document.location.href) {
            console.info(">>> observed popstate href mutation");
            sendHistoryChange();
            currentHref = document.location.href;
        }
    };

    await initializer();
}

const sendHistoryChange = () => {
    const { pathname, href, search } = document.location;
    console.info("sending change history message", {
        href,
        pathname,
        search,
    });
    sendToParent({
        type: MessageTypes.ChangeHistory,
        payload: { href, pathname, search },
    });
};

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
    set(
        { targetArray: registeredOperations, newElements: operations },
        "setOperations"
    );
}

/**
 * Description: Sets the queries supported by this applet.
 * Call this from within the initialization function provided to initializeApplet.
 */
export function setQueries(queries) {
    set({ targetArray: registeredQueries, newElements: queries }, "setQueries");
}

/**
 * Description: Runs the specified operation
 *
 * @param {AppletId} appletId - An instance of AppletId that identifies the applet that handles the specified operation.
 * @param {String} name - The name of the operation to run.
 * @param {Object} params - The object containing all parameters expected by the operation handler.
 */
export async function operation(appletId, name, params = {}) {
    const operationPromise = new Promise((resolve, reject) => {
        // Will leave memory hanging if we don't get a response as expected
        const callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Operation,
            payload: { callbackId, appletId, name, params },
        });
    });

    const operationRes = await operationPromise;

    let transactionSubmittedPromise;
    if (operationRes.transactionId) {
        transactionSubmittedPromise = new Promise((resolve, reject) => {
            const callbackId = storePromise(resolve, reject);
            transactions[operationRes.transactionId] = callbackId;
        });
    }

    return { ...operationRes, transactionSubmittedPromise };
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
        const callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Query,
            payload: { callbackId, appletId, name, params },
        });
    });

    return queryPromise;
}

const OPERATIONS_KEY = "OPERATIONS_KEY";
const QUERIES_KEY = "QUERIES_KEY";

/**
 * Description: Class to blueprint the applets contract + operations.
 */
export class Service {
    cachedApplet = "";

    constructor() {
        this.applet();
    }

    async applet() {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson("/common/thisservice");
        this.cachedApplet = appletName;
        return appletName;
    }

    async getAppletName() {
        return this.applet();
    }

    async getAppletId() {
        const appletName = await this.getAppletName();
        return new AppletId(appletName);
    }

    get operations() {
        return this[OPERATIONS_KEY] || [];
    }

    get queries() {
        return this[QUERIES_KEY] || [];
    }
}

export function Action(target, key, descriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args) {
        const result = originalMethod.apply(this, args);
        const parent = Object.getPrototypeOf(this);
        return parent
            .getAppletName()
            .then((appletName) => action(appletName, key, result));
    };
}

/**
 * Description: @Op Operation decorator which helps build { id: .., exec: () => ..}
 *
 *
 * @param {String} name - The optional id of the operation, will otherwise default to the method name.
 */
export function Op(name) {
    return function (target, key, descriptor) {
        const id = name ? name : key;
        const op = {
            exec: descriptor.value.bind(target),
            id,
        };
        const isExistingArray = OPERATIONS_KEY in target;
        if (isExistingArray) {
            target[OPERATIONS_KEY].push(op);
        } else {
            target[OPERATIONS_KEY] = [op];
        }

        descriptor.value = function (...args) {
            const parent =
                "getAppletId" in Object.getPrototypeOf(this)
                    ? Object.getPrototypeOf(this)
                    : Object.getPrototypeOf(Object.getPrototypeOf(this));
            return parent
                .getAppletId()
                .then((appletId) => operation(appletId, id, ...args));
        };
    };
}

/**
 * Description: @Qry Query decorator which helps build { id: .., exec: () => ..}
 *
 *
 * @param {String} name - The optional id of the query, will otherwise default to the method name.
 */
export function Qry(name) {
    return function (target, key, descriptor) {
        const id = name ? name : key;
        const op = {
            exec: descriptor.value.bind(target),
            id,
        };
        const isExistingArray = QUERIES_KEY in target;
        if (isExistingArray) {
            target[QUERIES_KEY].push(op);
        } else {
            target[QUERIES_KEY] = [op];
        }

        descriptor.value = function (...args) {
            const parent =
                "getAppletId" in Object.getPrototypeOf(this)
                    ? Object.getPrototypeOf(this)
                    : Object.getPrototypeOf(Object.getPrototypeOf(this));
            return parent
                .getAppletId()
                .then((appletId) => query(appletId, id, ...args));
        };
    };
}

/**
 * Description: Notifies CommonSys of a change in active account. Callable only by AccountSys.
 * TODO: AccountSys should emit an event once we have a proper event system. Remove setActiveAccount then.
 *
 * @param {String} account - The name of the active account.
 */
export function setActiveAccount(account) {
    sendToParent({
        type: MessageTypes.SetActiveAccount,
        payload: { account },
    });
}
