import { siblingUrl as getSiblingUrl, packAndPushSignedTransaction, getTaposForHeadBlock,
    MessageTypes, verifyFields, storeCallback, executeCallback } from "/common/rpc.mjs";
import htm from "/common/htm.module.js";
await import("/common/react-router-dom.min.js");

const html = htm.bind(React.createElement);

const { useEffect, useState, useCallback, useMemo, useRef } = React;
const { BrowserRouter, Route } = ReactRouterDOM;

const appletPrefix = "/applet/";

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
    appletStyles[AppletStates.headless]: {
        display: "none"
    },
    appletStyles[AppletStates.modal]: {
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

let getIframeId = (appletStr, subPath) => {
    // TODO - To support multiple of the same type of applet being opened simultaneously, 
    //     the IDs need to be unique.
    return "applet_" + appletStr + "_" + subPath;
};

function Applet(appletParams, handleMessage) {
    let {appletStr, subPath, state, onInit} = appletParams;
    let [appletSrc, setAppletSrc] = useState('');

    if (!appletStr)
    {
        console.error("No applet specified");
        return;
    }

    if (onInit === undefined) 
        onInit = ()=>{};

    useEffect(()=>{
        let doSetAppletSrc = async () => {
            setAppletSrc(await getSiblingUrl(null, appletStr, subPath));
        };
        doSetAppletSrc();
    },[]);
    
    useEffect(()=>{ // Set document title
        if (appletStr && state === AppletStates.primary)
        {
            window.document.title = appletStr;
        }
    }, []);

    let doHandleMessage = useCallback((request)=>{
        handleMessage({applet: appletStr, subPath, state}, request);
    }, []);

    useEffect(() => { // Configure iFrameResizer
        
        let iFrameId = getIframeId(appletStr, subPath);
        let iFrame = document.getElementById(iFrameId);
        if (iFrame)
        {   // Todo - why isn't this running only after the render is complete?
            iFrameResize(
                {
                    // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
                    //log: true,
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

    if (!appletSrc) 
        return;
    else
    {
        return html`
        <iframe
            id=${getIframeId(appletStr, subPath)}
            style=${appletStyles[state]}
            src="${appletSrc}"
            allow="camera;microphone"
            title="${appletStr}"
            frameborder="0"
        ></iframe>
    `;
    }
}

function Dashboard() {

    let [contracts, setContracts] = useState([
            {
                title: "Account Creation",
                description: "Create a new account. Only available on testnet.",
                contract: "account-sys",
                color: "teal"
            },
            {
                title: "Account Management",
                description: "Used to manage your existing accounts.",
                contract: "auth-ec-sys",
                color: "red",
            },
            {
                title: "Block Explorer",
                description:
                    "View the most recently produced blocks, all the way back to the beginning of the chain.",
                contract: "explore-sys",
                color: "green",
            },
            {
                title: "Wallet",
                description:
                    "View your balance, send/swap tokens, other standard wallet functionality.",
                contract: "token-sys",
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
                ${contracts.map((c, index) => {
                    return html`
                        <div key=${index} class="${c.color} card">
                            <div class="content">
                                <div class="header">${c.title}</div>
                                <div class="description">${c.description}</div>
                            </div>
                            <a href="${appletPrefix}${c.contract}">
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
    var appletStr = pathname.substring(appletPrefix.length);
    var subPath = "";
    const startOfSubpath = appletStr.indexOf("/");
    if (startOfSubpath != -1) {
        subPath = appletStr.substring(startOfSubpath);
        appletStr = appletStr.substring(0, startOfSubpath);
    }
    return {appletStr, subPath};
}

let currentOps = [];

function makeAction(application, actionName, params, sender)
{
    return {contract: application, method: actionName, data: params, sender};
}

function OtherApplets({applets, handleMessage})
{
    let nonPrimaryApplets = applets.filter(a=>a.state !== AppletStates.primary);
    
    return nonPrimaryApplets.map((a)=>{
                return Applet(a, handleMessage);
            });
}

let transaction = [];

function App() {
    let {appletStr, subPath} = getAppletInURL();
    let [applets, setApplets] = useState([{appletStr, subPath, state: AppletStates.primary, onInit: ()=>{}}]);

    const [commonSysUrl, setCommonSysUrl] = useState('');
    const [tokenSysUrl, setTokenSysUrl] = useState('');
    const appletsRef = useRef();
    appletsRef.current = applets;

    let getIndex = useCallback((appletStr, subPath)=>{
        // Finds the index of the specified applet in state: "applets"
        var index = -1;
        appletsRef.current.some((a, i) => {
            if (a.appletStr == appletStr && a.subPath == subPath)
            {
                index = i;
                return true;
            }
            return false;
        });
        return index;
    }, []);

    let open = useCallback(({appletStr, subPath, state}, callAfterOpen) => {
        // Opens an applet if it's not already open
        let index = getIndex(appletStr, subPath);
        if (index === -1)
        {
            setApplets([...appletsRef.current, {appletStr, subPath, state, onInit: callAfterOpen}]);
        }
        else
        {   // Applet is already open, invoke callback immediately
            callAfterOpen();
        }
        
    }, [getIndex]);

    let urlApplet = useCallback(() => {
        return Applet({appletStr, subPath, state: AppletStates.primary}, handleMessage);
    }, []);

    let sendMessage = useCallback((messageType, sender, receiver, payload, shouldOpenReceiver)=>{
        let {rApplet, rSubPath} = receiver;

        let callOnApplet = async ()=>{
            var iframe = document.getElementById(getIframeId(rApplet, rSubPath));
            if (iframe == null)
            {
                console.error("Applet " + rApplet + "/" + rSubPath + " not found, send message failed.");
                return;
            }

            // TODO: Could check that sender isn't on rApplet's blacklist before
            //       making the IPC call.

            let restrictedTargetOrigin = await getSiblingUrl(null, rApplet, rSubPath);
            iframe.iFrameResizer.sendMessage({type: messageType, payload}, restrictedTargetOrigin);
        }

        if (!shouldOpenReceiver)
        {
            if (getIndex(rApplet, rSubPath) === -1)
            {
                console.error("Cannot find applet target for sendMessage");
                return;
            }
            callOnApplet();
        }
        else
        {
            open({appletStr: rApplet, 
                subPath: rSubPath, 
                state: AppletStates.headless
            }, callOnApplet);
        }
    }, [open, getIndex]);

    let runQuery = useCallback((senderApplet, qApplet, qSubPath, qName, params, callback)=>{
        let coreCallbackId = storeCallback(({responseApplet, response})=>{
            if (responseApplet.applet !== qApplet || responseApplet.subPath !== qSubPath)
            {
                return;
            }
            callback({responseApplet, response});
        });

        sendMessage(MessageTypes.Query, 
            senderApplet,
            {rApplet: qApplet, rSubPath: qSubPath}, 
            {identifier: qName, params, callbackId: coreCallbackId}, 
            true
        );
    }, [sendMessage]);

    let injectSender = useCallback((actions, sender) => {
        actions.forEach(action => {
            if (action.sender === null)
            {
                action.sender = sender;
            }
        });
        return actions;
    }, []);

    let withSender = useCallback((callback)=>{
        let senderApplet = {applet: "common-sys", subPath: ""};
        runQuery(senderApplet, 
            "account-sys", "", "getLoggedInUser", {}, 
            ({responseApplet, response})=>{
                callback(response);
            }
        );
    }, [runQuery]);

    let withAuthedTransaction = useCallback((trans, callback)=>{
        let senderApplet = {applet: "common-sys", subPath: ""};
        runQuery(senderApplet, 
            "account-sys", "", "getAuthedTransaction", {transaction: trans}, 
            ({responseApplet, response})=>{
                callback(response);
            }
        );
    }, [runQuery]);

    let executeTransaction = useCallback(() => {
        withSender(async (sender)=>{
            try
            {
                let trans = await constructTransaction(injectSender(transaction, sender));
                let baseUrl = ''; // default
                withAuthedTransaction(trans, async (signedTransaction)=>{
                    let trace = await packAndPushSignedTransaction(baseUrl, signedTransaction);
                    console.log(trace);
                });
            }
            catch (e)
            {
                console.error(e);
            }
            transaction = [];
        });
    }, [withSender]);

    let messageRouting = useMemo(() => [
        {
            type: MessageTypes.Core,
            validate: (payload) => {
                if (verifyFields(payload, ["command"]))
                {
                    return payload.command === "stopOp";
                }
                return false;
            },
            handle: (senderApplet, payload) =>
            {
                let {applet, subPath} = senderApplet;
                let stopIgnored = ()=>{
                    console.error("stopOp request from " + applet + "/" + subPath + " ignored");
                };
                let {command} = payload;
                if (command === "stopOp")
                {
                    if (currentOps.length === 0)
                    {
                        stopIgnored(); // No current ops
                        return;
                    }
                    else
                    {
                        let idx = -1;
                        let exists = currentOps.some((a, i) => {
                            if (a.applet === senderApplet.applet &&
                                a.subPath === senderApplet.subPath &&
                                a.state === senderApplet.state)
                            {
                                idx = i;
                                return true;
                            }
                            return false;
                        });
                        if (!exists) 
                        {
                            stopIgnored();
                            return; // stopOp received from applet that never started an operation.
                        }

                        // Otherwise, track that this applet completed an operation.
                        currentOps.splice(idx, 1); 

                        if (currentOps.length === 0)
                        {   // All operations are completed
                            executeTransaction();
                        }
                    }
                }
            },
        },
        {
            type: MessageTypes.Operation,
            validate: (payload) => {
                return verifyFields(payload, ["opApplet", "opSubPath", "opName", "opParams"]);
            },
            handle: (senderApplet, payload) => {
                let { opApplet, opSubPath, opName, opParams } = payload;

                currentOps = currentOps.concat([senderApplet]);
                try{
                    sendMessage(MessageTypes.Operation, 
                        senderApplet, 
                        {rApplet: opApplet, rSubPath: opSubPath}, 
                        {identifier: opName, params: opParams}, 
                        true
                    );
                }
                catch (e)
                {
                    let {applet, subPath} = senderApplet;
                    let msg = applet + "/" + subPath + "@" + opApplet + "/" + opSubPath + ":" + opName;
                    console.error("Failed to send message " + msg);
                    console.error(e);
                }
            },
        },
        {
            type: MessageTypes.Action,
            validate: (payload) => {
                return verifyFields(payload, ["application", "actionName", "params", "sender"]);
            },
            handle: async (senderApplet, payload) => {
                let {application, actionName, params, sender} = payload;
                transaction.push(makeAction(application, actionName, params, sender));
            }
        },
        {
            type: MessageTypes.Query,
            validate: (payload) => {
                return verifyFields(payload, ["callbackId", "qApplet", "qSubPath", "qName", "qParams"]);
            },
            handle: (senderApplet, payload) => {
                let {callbackId, qApplet, qSubPath, qName, qParams} = payload;

                let queryCallback = ({responseApplet, response})=>{
                    let {applet : rApplet, subPath : rSubPath} = senderApplet;
                    let {applet : sApplet, subPath : sSubPath} = responseApplet;
                    sendMessage(MessageTypes.QueryResponse, 
                        {sApplet, sSubPath},
                        {rApplet, rSubPath},
                        {callbackId, response},
                        false
                    );
                };

                runQuery(senderApplet, qApplet, qSubPath, qName, qParams, queryCallback);
            },
        },
        {
            type: MessageTypes.QueryResponse,
            validate: (payload) => {
                return verifyFields(payload, ["callbackId", "response"]);
            },
            handle: (senderApplet, payload) =>
            {
                let {callbackId, response} = payload;
                executeCallback(callbackId, {responseApplet: senderApplet, response});
            },
        },

    ], [open, executeTransaction, sendMessage, runQuery]);

    let handleMessage = useCallback(async ({applet, subPath, state}, request)=>{
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
        if (!route.validate(payload)) 
        {
            let t = type === MessageTypes.Operation ? 'Operation' : 
                type === MessageTypes.Action ? 'Action' : 
                type === MessageTypes.Query ? 'Query' : 'Unknown';
            console.error(t + " invalid with payload:");
            console.error(payload);
            return;
        }
        route.handle({applet, subPath, state}, payload);

    }, [messageRouting]);

    useEffect(()=>{
        (async () => {
            setCommonSysUrl(await getSiblingUrl());
            setTokenSysUrl(await getSiblingUrl(null, "", "applet/token-sys"));
        })();
    },[]);
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
