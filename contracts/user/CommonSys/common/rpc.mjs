import { siblingUrl } from '/common/rootdomain.mjs';
import { privateStringToKeyPair, publicKeyPairToFracpack, signatureToFracpack } from '/common/keyConversions.mjs';
import hashJs from 'https://cdn.skypack.dev/hash.js';

export { siblingUrl };

export class RPCError extends Error {
    constructor(message, trace) {
        super(message)
        this.trace = trace;
    }
}

export async function throwIfError(response) {
    if (!response.ok)
        throw new RPCError(await response.text());
    return response;
}

export async function get(url) {
    return await throwIfError(await fetch(url, { method: 'GET' }));
}

export async function getText(url) {
    return await (await get(url)).text();
}

export async function getJson(url) {
    return await (await get(url)).json();
}

export async function postText(url, text) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'text'
        },
        body: text,
    }));
}

export async function postGraphQL(url, graphql) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/graphql'
        },
        body: graphql,
    }));
}

export async function postJson(url, json) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(json),
    }));
}

export async function postArrayBuffer(url, arrayBuffer) {
    return await throwIfError(await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream'
        },
        body: arrayBuffer,
    }));
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

export async function packAction(baseUrl, action) {
    let { sender, contract, method, data, rawData } = action;
    if (!rawData) {
        rawData = uint8ArrayToHex(new Uint8Array(await postJsonGetArrayBuffer(
            siblingUrl(baseUrl, contract, '/pack_action/' + method),
            data)));
    }
    return { sender, contract, method, rawData };
}

export async function packActions(baseUrl, actions) {
    return await Promise.all(actions.map(action => packAction(baseUrl, action)));
}

export async function packTransaction(baseUrl, transaction) {
    return await postJsonGetArrayBuffer(baseUrl.replace(/\/+$/, '') + '/common/pack/Transaction',
        { ...transaction, actions: await packActions(baseUrl, transaction.actions) });
}

export async function packSignedTransaction(baseUrl, signedTransaction) {
    if (typeof signedTransaction.transaction !== 'string')
        signedTransaction = {
            ...signedTransaction,
            transaction: uint8ArrayToHex(new Uint8Array(
                await packTransaction(baseUrl, signedTransaction.transaction))),
        };
    return await postJsonGetArrayBuffer(baseUrl.replace(/\/+$/, '') + '/common/pack/SignedTransaction', signedTransaction);
}

export async function pushPackedSignedTransaction(baseUrl, packed) {
    const trace = await postArrayBufferGetJson(baseUrl.replace(/\/+$/, '') + '/native/push_transaction', packed);
    if (trace.error)
        throw new RPCError(trace.error, trace);
    return trace;
}

export async function packAndPushSignedTransaction(baseUrl, signedTransaction) {
    return await pushPackedSignedTransaction(baseUrl, await packSignedTransaction(baseUrl, signedTransaction));
}

export async function signTransaction(baseUrl, transaction, privateKeys) {
    const keys = (privateKeys || []).map(k => {
        if (typeof k === 'string')
            return privateStringToKeyPair(k);
        else
            return k;
    });
    const claims = keys.map(k => ({
        contract: 'verifyec-sys',
        rawData: uint8ArrayToHex(publicKeyPairToFracpack(k))
    }));
    transaction = new Uint8Array(await packTransaction(baseUrl, { ...transaction, claims }));
    const digest = new hashJs.sha256().update(transaction).digest();
    const proofs = keys.map(k =>
        uint8ArrayToHex(signatureToFracpack({
            keyType: k.keyType,
            signature: k.keyPair.sign(digest),
        }))
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
export async function signAndPushTransaction(baseUrl, transaction, privateKeys) {
    return await packAndPushSignedTransaction(baseUrl, await signTransaction(baseUrl, transaction, privateKeys));
}

export function uint8ArrayToHex(data) {
    let result = '';
    for (const x of data)
        result += ('00' + x.toString(16)).slice(-2);
    return result.toUpperCase();
};

export function hexToUint8Array(hex) {
    if (typeof hex !== 'string')
        throw new Error('Expected string containing hex digits');
    if (hex.length % 2)
        throw new Error('Odd number of hex digits');
    const l = hex.length / 2;
    const result = new Uint8Array(l);
    for (let i = 0; i < l; ++i) {
        const x = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(x))
            throw new Error('Expected hex string');
        result[i] = x;
    }
    return result;
};

let redirectIfAccessedDirectly = () => {
    try {
        if (window.self === window.top)
        {
            // We are the top window. Redirect needed.
            const applet = window.location.hostname.substring(0, window.location.hostname.indexOf("."));
            window.location.replace(siblingUrl(null, "", "/applet/" + applet));
        }
    } catch (e) {
        // The browser blocked access to window.top due to the same origin policy, 
        //   therefore we are in an iframe, all is well.
    }
};

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
]

export const MessageTypes = {
    getResource: 0,
    transaction: 1,
};

let verifyFields = (obj, fieldNames) => {
    var missingField = false;

    fieldNames.forEach((fieldName)=>{
        if (!obj.hasOwnProperty(fieldName))
        {
            console.error("Message from core missing \"" + fieldName + "\" field");
            missingField = true;
        }
    });

    return !missingField;
};

let handleErrorCode = (code) => {
    if (code === undefined) return false;

    let recognizedError = ErrorMessages.some((err)=>{
        if (err.code === code)
        {
            console.error(err.message);
            return true;
        }
        return false;
    });
    if (!recognizedError)
        console.error("Message from core contains unrecognized error code: " + error);

    return true;
};

let messageRouting = [
    {
        type: MessageTypes.getResource,
        validate: (payload)=>{
            if (!verifyFields(payload, ["id", "resource"])) 
                return false;

            return true;
        },
        route: (payload) => {
            let {id, resource} = payload;
            var idx = -1;
            let handled = singleUseHandlers.some((handler, index)=>{
                if (handler.id === id)
                {
                    idx = index;
                    handler.callback(resource);
                    return true;
                }
                return false;
            });

            if (handled)
            {   // Remove the handler from singleUseHandlers.
                singleUseHandlers.splice(idx, 1);
                return true;
            }
            return false;
        },
    },
    {
        type: MessageTypes.transaction,
        validate: (payload)=>{
            if (!verifyFields(payload, ["type", "trace"])) 
                return false;

            return true;
        },
        route: (payload) => {
            let {type, trace} = payload;
            
            var handled = false;
            handlers.filter((h)=>{return h.type == type;}).forEach((h)=>{
                handled = true;
                h.callback(trace);
            });
            return handled;
        },
    },
];

// Handlers that are constructed when an applet starts and persist
var handlers = [];

// Handlers that are destroyed after routing a message
var singleUseHandlers = [];

export async function initializeApplet()
{
    redirectIfAccessedDirectly();

    window.iFrameResizer = {
        onMessage: (msg)=>{
            let {type, payload} = msg;
            if (type === undefined || typeof type !== "number" || payload === undefined)
            {
                console.error("Malformed message received from core");
                return;
            }

            if (!messageRouting[type].validate(payload))
                return;

            if (handleErrorCode(payload.error))
                return;

            if (!messageRouting[type].route(payload))
            {
                console.error("Child has no handler for message: " + msg);
                return;
            }
        },
      };

    await import("https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.js");
}

/**
 * Description: Append a route handler to map a transaction types to a callback function.
 * Multiple routes can be configured for the same transaction type.
 * 
 * @param {String} id - An arbitrary but unique name mapped to this specific route.
 * @param {Number} type - An arbitrary number mapped to this type of transaction.
 * @param {Function} callback - A callback function that should be called when a return message is received with the corresponding ID.
 */
export function addRoute(id, type, callback)
{
    // Find and remove the old route mapped to this id
    var idx = -1;
    handlers.some((h, index)=>{
        if (h.id == id) 
        {
            idx = index;
            return true;
        }
        return false;
    });
    if (idx !== -1)
    {
        handlers.splice(idx, 1);
    }

    // Add the new route
    handlers.push({id, type, callback});
}

/**
 * Description: Constructs an action that can be pushed to chain with push().
 * 
 * Example usage: action("token-sys", "credit", {tokenId: 1, receiver: "alice", amount: 100, memo: "Test"});
 * @param {String} contract - The name of the contract
 * @param {String} actionName - The name of the action to be called
 * @param {Object} params - The name and value of each of the action parameters
 * @param {String} sender [0] - The name of the sender. Will default to the logged in user, unless explicitly specified.
 */
export async function action(contract, actionName, params, sender = 0)
{
    if (sender !== 0)
        return {sender, contract, method: actionName, data: params};
    else
        return {contract, method: actionName, data: params};
}

/**
 * Description: Pushes a collection of actions to the chain.
 * 
 * Example usage: push("swap-transaction", Array(myCreditAction, myDebitAction));
 * @param {Number} transactionType - An arbitrary name for this type of transaction that has a corresponding route configuration
 * @param {Array} actions - An array of Objects constructed via the action() function
 */
export async function push(transactionType, actions)
{
    if ('parentIFrame' in window) {
        parentIFrame.sendMessage({
            type: MessageTypes.transaction,
            payload: {
                type: transactionType,
                actions
            },
        }, "*");
    }
    else
    {
        // This can sometimes happen if the window hasn't fully loaded
        console.log("No parent iframe");
    }
}

export const CommonResources = {
    loggedInUser: 0,
};

/**
 * Description: Gets a client-side resource.
 * 
 * @param {Number} resource - The ID of the requested resource
 * @param {Array} callback - The function to call with the requested resource
 */
export async function getLocalResource(resource, callback)
{
    if ('parentIFrame' in window) {
        let id = singleUseHandlers.length;
        singleUseHandlers.push({id, callback});

        parentIFrame.sendMessage({
            type: MessageTypes.getResource,
            payload: { id, resource },
        }, "*");
    }
    else
    {
        // This can sometimes happen if the window hasn't fully loaded
        console.log("No parent iframe");
    }
}

