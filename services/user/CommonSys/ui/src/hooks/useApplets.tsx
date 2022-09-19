import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AppletId,
    executeCallback,
    MessageTypes,
    packAndPushSignedTransaction,
    storeCallback,
    verifyFields,
} from "common/rpc.mjs";
import {
    ClientOps,
    constructTransaction,
    getAppletInURL,
    getIframeId,
    injectSender,
    makeAction,
    wait,
} from "../helpers";
import {
    MessageTypeValue,
    NewAppletState,
    ReplyWithCallbackId,
} from "../types";
import { AppletStates } from "../config";

const serviceName = "common-sys";
const commonSys = new AppletId(serviceName);

/**
 * Handles Inter-Applets Comms
 */
export const useApplets = () => {
    const activeApplet = getAppletInURL();

    const [currentUser, setCurrentUser] = useState("");
    const [pendingTransactions, setPendingTransactions] = useState<any[]>([]);

    const [applets, setApplets] = useState<NewAppletState[]>([
        {
            appletId: activeApplet,
            state: AppletStates.primary,
            onInit: () => {
                updateInitializedApplets(activeApplet);
            },
        },
    ]);

    const [initializedApplets, setInitializedApplets] = useState<Set<string>>(
        new Set()
    );

    const updateInitializedApplets = (appletId: AppletId) =>
        setInitializedApplets((initializedAppletsSet) => {
            initializedAppletsSet.add(appletId.fullPath);
            return initializedAppletsSet;
        });

    const [operationCountdown, setOperationCountdown] = useState(false);

    const appletsRef = useRef<NewAppletState[]>(applets);
    appletsRef.current = applets;

    const getIndex = useCallback(
        (appletId: AppletId) =>
            appletsRef.current.findIndex((a) => {
                return a.appletId.equals(appletId);
            }),
        []
    );

    const open = useCallback(
        (appletId: AppletId) => {
            return new Promise<void>(async (resolve, reject) => {
                // Opens an applet if it's not already open
                const appletIndex = getIndex(appletId);
                if (appletIndex === -1) {
                    setApplets([
                        ...appletsRef.current,
                        {
                            appletId,
                            state: AppletStates.headless,
                            onInit: () => {
                                updateInitializedApplets(appletId);
                            },
                        },
                    ]);
                }

                // Await for applet initialization for 10 seconds
                let attempts = 1;
                while (!initializedApplets.has(appletId.fullPath)) {
                    if (attempts > 100) {
                        reject(
                            new Error(
                                `initialization of applet ${appletId.fullPath} timed out`
                            )
                        );
                        return;
                    }
                    await wait(100);
                    attempts += 1;
                }
                resolve();
            });
        },
        [getIndex, initializedApplets]
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

            const iframe = document.getElementById(getIframeId(appletId));
            if (!iframe) {
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
            let iframe;
            try {
                iframe = await getIframe(receiver, shouldOpenReceiver);
            } catch (e) {
                // Did the initiator applet navigate to a different page before getting a response?
                console.error(e);
            }

            // TODO: Could check that sender isn't on a blacklist before
            //       making the IPC call.

            const restrictedTargetOrigin = await receiver.url();
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
                        const iframe = await getIframe(
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

                        const restrictedTargetOrigin = await receiver.url();
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

    const getCurrentUser = useCallback(async () => {
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
    }, [query]);

    const signTransaction = useCallback(
        async (transactions: any[]) => {
            const accountSys = new AppletId("account-sys");

            // refreshes the current logged in user, just to guarantee it's the same
            const currentUser = await getCurrentUser();

            const transaction = await constructTransaction(
                injectSender(transactions, currentUser)
            );

            const { response: signedTransaction } = await query(
                commonSys,
                accountSys,
                "getAuthedTransaction",
                { transaction }
            );

            return signedTransaction;
        },
        [query, getCurrentUser]
    );

    const executeTransaction = useCallback(async () => {
        if (pendingTransactions.length === 0) return;

        try {
            const signedTransaction = await signTransaction(
                pendingTransactions
            );

            const trace = await packAndPushSignedTransaction(
                "",
                signedTransaction
            );
            console.info("Pushed Trx Trace >>>", trace);
        } catch (e) {
            // TODO: Don't swallow transaction errors!
            console.error(e);
        }

        setPendingTransactions([]);
    }, [pendingTransactions, signTransaction]);

    const handleOperation = useCallback(
        async (sender: AppletId, payload: any) => {
            const { callbackId, appletId, name, params } = payload;

            setOperationCountdown(false);

            const receiver = AppletId.fromObject(appletId);
            ClientOps.add(receiver);

            let reply: ReplyWithCallbackId = null;
            try {
                reply = await operation(sender, receiver, name, params);
                reply.callbackId = callbackId;
            } catch (e) {
                const msg =
                    "Common-sys failed to route message: " +
                    sender.fullPath +
                    "@" +
                    receiver.fullPath +
                    ":" +
                    name;
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
        [operation, sendMessage]
    );

    const handleQuery = useCallback(
        async (sender: AppletId, payload: any) => {
            const { callbackId, appletId, name, params } = payload;

            const receiver = AppletId.fromObject(appletId);

            let reply: ReplyWithCallbackId = null;
            try {
                reply = await query(sender, receiver, name, params);
                reply.callbackId = callbackId;
            } catch (e) {
                const msg =
                    "Common-sys failed to route message: " +
                    sender.fullPath +
                    "@" +
                    receiver.fullPath +
                    ":" +
                    name;
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
        [query, sendMessage]
    );

    const handleAction = async (sender: AppletId, payload: any) => {
        // Todo: change Action payload to use "user" rather than sender.
        //       Sender is always the applet, user is the person
        const { application, actionName, params, sender: user } = payload;
        setPendingTransactions((pendingTransactions) => [
            ...pendingTransactions,
            makeAction(application, actionName, params, user),
        ]);
        // TODO: If no operation is currently being executed, execute the transaction.
    };

    const handleQueryResponse = useCallback(
        (sender: AppletId, payload: any) => {
            const { callbackId, response, errors } = payload;
            executeCallback(callbackId, { sender, response, errors });
        },
        []
    );

    const handleOperationResponse = useCallback(
        (sender: AppletId, payload: any) => {
            const { callbackId, response, errors } = payload;
            executeCallback(callbackId, { sender, response, errors });

            ClientOps.opReturned(sender);
            if (ClientOps.allCompleted()) {
                setOperationCountdown(true);
            }
        },
        []
    );

    const messageRouting = useMemo(
        () => ({
            [MessageTypes.Operation]: {
                fields: ["callbackId", "appletId", "name", "params"],
                handle: handleOperation,
            },
            [MessageTypes.Query]: {
                fields: ["callbackId", "appletId", "name", "params"],
                handle: handleQuery,
            },
            [MessageTypes.Action]: {
                fields: ["application", "actionName", "params", "sender"],
                handle: handleAction,
            },
            [MessageTypes.QueryResponse]: {
                fields: ["callbackId", "response", "errors"],
                handle: handleQueryResponse,
            },
            [MessageTypes.OperationResponse]: {
                fields: ["callbackId", "response", "errors"],
                handle: handleOperationResponse,
            },
        }),
        [
            handleOperation,
            handleOperationResponse,
            handleQuery,
            handleQueryResponse,
        ]
    );

    const handleMessage = useCallback(
        async (sender: AppletId, request: any) => {
            const { type, payload } = request.message;
            if (!type || !payload) {
                console.error("Received malformed message from applet");
                return;
            }

            const route = messageRouting[type];
            if (!route) {
                console.error("Message from applet specifies unknown route.");
                return;
            }

            if (!verifyFields(payload, route.fields)) {
                console.error(type + " invalid with payload:", payload);
                return;
            }

            route.handle(sender, payload);
        },
        [messageRouting]
    );

    useEffect(() => {
        getCurrentUser();
    }, [getCurrentUser]);

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
    }, [operationCountdown, executeTransaction]);

    return {
        applets,
        currentUser,
        messageRouting,
        handleMessage,
    };
};
