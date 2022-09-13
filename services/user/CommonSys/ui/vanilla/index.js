import { siblingUrl as getSiblingUrl, packAndPushSignedTransaction, getTaposForHeadBlock,
    MessageTypes, verifyFields, storeCallback, executeCallback, AppletId } from "/common/rpc.mjs";
import htm from "/common/htm.module.js";
await import("/common/react-router-dom.min.js");

const html = htm.bind(React.createElement);

const { useEffect, useState, useCallback, useMemo, useRef } = React;
const { BrowserRouter, Route } = ReactRouterDOM;

const appletPrefix = "/applet/";

let serviceName = "common-sys";
let commonSys = new AppletId(serviceName);

const AppletStates = {
    primary: 0,
    headless: 1,
    modal: 2,
};

let appletStyles = {
    [AppletStates.primary]: {
        margin: 0,
        padding: 0
    },
    [AppletStates.headless]: {
        display: "none"
    },
    [AppletStates.modal]: {
        padding: 0,
        position: "absolute",
        width: 400,
        height: 266,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
    },
};

("use strict");

function Nav() {

    const [commonSysUrl, setCommonSysUrl] = useState('');
    const [tokenSysUrl, setTokenSysUrl] = useState('');
    
    useEffect(()=>{
        (async () => {
            setCommonSysUrl(await getSiblingUrl());
            setTokenSysUrl(await getSiblingUrl(null, "", "applet/token-sys"));
        })();
    },[]);

    let activeIf = (cName) => {
        if (cName === "common-sys")
        {
            return window.location.pathname === "/" ? "active" : "";
        }
        else
        {
            return window.location.pathname.indexOf(cName) != -1 ? "active" : "";
        }
    };

    return html`
        <div class="ui secondary menu" style=${{ paddingBottom: "10px" }}>
            <a class="${activeIf("common-sys")} item" href=${commonSysUrl}> Home </a>
            <a
                class="${activeIf("token-sys")} item"
                href=${tokenSysUrl}
            >
                Wallet
            </a>
            <div class="right menu">
                <div class="item">
                    <button class="ui labeled icon button">
                        <i class="circle icon"></i>
                        Propose
                    </button>
                </div>
                <div class="item">
                    <div class="ui icon input">
                        <input type="text" placeholder="Search..." />
                        <i class="search link icon"></i>
                    </div>
                </div>
                <a class="ui item"> Logout </a>
            </div>
        </div>
    `;
}

const constructTransaction = async (actions) => {
    let tenMinutes = 10 * 60 * 1000;
    var trans = JSON.parse(JSON.stringify({
            tapos: {
                    ...await getTaposForHeadBlock(),
                    expiration: new Date(Date.now() + tenMinutes),
            },
            actions,
    }, null, 4));

    return trans;
};

let getIframeId = (appletId) => {
    // Do more than one iFrame of the same appletStr/subPath ever need to be opened simultaneously?
    //    If so, this method needs to change to add a refCount to the ID or something, to ensure the IDs
    //    are unique.
    return "applet_" + appletId.name + "_" + appletId.subPath;
};

function Applet(appletParams, handleMessage) {
    let {appletId, state, onInit} = appletParams;
    let [appletSrc, setAppletSrc] = useState('');
    let [iFrameId, setIframeId] = useState(getIframeId(appletId));

    if (onInit === undefined) 
        onInit = ()=>{};

    useEffect(()=>{
        let doSetAppletSrc = async () => {
            setAppletSrc(await appletId.url());
        };
        doSetAppletSrc();
    },[]);
    
    useEffect(()=>{ // Set document title
        if (appletId && state === AppletStates.primary)
        {
            window.document.title = appletId.name;
        }
    }, []);

    let doHandleMessage = useCallback((request)=>{
        handleMessage(appletId, request);
    }, []);

    useEffect(() => { // Configure iFrameResizer
        let iFrame = document.getElementById(iFrameId);
        if (iFrame)
        {
            // TODO - Fix error: Failed to execute 'postMessage' on 'DOMWindow'
            //        https://github.com/gofractally/psibase/issues/107
            iFrameResize(
                {
                    // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
                    // log: true,
                    checkOrigin: true,
                    heightCalculationMethod: "lowestElement",
                    onMessage: doHandleMessage,
                    onInit,
                    minHeight:
                        document.documentElement.scrollHeight -
                        iFrame.getBoundingClientRect().top,
                },
                "#" + iFrameId
            )[0].iFrameResizer;
        }
    }, [appletSrc]);

    if (!appletId || !appletSrc)
    {
        return;
    }
    else
    {
        return html`
        <iframe
            id=${iFrameId}
            style=${appletStyles[state]}
            src="${appletSrc}"
            allow="camera;microphone"
            title="${appletId.name}"
            frameborder="0"
        ></iframe>
    `;
    }
}

function Dashboard() {

    let [services, setServices] = useState([
            {
                title: "Account Creation",
                description: "Create a new account. Only available on testnet.",
                service: "account-sys",
                color: "teal"
            },
            {
                title: "Account Management",
                description: "Used to manage your existing accounts.",
                service: "auth-ec-sys",
                color: "red",
            },
            {
                title: "Block Explorer",
                description:
                    "View the most recently produced blocks, all the way back to the beginning of the chain.",
                service: "explore-sys",
                color: "green",
            },
            {
                title: "Wallet",
                description:
                    "View your balance, send/swap tokens, other standard wallet functionality.",
                service: "token-sys",
                color: "blue",
            },
        ]
    );

    useEffect(() => {
        window.document.title = "Psinet Dashboard";
    }, []);

    return html`
        <div class="ui container">
            <h1>psinet</h1>
            <h2>Featured Applications</h2>
            <div class="ui cards">
                ${services.map((c, index) => {
                    return html`
                        <div key=${index} class="${c.color} card">
                            <div class="content">
                                <div class="header">${c.title}</div>
                                <div class="description">${c.description}</div>
                            </div>
                            <a href="${appletPrefix}${c.service}">
                                <div class="ui bottom attached button">
                                    <i
                                        class="arrow alternate circle right outline icon"
                                        style=${{
                                            marginRight: "5px",
                                        }}
                                    ></i>
                                    Check it out
                                </div>
                            </a>
                        </div>
                    `;
                })}
            </div>
        </div>
    `;
}

function getAppletInURL() {
    const pathname = window.location.pathname;
    var fullPath = pathname.substring(appletPrefix.length);
    return AppletId.fromFullPath(fullPath);
}

class ClientOps
{
    static currentOps = [];

    static add(receiver) {
        this.currentOps = this.currentOps.concat([receiver]);
    }

    static allCompleted()
    {
        return this.currentOps.length === 0;
    }

    static opReturned(sender)
    {
        let idx = this.currentOps.findIndex(op => op.equals(sender));

        if (idx !== -1)
        {
            this.currentOps.splice(idx, 1); 
        }
        else 
        {
            throw "Applet tried to stop an operation it never started";
        }
    }
}

function makeAction(application, actionName, params, sender)
{
    return {service: application, method: actionName, data: params, sender};
}

function OtherApplets({applets, handleMessage})
{
    let nonPrimaryApplets = applets.filter(a=>a.state !== AppletStates.primary);
    
    return nonPrimaryApplets.map((a)=>{
                return Applet(a, handleMessage);
            });
}

// TODO: Ensure pending transaction is cleared if there are any errors
//         Otherwise, we could accidentally submit double actions
//         if the user retries an action.
let pendingTransaction = [];

let injectSender = (transaction, sender) => {
    transaction.forEach(action => {
        if (action.sender === null)
        {
            action.sender = sender;
        }
    });
    return transaction;
};

// Todo - check that promises are appropriately rejected 
//           and rejections are handled.
function App() {
    let activeApplet = getAppletInURL();
    let [applets, setApplets] = useState([{appletId: activeApplet, state: AppletStates.primary, onInit: ()=>{}}]);
    let [operationCountdown, setOperationCountdown] = useState(false);

    const appletsRef = useRef();
    appletsRef.current = applets;

    let getIndex = useCallback((appletId)=>{
        return appletsRef.current.findIndex(a => {
            return a.appletId.equals(appletId);
        });
    }, []);

    useEffect(()=>{
        let timer = -1;
        if (operationCountdown)
        {
            // Eventually we may not want to execute the transaction when the operation ends. 
            // (Send the transaction to the msig applet or something)
            timer = setTimeout(executeTransaction, 100);
        }
        else
        {
            clearTimeout(timer);
        }

    }, [operationCountdown])

    let open = useCallback((appletId) => {
        return new Promise((resolve, reject) => {
            // Opens an applet if it's not already open
            let index = getIndex(appletId);
            if (index === -1)
            {
                setApplets([...appletsRef.current, {appletId, state: AppletStates.headless, onInit: resolve}]);
            }
            else
            {   // Applet is already open, invoke callback immediately
                resolve();
            }
        });
    }, [getIndex]);

    let urlApplet = useCallback(() => {
        return Applet({appletId: activeApplet, state: AppletStates.primary}, handleMessage);
    }, []);

    let getIframe = useCallback(async (appletId, shouldOpen) =>
    {
        if (!shouldOpen && getIndex(appletId) === -1)
        {
            throw "Applet [" + appletId.fullPath + "] not open, but it should have been.";
        }

        await open(appletId);

        var iframe = document.getElementById(getIframeId(appletId));
        if (iframe == null)
        {
            throw "Applet " + appletId.fullPath + " not found, send message failed.";
        }

        return iframe;
    }, [open, getIndex])

    let sendMessage = useCallback(async (messageType, sender, receiver, payload, shouldOpenReceiver)=>{

        var iframe;
        try 
        {
            iframe = await getIframe(receiver, shouldOpenReceiver);
        } 
        catch(e) 
        {
            // Did the initiator applet navigate to a different page before getting a response?
            console.error(e);
        }


        // TODO: Could check that sender isn't on a blacklist before
        //       making the IPC call.

        let restrictedTargetOrigin = await receiver.url();
        iframe.iFrameResizer.sendMessage({type: messageType, payload}, restrictedTargetOrigin);

    }, [getIframe]);

    let sendMessageGetResponse = useCallback(async (messageType, sender, receiver, payload, shouldOpenReceiver)=>{

        // TODO: Could check that sender isn't on a blacklist before
        //       making the IPC call.

        // TODO: handle timeout if I never get a response from an applet

        return new Promise(async (resolve, reject) => {
            let iframe = await getIframe(receiver, shouldOpenReceiver);

            payload.callbackId = storeCallback(({sender : responseApplet, response, errors})=>{
                if (!responseApplet.equals(receiver))
                {
                    return;
                }
                resolve({response, errors});
                // TODO: Consider creating a QueryResponse object with these two fields
            });

            let restrictedTargetOrigin = await receiver.url();
            iframe.iFrameResizer.sendMessage({type: messageType, payload}, restrictedTargetOrigin);
        });
    }, [getIframe]);

    let query = useCallback(async (sender, receiver, name, params = {}) => {
        return await sendMessageGetResponse(MessageTypes.Query, sender, receiver,
            {identifier: name, params}, 
            true
        );
    }, [sendMessageGetResponse]);

    let operation = useCallback(async (sender, receiver, name, params = {}) => {
        return await sendMessageGetResponse(MessageTypes.Operation, sender, receiver,
            {identifier: name, params}, 
            true
        );
    }, [sendMessageGetResponse]);

    let executeTransaction = useCallback(async () => {
        if (pendingTransaction.length === 0)
            return;

        try
        {
            let accountSys = new AppletId("account-sys");
            let {response: user} = await query(commonSys, accountSys, "getLoggedInUser");
            let transaction = await constructTransaction(injectSender(pendingTransaction, user));
            let {response: signedTransaction,} = await query(commonSys, accountSys, "getAuthedTransaction", {transaction});
            let baseUrl = ''; // default
            let trace = await packAndPushSignedTransaction(baseUrl, signedTransaction);
            console.log(trace);
        }
        catch (e)
        {
            console.error(e);
        }
        pendingTransaction = [];
    }, [query]);

    let messageRouting = useMemo(() => [
        {
            type: MessageTypes.Operation,
            fields: ["callbackId", "appletId", "name", "params"],
            handle: async (sender, payload) => {
                let { callbackId, appletId, name, params } = payload;

                setOperationCountdown(false);

                let receiver = AppletId.fromObject(appletId);
                ClientOps.add(receiver);

                var reply = null;
                try 
                {
                    reply = await operation(sender, receiver, name, params);
                    reply.callbackId = callbackId;
                }
                catch (e) 
                {
                    let msg = sender.fullPath + "@" + receiver.fullPath + ":" + name;
                    msg = "Common-sys failed to route message: " + msg;
                    reply = {callbackId, response: null, errors: [e, msg]}
                }

                sendMessage(MessageTypes.OperationResponse, receiver, sender, reply, false);
            },
        },
        {
            type: MessageTypes.Query,
            fields: ["callbackId", "appletId", "name", "params"],
            handle: async (sender, payload) => {
                let {callbackId, appletId, name, params} = payload;

                let receiver = AppletId.fromObject(appletId);

                var reply = null;
                try {
                    reply = await query(sender, receiver, name, params);
                    reply.callbackId = callbackId;
                }
                catch (e)
                {
                    let msg = sender.fullPath + "@" + receiver.fullPath + ":" + name;
                    msg = "Common-sys failed to route message: " + msg;
                    reply = {callbackId, response: null, errors: [e, msg]}
                }

                sendMessage(MessageTypes.QueryResponse, receiver, sender, reply, false);
            },
        },
        {
            type: MessageTypes.Action,
            fields: ["application", "actionName", "params", "sender"],
            handle: async (sender, payload) => {
                let {application, actionName, params, sender : user} = payload;
                pendingTransaction.push(makeAction(application, actionName, params, user));

                if (ClientOps.allCompleted())
                {
                    setOperationCountdown(true);
                }
            }
        },
        {
            type: MessageTypes.QueryResponse,
            fields: ["callbackId", "response", "errors"],
            handle: (sender, payload) =>
            {
                let {callbackId, response, errors} = payload;
                executeCallback(callbackId, {sender, response, errors});
            },
        },
        {
            type: MessageTypes.OperationResponse,
            fields: ["callbackId", "response", "errors"],
            handle: (sender, payload) => {
                let {callbackId, response, errors} = payload;
                executeCallback(callbackId, {sender, response, errors});

                ClientOps.opReturned(sender);
                if (ClientOps.allCompleted())
                {
                    setOperationCountdown(true);
                }
            },
        },

    ], [open, executeTransaction, sendMessage, sendMessageGetResponse, operationCountdown]);

    let handleMessage = useCallback(async (sender, request)=>{
        let {type, payload} = request.message;
        if (type === undefined || payload === undefined)
        {
            console.error("Received malformed message from applet");
            return;
        }
        let route = messageRouting.find(m => m.type === type);
        if (route === undefined)
        {
            console.error("Message from applet specifies unknown route.");
            return;
        }

        if (!verifyFields(payload, route.fields))
        {
            console.error(type + " invalid with payload:");
            console.error(payload);
            return;
        }

        route.handle(sender, payload);

    }, [messageRouting]);

    return html`
        <div class="ui container">
            <${Nav} />
        </div>
        <${BrowserRouter}>
            <div>
                <${Route} path="/" exact component=${Dashboard} />
                <${Route} path="${appletPrefix}" component=${urlApplet} />
            </div>
        </${BrowserRouter}>
        <div>
            <${OtherApplets} applets=${applets} handleMessage=${handleMessage} />
        </div>
    `;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);