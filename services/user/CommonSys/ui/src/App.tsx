import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Route } from "react-router-dom";

import {
    packAndPushSignedTransaction,
    MessageTypes,
    verifyFields,
    storeCallback,
    executeCallback,
    AppletId,
} from "common/rpc.mjs";

import {
    HandleMessage,
    MessageTypeValue,
    NewAppletState,
    ReplyWithCallbackId,
} from "./types";
import config, { AppletStates } from "./config";
import {
    ClientOps,
    constructTransaction,
    getAppletInURL,
    getIframeId,
    injectSender,
    makeAction,
    wait,
} from "./helpers";
import { Applet, Dashboard, Nav } from "./views";

function OtherApplets({
    applets,
    handleMessage,
}: {
    applets: NewAppletState[];
    handleMessage: HandleMessage;
}) {
    const nonPrimaryApplets = applets.filter(
        (a) => a.state !== AppletStates.primary
    );
    return (
        <>
            {nonPrimaryApplets.map((a) => (
                <Applet
                    applet={a}
                    handleMessage={handleMessage}
                    key={a.appletId.name}
                />
            ))}
        </>
    );
}

let serviceName = "common-sys";
let commonSys = new AppletId(serviceName);

// TODO: Ensure pending transaction is cleared if there are any errors. Otherwise, we could accidentally submit double actions if the user retries an action.
let pendingTransaction: any[] = [];

const App = () => {
    const activeApplet = getAppletInURL();
    const [currentUser, setCurrentUser] = useState("");
    const [initializedApplets, setInitializedApplets] = useState<Set<string>>(
        new Set()
    );
    const [applets, setApplets] = useState<NewAppletState[]>([
        {
            appletId: activeApplet,
            state: AppletStates.primary,
            onInit: () => {
                updateInitializedApplets(activeApplet);
            },
        },
    ]);
    const [operationCountdown, setOperationCountdown] = useState(false);

    const appletsRef = useRef<NewAppletState[]>(applets);
    appletsRef.current = applets;

    const updateInitializedApplets = useCallback(
        (appletId: AppletId) => {
            setInitializedApplets((initializedAppletsSet) => {
                initializedAppletsSet.add(appletId.fullPath);
                return initializedAppletsSet;
            });
        },
        [setInitializedApplets]
    );

    const getCurrentUser = async () => {
        try {
            const accountSys = new AppletId("account-sys", "");
            const { response } = await query(
                commonSys,
                accountSys,
                "getLoggedInUser"
            );
            setCurrentUser(response);
            return response;
        } catch (e) {
            console.error("ERROR FETCHING CURRENT USER:", e);
        }
    };

    useEffect(() => {
        getCurrentUser();
    }, []);

    const getIndex = useCallback((appletId: AppletId) => {
        return appletsRef.current.findIndex((a) => {
            return a.appletId.equals(appletId);
        });
    }, []);

    useEffect(() => {
        let timer;
        if (operationCountdown) {
            // Eventually we may not want to execute the transaction when the operation ends.
            // (Send the transaction to the msig applet or something)
            timer = setTimeout(executeTransaction, 100);
        } else {
            clearTimeout(timer);
        }
        // TODO: Cleanup
    }, [operationCountdown]);

    const open = useCallback(
        (appletId: AppletId) => {
            return new Promise<void>(async (resolve, reject) => {
                // Opens an applet if it's not already open
                let index = getIndex(appletId);
                if (index === -1) {
                    setApplets([
                        ...appletsRef.current,
                        {
                            appletId,
                            state: AppletStates.headless,
                            onInit: () => {
                                updateInitializedApplets(appletId);
                                resolve();
                            },
                        },
                    ]);
                } else {
                    let attempts = 1;
                    while (!initializedApplets.has(appletId.fullPath)) {
                        if (attempts > 30) {
                            reject(
                                new Error(
                                    `initialization of applet ${appletId.fullPath} timed out`
                                )
                            );
                            return;
                        }
                        await wait(50);
                        attempts += 1;
                    }
                    // Applet is already open, invoke callback immediately
                    resolve();
                }
            });
        },
        [getIndex, updateInitializedApplets]
    );

    const getIframe = useCallback(
        async (appletId: AppletId, shouldOpen: boolean) => {
            if (!shouldOpen && getIndex(appletId) === -1) {
                throw (
                    "Applet [" +
                    appletId.fullPath +
                    "] not open, but it should have been."
                );
            }

            await open(appletId);

            var iframe = document.getElementById(getIframeId(appletId));
            if (iframe == null) {
                throw (
                    "Applet " +
                    appletId.fullPath +
                    " not found, send message failed."
                );
            }

            return iframe;
        },
        [open, getIndex]
    );

    const sendMessage = useCallback(
        async (
            messageType: MessageTypeValue,
            sender: AppletId,
            receiver: AppletId,
            payload: any,
            shouldOpenReceiver: boolean
        ) => {
            var iframe;
            try {
                iframe = await getIframe(receiver, shouldOpenReceiver);
            } catch (e) {
                // Did the initiator applet navigate to a different page before getting a response?
                console.error(e);
            }

            // TODO: Could check that sender isn't on a blacklist before
            //       making the IPC call.

            let restrictedTargetOrigin = await receiver.url();
            (iframe as any).iFrameResizer.sendMessage(
                { type: messageType, payload },
                restrictedTargetOrigin
            );
        },
        [getIframe]
    );

    const sendMessageGetResponse = useCallback(
        async (
            messageType: MessageTypeValue,
            sender: AppletId,
            receiver: AppletId,
            payload: any,
            shouldOpenReceiver: boolean
        ) => {
            // TODO: Could check that sender isn't on a blacklist before making the IPC call.
            // TODO: handle timeout if I never get a response from an applet
            return new Promise<{ response: any; errors: any }>(
                async (resolve, reject) => {
                    try {
                        let iframe = await getIframe(
                            receiver,
                            shouldOpenReceiver
                        );

                        payload.callbackId = storeCallback(
                            ({
                                sender: responseApplet,
                                response,
                                errors,
                            }: {
                                sender: AppletId;
                                response: any;
                                errors: any;
                            }) => {
                                if (!responseApplet.equals(receiver)) {
                                    return;
                                }
                                resolve({ response, errors });
                                // TODO: Consider creating a QueryResponse object with these two fields
                            }
                        );

                        let restrictedTargetOrigin = await receiver.url();
                        (iframe as any).iFrameResizer.sendMessage(
                            { type: messageType, payload },
                            restrictedTargetOrigin
                        );
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        },
        [getIframe]
    );

    const query = useCallback(
        (
            sender: AppletId,
            receiver: AppletId,
            name: string,
            params: any = {}
        ) => {
            return sendMessageGetResponse(
                MessageTypes.Query,
                sender,
                receiver,
                { identifier: name, params },
                true
            );
        },
        [sendMessageGetResponse]
    );

    const operation = useCallback(
        (
            sender: AppletId,
            receiver: AppletId,
            name: string,
            params: any = {}
        ) => {
            return sendMessageGetResponse(
                MessageTypes.Operation,
                sender,
                receiver,
                { identifier: name, params },
                true
            );
        },
        [sendMessageGetResponse]
    );

    const executeTransaction = useCallback(async () => {
        if (pendingTransaction.length === 0) return;

        try {
            let accountSys = new AppletId("account-sys");
            let { response: user } = await query(
                commonSys,
                accountSys,
                "getLoggedInUser"
            );
            let transaction = await constructTransaction(
                injectSender(pendingTransaction, user)
            );
            let { response: signedTransaction } = await query(
                commonSys,
                accountSys,
                "getAuthedTransaction",
                { transaction }
            );
            let baseUrl = ""; // default
            let trace = await packAndPushSignedTransaction(
                baseUrl,
                signedTransaction
            );
            console.log(trace);
        } catch (e) {
            // TODO: Don't swallow transaction errors!
            console.error(e);
        }
        pendingTransaction = [];
    }, [query]);

    const messageRouting = useMemo(
        () => [
            {
                type: MessageTypes.Operation,
                fields: ["callbackId", "appletId", "name", "params"],
                handle: async (sender: AppletId, payload: any) => {
                    let { callbackId, appletId, name, params } = payload;

                    setOperationCountdown(false);

                    let receiver = AppletId.fromObject(appletId);
                    ClientOps.add(receiver);

                    var reply: ReplyWithCallbackId = null;
                    try {
                        reply = await operation(sender, receiver, name, params);
                        reply.callbackId = callbackId;
                    } catch (e) {
                        let msg =
                            sender.fullPath +
                            "@" +
                            receiver.fullPath +
                            ":" +
                            name;
                        msg = "Common-sys failed to route message: " + msg;
                        reply = {
                            callbackId,
                            response: null,
                            errors: [e, msg],
                        };
                    }

                    sendMessage(
                        MessageTypes.OperationResponse,
                        receiver,
                        sender,
                        reply,
                        false
                    );
                },
            },
            {
                type: MessageTypes.Query,
                fields: ["callbackId", "appletId", "name", "params"],
                handle: async (sender: AppletId, payload: any) => {
                    let { callbackId, appletId, name, params } = payload;

                    let receiver = AppletId.fromObject(appletId);

                    var reply: ReplyWithCallbackId = null;
                    try {
                        reply = await query(sender, receiver, name, params);
                        reply.callbackId = callbackId;
                    } catch (e) {
                        let msg =
                            sender.fullPath +
                            "@" +
                            receiver.fullPath +
                            ":" +
                            name;
                        msg = "Common-sys failed to route message: " + msg;
                        reply = {
                            callbackId,
                            response: null,
                            errors: [e, msg],
                        };
                    }

                    sendMessage(
                        MessageTypes.QueryResponse,
                        receiver,
                        sender,
                        reply,
                        false
                    );
                },
            },
            {
                type: MessageTypes.Action,
                fields: ["application", "actionName", "params", "sender"],
                handle: async (sender: AppletId, payload: any) => {
                    // Todo: change Action payload to use "user" rather than sender.
                    //       Sender is always the applet, user is the person
                    let {
                        application,
                        actionName,
                        params,
                        sender: user,
                    } = payload;
                    pendingTransaction.push(
                        makeAction(application, actionName, params, user)
                    );

                    // TODO: If no operation is currently being executed, execute the transaction.
                },
            },
            {
                type: MessageTypes.QueryResponse,
                fields: ["callbackId", "response", "errors"],
                handle: (sender: AppletId, payload: any) => {
                    let { callbackId, response, errors } = payload;
                    executeCallback(callbackId, { sender, response, errors });
                },
            },
            {
                type: MessageTypes.OperationResponse,
                fields: ["callbackId", "response", "errors"],
                handle: (sender: AppletId, payload: any) => {
                    let { callbackId, response, errors } = payload;
                    executeCallback(callbackId, { sender, response, errors });

                    ClientOps.opReturned(sender);
                    if (ClientOps.allCompleted()) {
                        setOperationCountdown(true);
                    }
                },
            },
        ],
        [
            open,
            executeTransaction,
            sendMessage,
            sendMessageGetResponse,
            operationCountdown,
        ]
    );

    const handleMessage = useCallback(
        async (sender: AppletId, request: any) => {
            let { type, payload } = request.message;
            if (type === undefined || payload === undefined) {
                console.error("Received malformed message from applet");
                return;
            }
            let route = messageRouting.find((m) => m.type === type);
            if (route === undefined) {
                console.error("Message from applet specifies unknown route.");
                return;
            }

            if (!verifyFields(payload, route.fields)) {
                console.error(type + " invalid with payload:");
                console.error(payload);
                return;
            }

            route.handle(sender, payload);
        },
        [messageRouting]
    );

    const primaryApplet = applets[0];

    return (
        <div className="mx-auto max-w-screen-xl">
            <Nav currentUser={currentUser} />
            <BrowserRouter>
                <div>
                    <Route path="/" exact>
                        <Dashboard currentUser={currentUser} />
                    </Route>
                    <Route path={config.appletPrefix}>
                        <Applet
                            applet={primaryApplet}
                            handleMessage={handleMessage}
                        />
                    </Route>
                </div>
            </BrowserRouter>
            <div>
                <OtherApplets applets={applets} handleMessage={handleMessage} />
            </div>
        </div>
    );
};

export default App;
