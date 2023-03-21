import {
    privateStringToKeyPair,
    publicKeyPairToFracpack,
    signatureToFracpack,
} from "./keyConversions";
import hashJs from "hash.js";

export class RPCError extends Error {
    trace: any;

    constructor(message: any, trace?: any) {
        super(message);
        this.trace = trace;
    }
}

/** Global Values */
let rootDomain = "";
let contractName = "";

// Operations and Queries defined by an applet
const registeredOperations: any[] = [];
const registeredQueries: any[] = [];

const bufferedMessages: any[] = [];

// Callbacks automatically generated for responding to queries and ops
// Initialized with an anchor element on pos 0, to initialize ids at 1 and ease comparisons
const callbacks: any[] = [null];
const promises: any[] = [null];
const transactions: any = {};

export async function getRootDomain() {
    if (rootDomain) {
        return rootDomain;
    } else {
        rootDomain = await getJson("/common/rootdomain");
        return rootDomain;
    }
}

export async function siblingUrl(
    baseUrl?: string,
    service?: string,
    path?: string
): Promise<string> {
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

export async function throwIfError(response: Response) {
    if (!response.ok) {
        throw new RPCError(await response.text());
    }
    return response;
}

export async function get(url: string, options = {}) {
    const res = await fetch(url, { ...options, method: "GET" });
    return throwIfError(res);
}

export async function getText(url: string) {
    const res = await get(url);
    return res.text();
}

export async function getJson<T = any>(url: string): Promise<T> {
    const res = await get(url, { headers: { Accept: "application/json" } });
    return res.json();
}

export async function postText(url: string, text: string) {
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

export async function postGraphQL(url: string, graphql: string) {
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

export async function postJson(url: string, json: any) {
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

export async function postArrayBuffer(url: string, arrayBuffer: any) {
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

export async function postTextGetJson(url: string, text: string) {
    const res = await postText(url, text);
    return res.json();
}

export async function postGraphQLGetJson<T = any>(
    url: string,
    graphQL: string
): Promise<T> {
    const res = await postGraphQL(url, graphQL);
    return res.json();
}

export async function postJsonGetJson(url: string, json: any) {
    const res = await postJson(url, json);
    return res.json();
}

export async function postJsonGetText(url: string, json: any) {
    const res = await postJson(url, json);
    return res.text();
}

export async function postJsonGetArrayBuffer(url: string, json: any) {
    const res = await postJson(url, json);
    return res.arrayBuffer();
}

export async function postArrayBufferGetJson(url: string, arrayBuffer: any) {
    const res = await postArrayBuffer(url, arrayBuffer);
    return res.json();
}

export async function getTaposForHeadBlock(baseUrl = "") {
    const url = baseUrl.replace(/\/+$/, "") + "/common/tapos/head";
    return getJson(url);
}

export async function packAction(baseUrl: string, action: any) {
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

export async function packActions(baseUrl: string, actions: any[]) {
    return await Promise.all(
        actions.map((action) => packAction(baseUrl, action))
    );
}

export async function packTransaction(baseUrl: string, transaction: any) {
    return await postJsonGetArrayBuffer(
        baseUrl.replace(/\/+$/, "") + "/common/pack/Transaction",
        {
            ...transaction,
            actions: await packActions(baseUrl, transaction.actions),
        }
    );
}

export async function packAndDigestTransaction(
    baseUrl: string,
    transaction: any
) {
    const packedBytes = new Uint8Array(
        await packTransaction(baseUrl, transaction)
    );
    const digest = new (hashJs as any).sha256().update(packedBytes).digest();
    return { transactionHex: uint8ArrayToHex(packedBytes), digest };
}

export async function packSignedTransaction(
    baseUrl: string,
    signedTransaction: any
) {
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

export async function pushPackedSignedTransaction(
    baseUrl: string,
    packed: any
) {
    const trace = await postArrayBufferGetJson(
        baseUrl.replace(/\/+$/, "") + "/native/push_transaction",
        packed
    );
    if (trace.error) throw new RPCError(trace.error, trace);
    return trace;
}

export async function packAndPushSignedTransaction(
    baseUrl: string,
    signedTransaction: any
) {
    return await pushPackedSignedTransaction(
        baseUrl,
        await packSignedTransaction(baseUrl, signedTransaction)
    );
}

export async function signTransaction(
    baseUrl: string,
    transaction: any,
    privateKeys: string[]
) {
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
    const digest = new (hashJs as any).sha256().update(transaction).digest();
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
    baseUrl: string,
    transaction: any,
    privateKeys: string[]
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
        } catch (e: any) {
            console.error("Failed pushing transaction", e);
            throw new Error(e);
        }
    } catch (e: any) {
        console.error("Failed signing transaction", e);
        throw new Error(e);
    }
}

export function uint8ArrayToHex(data: Uint8Array) {
    let result = "";
    for (const x of data) result += ("00" + x.toString(16)).slice(-2);
    return result.toUpperCase();
}

export function hexToUint8Array(hex: string) {
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
    name: string;
    subPath: string;

    constructor(appletName: string, subPath = "") {
        this.name = appletName;
        this.subPath = subPath;
    }

    toString() {
        return this.fullPath;
    }

    get fullPath() {
        const suffix =
            this.subPath && this.subPath !== ""
                ? this.subPath.startsWith("/")
                    ? this.subPath
                    : "/" + this.subPath
                : "";
        return this.name + suffix;
    }

    equals(appletId: AppletId) {
        return this.name === appletId.name && this.subPath === appletId.subPath;
    }

    url() {
        return siblingUrl(undefined, this.name, this.subPath);
    }

    static fromFullPath(fullPath: string) {
        const startOfSubpath = fullPath.indexOf("/");
        const subPath =
            startOfSubpath !== -1 ? fullPath.substring(startOfSubpath) : "";
        const applet =
            startOfSubpath !== -1
                ? fullPath.substring(0, startOfSubpath)
                : fullPath;
        return new this(applet, subPath);
    }

    static fromObject(obj: any) {
        return new this(obj.name, obj.subPath);
    }
}

type Operation = { id: string; exec: (params: any) => Promise<void> };

type CallbackResponse = {
    sender: AppletId;
    response: any;
    errors: any;
};

export function storeCallback(callback: (res: CallbackResponse) => unknown) {
    const callbackId = callbacks.length;
    callbacks.push({ callbackId, callback });
    return callbackId;
}

export function storePromise(resolve: any, reject: any) {
    const callbackId = promises.length;
    promises.push({ callbackId, resolve, reject });
    return callbackId;
}

export function executeCallback(callbackId: any, response: CallbackResponse) {
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

export function executePromise(callbackId: any, response: any, errors: any) {
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

function sendToParent(message: any) {
    const sendMessage = async () => {
        (window as any).parentIFrame.sendMessage(
            message,
            await siblingUrl(undefined, undefined, undefined)
        );
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
            const appletUrl = await siblingUrl(
                undefined,
                "",
                "/applet/" + applet
            );
            const appletUrlFull =
                appletUrl +
                (window.location.search || "") +
                (window.location.hash || "");
            window.location.replace(appletUrlFull);
        }
    } catch (e) {
        // The browser blocked access to window.top due to the same origin policy,
        //   therefore we are in an iframe, all is well.
    }
};

export function verifyFields(obj: any, fieldNames: string[]) {
    let missingField = false;

    fieldNames.forEach((fieldName) => {
        if (!obj.hasOwnProperty(fieldName)) {
            missingField = true;
        }
    });

    return !missingField;
}

const handleErrorCode = (code: any) => {
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
            "Message from core contains unrecognized error code: " + code
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
        fields: ["identifier", "params", "callbackId", "sender"],
        route: async (payload: any) => {
            const { identifier, params, callbackId, sender } = payload;
            const responsePayload = {
                callbackId,
                response: null,
                errors: [] as any[],
            };
            const contractName = await getContractName();
            const op = registeredOperations.find((o) => o.id === identifier);
            if (op) {
                try {
                    const msgMetadata = { sender };
                    const res = await op.exec(params, msgMetadata);
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
        fields: ["identifier", "params", "callbackId", "sender"],
        route: async (payload: any) => {
            const { identifier, params, callbackId, sender } = payload;
            const responsePayload = {
                callbackId,
                response: null,
                errors: [] as any[],
            };

            try {
                const contractName = await getContractName();
                const query = registeredQueries.find(
                    (q) => q.id === identifier
                );
                if (query) {
                    try {
                        const msgMetadata = { sender };
                        responsePayload.response = await query.exec(
                            params,
                            msgMetadata
                        );
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
        route: (payload: any) => {
            const { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
    {
        type: MessageTypes.OperationResponse,
        fields: ["callbackId", "response", "errors"],
        route: (payload: any) => {
            const { callbackId, response, errors } = payload;
            return executePromise(callbackId, response, errors);
        },
    },
    {
        type: MessageTypes.TransactionReceipt,
        fields: ["transactionId", "trace", "errors"],
        route: (payload: any) => {
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

    const rootUrl = await siblingUrl(undefined, undefined, undefined);
    (window as any).iFrameResizer = {
        targetOrigin: rootUrl,
        onReady: async () => {
            for (const bufferedMessage of bufferedMessages) {
                await bufferedMessage();
            }
            bufferedMessages.splice(0, bufferedMessages.length);
        },
        onMessage: (msg: any) => {
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

    console.info("loading contentwindow");
    // @ts-ignore
    await import("/common/iframeResizer.contentWindow.js");
    console.info("contentwindow loaded!!!!!!");

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
    observer.observe(body!, { childList: true, subtree: true });

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

function set({ targetArray, newElements }: any, caller: any) {
    let valid = newElements.every((e: any) => {
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
        valid = newElements.every((e: any) => {
            if (targetArray.find((t: any) => t.id === e.id)) return false;
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
export function setOperations(operations: Operation[]) {
    set(
        { targetArray: registeredOperations, newElements: operations },
        "setOperations"
    );
}

/**
 * Description: Sets the queries supported by this applet.
 * Call this from within the initialization function provided to initializeApplet.
 */
export function setQueries(queries: any[]) {
    set({ targetArray: registeredQueries, newElements: queries }, "setQueries");
}

/**
 * Description: Runs the specified operation
 *
 * @param {AppletId} appletId - An instance of AppletId that identifies the applet that handles the specified operation.
 * @param {String} name - The name of the operation to run.
 * @param {Object} params - The object containing all parameters expected by the operation handler.
 */
export async function operation<Params>(
    appletId: AppletId,
    name: string,
    params = {} as Params
) {
    const operationPromise = new Promise((resolve, reject) => {
        // Will leave memory hanging if we don't get a response as expected
        const callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Operation,
            payload: { callbackId, appletId, name, params },
        });
    });

    const operationRes: any = await operationPromise;

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
export function action<ActionParams>(
    application: string,
    actionName: string,
    params: ActionParams,
    sender = null
) {
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
export function query<Params, Response>(
    appletId: AppletId,
    name: string,
    params = {} as Params
): Promise<Response> {
    const queryPromise = new Promise((resolve, reject) => {
        // Will leave memory hanging if we don't get a response as expected
        const callbackId = storePromise(resolve, reject);

        sendToParent({
            type: MessageTypes.Query,
            payload: { callbackId, appletId, name, params },
        });
    });

    return queryPromise as Promise<Response>;
}

const OPERATIONS_KEY = "OPERATIONS_KEY";
const QUERIES_KEY = "QUERIES_KEY";

/**
 * Description: Class to blueprint the applets contract + operations.
 */
export class Service {
    cachedApplet = "";
    OPERATIONS_KEY: any[] = [];
    QUERIES_KEY: any[] = [];

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

export function Action(_target: any, key: string, descriptor: any) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any) {
        const result = originalMethod.apply(this, args);
        const parent = Object.getPrototypeOf(this);
        return parent
            .getAppletName()
            .then((appletName: string) => action(appletName, key, result));
    };
}

/**
 * Description: @Op Operation decorator which helps build { id: .., exec: () => ..}
 *
 *
 * @param {String} name - The optional id of the operation, will otherwise default to the method name.
 */
export function Op(name?: string) {
    return function (target: any, key: string, descriptor: any) {
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

        descriptor.value = function (...args: any) {
            const parent =
                "getAppletId" in Object.getPrototypeOf(this)
                    ? Object.getPrototypeOf(this)
                    : Object.getPrototypeOf(Object.getPrototypeOf(this));
            return parent
                .getAppletId()
                .then((appletId: AppletId) => operation(appletId, id, ...args));
        };
    };
}

/**
 * Description: @Qry Query decorator which helps build { id: .., exec: () => ..}
 *
 *
 * @param {String} name - The optional id of the query, will otherwise default to the method name.
 */
export function Qry(name?: string) {
    return function (target: any, key: string, descriptor: any) {
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

        descriptor.value = function (...args: any) {
            const parent =
                "getAppletId" in Object.getPrototypeOf(this)
                    ? Object.getPrototypeOf(this)
                    : Object.getPrototypeOf(Object.getPrototypeOf(this));
            return parent
                .getAppletId()
                .then((appletId: AppletId) => query(appletId, id, ...args));
        };
    };
}

/**
 * Description: Notifies CommonSys of a change in active account. Callable only by AccountSys.
 * TODO: AccountSys should emit an event once we have a proper event system. Remove setActiveAccount then.
 *
 * @param {String} account - The name of the active account.
 */
export function setActiveAccount(account: string) {
    sendToParent({
        type: MessageTypes.SetActiveAccount,
        payload: { account },
    });
}
