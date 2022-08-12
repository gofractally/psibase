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

export async function getTaposForHeadBlock(baseUrl = '') {
    return await getJson(baseUrl.replace(/\/+$/, '') + '/common/tapos/head');
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
    Core: 0, // A message to the core layer itself
    Action: 1, // An action send to an on-chain application
    Query: 2,  // A query to another client-side applet, expect a response
    Operation: 3, // A procedure which can include multiple other queries, actions, and operations
    QueryResponse: 4, // A response to a prior query
};

var ops = []; // Operations defined by an applet

var qrs = []; // Queries defined by an applet

var queryCallbacks = []; // Callbacks automatically generated for responding to queries

export function addQueryCallback(callback)
{
    let callbackId = queryCallbacks.length;
    queryCallbacks.push({callbackId, callback});
    return callbackId;
}

export function executeCallback(callbackId, response)
{
    let idx = -1;
    let found = queryCallbacks.some((q, i) => {
        if (q.callbackId === callbackId)
        {
            idx = i;
            return true;
        }
        return false;
    });
    if (!found)
    {
        console.error("Callback with ID " + callbackId + " not found.");
        return;
    }
    try{
        queryCallbacks(idx).callback(response);
    }
    catch (e)
    {
        console.error("Error calling callback with ID " + callbackId);
    }

    // Remove the callback now that it's been handled
    queryCallbacks.splice(idx, 1);
}

function sendToParent(message)
{
    if ('parentIFrame' in window) {
        // Todo - Restrict that messages should be sent to 
        //   the expected origin
        parentIFrame.sendMessage(message, "*");
    }
    else
    {
        // This can sometimes happen if the page hasn't fully loaded
        console.log("No parent iframe");
    }
}

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

export function verifyFields (obj, fieldNames) {
    var missingField = false;

    fieldNames.forEach((fieldName)=>{
        if (!obj.hasOwnProperty(fieldName))
        {
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
        type: MessageTypes.Operation,
        validate: (payload)=>{
            return verifyFields(payload, ["action", "params"]);
        },
        route: (payload) => {
            let {operation, params} = payload;
            
            let op = ops.find(o => o.id === operation);
            if (op !== undefined)
            {
                try {
                    op.exec(params);
                }
                catch (e)
                {
                    console.error("Error running operation " + operation);
                    console.error(e);
                    stopOperation();
                    throw e;
                }
            }
            else
            {
                console.error("Operation not found: " + operation);
            }
            stopOperation();
        },
    },
    {
        type: MessageTypes.Query,
        validate: (payload)=>{
            return verifyFields(payload, ["identifier", "params", "callbackId"]);
        },
        route: (payload) => {
            let {identifier, params, callbackId} = payload;

            let qu = qrs.find(q => q.id === identifier);
            if (qu !== undefined)
            {
                try {
                    let reply = (val) => {
                        sendToParent({
                            type: MessageTypes.QueryResponse,
                            payload: { callbackId, response: val },
                        });
                    };
                    qu.exec(params, reply);
                }
                catch (e)
                {
                    console.error("Error running query " + identifier);
                    console.error(e);
                    throw e;
                }
            }
            else
            {
                console.error("Query not found: " + identifier);
            }
        },
    },
    {
        type: MessageTypes.QueryResponse,
        validate: (payload) => {
            return verifyFields(payload, ["callbackId", "response"]);
        },
        route: (payload) => {
            let {callbackId, response} = payload;
            executeCallback(callbackId, response);
        },
    }
];

export async function initializeApplet()
{
    redirectIfAccessedDirectly();

    window.iFrameResizer = {
        // TODO: [Security] Need to include targetOrigin, otherwise malicious applets could embed other
        //  applets inside them and pretend to be core
        //  targetOrigin: siblingUrl(null, "common-sys", null),
        onMessage: (msg)=>{
            let {type, payload} = msg;
            if (type === undefined || typeof type !== "number" || payload === undefined)
            {
                console.error("Malformed message received from core");
                return;
            }

            if (!messageRouting[type].validate(payload))
            {
                console.error("Message from core failed validation checks");
                return;
            }

            if (handleErrorCode(payload.error))
                return;

            if (!messageRouting[type].route(payload))
            {
                console.error("Child has no handler for message: " + msg);
                return;
            }
        },
      };

    await import("/common/iframeResizer.contentWindow.js");
}


function set(targetArray, newElements, caller)
{
    let valid = newElements.every(e => {
        if (!verifyFields(e, ["id", "exec"]))
        {
            return false;
        }
        return true;
    });

    if (!valid) 
    {
        console.error(caller + ": All elements must have \"id\" and \"exec\" properties");
        return;
    }

    if (targetArray.length === 0)
        targetArray = newElements;
    else 
    {
        valid = newElements.every(e => {
            if (targetArray.find(t => t.id === e.id)) 
                return false;
            else 
                return true;
        });
        if (!valid) {
            console.error(caller + ": Same element defined twice.");
            return;
        }
        targetArray = targetArray.concat(newElements);
    }
}

export function setOperations(operations)
{
    set(ops, operations, "setOperations");
}

export function setQueries(queries)
{
    set(qrs, queries, "setQueries");
}

function startOperation()
{
    sendToParent({
        type: MessageTypes.Core,
        payload: {command: "startOp"},
    });
}

function stopOperation()
{
    sendToParent({
        type: MessageTypes.Core,
        payload: {command: "stopOp"},
    });
}

export function operation(applet, subPath, operationName, params)
{
    startOperation();

    // Todo - There may be a way to short-circuit calling common-sys when 
    //    opApplet == await getJson('/common/thiscontract');

    sendToParent({
        type: MessageTypes.Operation,
        payload: { opApplet: applet, opSubPath: subPath, opName: operationName, opParams: params },
    });
}

export function action(application, actionName, params)
{
    sendToParent({
        type: MessageTypes.Action,
        payload: { application, actionName, params },
    });
}

export function query(applet, subPath, queryName, params, callback)
{
    // Will leave memory hanging if we don't get a response as expected
    let callbackId = addQueryCallback(callback);

    sendToParent({
        type: MessageTypes.Query,
        payload: { callbackId, qApplet: applet, qSubPath: subPath, qName: queryName, qParams: params },
    });
}

export function query(applet, subPath, queryName, callback)
{
    query(applet, subPath, queryName, {}, callback);
}
