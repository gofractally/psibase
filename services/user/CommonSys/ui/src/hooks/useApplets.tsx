import { useCallback, useEffect, useMemo, useState } from "react";
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

const SERVICE_NAME = "common-sys";
const ACCOUNT_SYS = new AppletId("account-sys", "");
const COMMON_SYS = new AppletId(SERVICE_NAME);
const ACTIVE_APPLET = getAppletInURL();

type AppletsMap = {
    [appletPath: string]: NewAppletState;
};

/**
 * Handles Inter-Applets Comms
 */
export const useApplets = () => {
    const [currentUser, setCurrentUser] = useState("");
    const [pendingActions, setPendingActions] = useState<any[]>([]);

    const [applets, setApplets] = useState<AppletsMap>({
        [ACTIVE_APPLET.fullPath]: {
            appletId: ACTIVE_APPLET,
            state: AppletStates.primary,
            onInit: () => {
                updateInitializedApplets(ACTIVE_APPLET);
            },
        },
    });

    const [initializedApplets, setInitializedApplets] = useState<Set<string>>(
        new Set()
    );

    const updateInitializedApplets = (appletId: AppletId) =>
        setInitializedApplets((initializedAppletsSet) => {
            initializedAppletsSet.add(appletId.fullPath);
            return initializedAppletsSet;
        });

    const [rootOperationReply, setRootOperationReply] =
        useState<any>(undefined);

    // Opens an applet if it's not already open
    const open = useCallback(
        async (appletId: AppletId) => {
            const appletPath = appletId.fullPath;
            if (!applets[appletPath]) {
                setApplets({
                    ...applets,
                    [appletPath]: {
                        appletId,
                        state: AppletStates.headless,
                        onInit: () => {
                            updateInitializedApplets(appletId);
                        },
                    },
                });
            }

            // Await for applet initialization for 10 seconds
            let attempts = 1;
            while (!initializedApplets.has(appletId.fullPath)) {
                if (attempts > 100) {
                    throw new Error(
                        `initialization of applet ${appletId.fullPath} timed out`
                    );
                }
                await wait(100);
                attempts += 1;
            }
        },
        [initializedApplets, applets]
    );

    const getIframe = useCallback(
        async (appletId: AppletId, shouldOpen?: boolean) => {
            if (!shouldOpen && !applets[appletId.fullPath]) {
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
        [open, applets]
    );

    const sendMessage = useCallback(
        async (
            messageType: MessageTypeValue,
            sender: AppletId,
            receiver: AppletId,
            payload: any,
            shouldOpenReceiver?: boolean
        ) => {
            const iframe = await getIframe(receiver, shouldOpenReceiver);
            const restrictedTargetOrigin = await receiver.url();

            // TODO: Could check that sender isn't on a blacklist before making the IPC call.
            // TODO: handle timeout if I never get a response from an applet
            return new Promise<{ response: any; errors: any }>(
                (resolve, reject) => {
                    try {
                        if (!payload.callbackId) {
                            payload.callbackId = storeCallback(
                                ({
                                    sender: responseApplet,
                                    response,
                                    errors,
                                }) => {
                                    if (!responseApplet.equals(receiver)) {
                                        return;
                                    }
                                    resolve({ response, errors });
                                    // TODO: Consider creating a QueryResponse object with these two fields
                                }
                            );
                        }

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

    const sendQuery = useCallback(
        (
            sender: AppletId,
            receiver: AppletId,
            identifier: string,
            params: any = {}
        ) => {
            return sendMessage(
                MessageTypes.Query,
                sender,
                receiver,
                { identifier, params },
                true
            );
        },
        [sendMessage]
    );

    const getCurrentUser = useCallback(async () => {
        try {
            const { response } = await sendQuery(
                COMMON_SYS,
                ACCOUNT_SYS,
                "getLoggedInUser"
            );
            setCurrentUser(response);
            return response;
        } catch (e) {
            console.error("ERROR FETCHING CURRENT USER:", e);
        }
    }, [sendQuery]);

    const signTransaction = useCallback(
        async (transactions: any[]) => {
            // refreshes the current logged in user, just to guarantee it's the same
            const currentUser = await getCurrentUser();

            const transaction = await constructTransaction(
                injectSender(transactions, currentUser)
            );

            console.log("getAuthed query params >>>", {
                commonSys: COMMON_SYS,
                accountSys: ACCOUNT_SYS,
                transaction,
            });

            const { errors, response: signedTransaction } = await sendQuery(
                COMMON_SYS,
                ACCOUNT_SYS,
                "getAuthedTransaction",
                { transaction }
            );
            if (!signedTransaction) {
                console.error("There is no signed transaction", {
                    signedTransaction,
                    errors,
                });
                throw new Error(`No signed transaction returned: ${errors}`);
            }

            return signedTransaction;
        },
        [sendQuery, getCurrentUser]
    );

    const executeTransaction = useCallback(async () => {
        if (pendingActions.length === 0 || !rootOperationReply) {
            console.log("returning now as there is no pendingTransaction?");
            return;
        }

        const { callbackId, payload } = rootOperationReply;
        try {
            const signedTransaction = await signTransaction(pendingActions);

            const trace = await packAndPushSignedTransaction(
                "",
                signedTransaction
            );
            console.info("Pushed Trx Trace >>>", trace);
            payload.response = trace;
        } catch (e) {
            const exceptionMessage = e
                ? (e as Error).message
                : `Unknown error: ${e}`;
            console.error("Failure when pushing trx:", exceptionMessage, e);
            payload.errors.push(exceptionMessage);
        }

        console.info(">>> calling final ops cb!", rootOperationReply);
        await executeCallback(callbackId, payload);
        console.info(">>> final ops cb executed!", callbackId, payload);

        // TODO: broadcast all events

        setPendingActions([]);
        setRootOperationReply(undefined);
    }, [pendingActions, rootOperationReply, signTransaction]);

    const makeErroredReply = (
        sender: AppletId,
        receiver: AppletId,
        payload: any,
        error: any
    ): ReplyWithCallbackId => {
        const msg =
            "Common-sys failed to route message: " +
            sender.fullPath +
            "@" +
            receiver.fullPath +
            ":" +
            payload.name;
        const exceptionMessage = error
            ? (error as Error).message
            : `Unknown error: ${error}`;
        const reply = {
            callbackId: payload.callbackId,
            response: null,
            errors: [exceptionMessage, msg],
        };
        console.error("Errored response >>>", {
            sender,
            receiver,
            payload,
            reply,
        });
        return reply;
    };

    const handleOperation = useCallback(
        async (sender: AppletId, payload: any) => {
            const { callbackId, appletId, name, params } = payload;

            setRootOperationReply(undefined);

            const receiver = AppletId.fromObject(appletId);
            ClientOps.add(receiver);

            let reply: ReplyWithCallbackId = null;
            try {
                reply = await sendMessage(
                    MessageTypes.Operation,
                    sender,
                    receiver,
                    { identifier: name, params },
                    true
                );
                reply.callbackId = callbackId;
            } catch (e) {
                reply = makeErroredReply(sender, receiver, payload, e);
            }

            sendMessage(
                MessageTypes.OperationResponse,
                receiver,
                sender,
                reply,
                false
            );
        },
        [sendMessage]
    );

    const handleQuery = useCallback(
        async (sender: AppletId, payload: any) => {
            const { callbackId, appletId, name, params } = payload;

            const receiver = AppletId.fromObject(appletId);

            let reply: ReplyWithCallbackId = null;
            try {
                reply = await sendQuery(sender, receiver, name, params);
                reply.callbackId = callbackId;
            } catch (e) {
                reply = makeErroredReply(sender, receiver, payload, e);
            }

            sendMessage(
                MessageTypes.QueryResponse,
                receiver,
                sender,
                reply,
                false
            );
        },
        [sendQuery, sendMessage]
    );

    const handleAction = (sender: AppletId, payload: any) => {
        // Todo: change Action payload to use "user" rather than sender.
        //       Sender is always the applet, user is the person
        const { application, actionName, params, sender: user } = payload;
        const action = makeAction(application, actionName, params, user);
        setPendingActions((pendingActions) => [...pendingActions, action]);
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
        async (sender: AppletId, payload: any) => {
            const { callbackId, response, errors } = payload;
            console.info(">>> executing cb...", callbackId, payload);

            ClientOps.opReturned(sender);
            if (ClientOps.allCompleted()) {
                console.info(">>> cops completed!");
                setRootOperationReply({
                    callbackId,
                    payload: { sender, response, errors },
                });
            } else {
                await executeCallback(callbackId, { sender, response, errors });
                console.info(
                    ">>> intermediate cb executed!",
                    callbackId,
                    payload
                );
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
            console.info(">>> appletHandleMessage ", sender, request);

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
        if (rootOperationReply) {
            // Eventually we may not want to execute the transaction when the operation ends.
            // (Send the transaction to the msig applet or something)
            timer = setTimeout(executeTransaction, 100);
        } else {
            clearTimeout(timer);
        }
        // TODO: Cleanup
    }, [rootOperationReply, executeTransaction]);

    const [primaryApplet, subApplets] = useMemo(() => {
        const primaryPath = ACTIVE_APPLET.fullPath;
        const primaryApplet = applets[primaryPath];
        const subApplets = Object.keys(applets)
            .filter((key) => key !== primaryPath)
            .map((key) => applets[key]);
        return [primaryApplet, subApplets];
    }, [applets]);

    return {
        applets,
        primaryApplet,
        subApplets,
        currentUser,
        messageRouting,
        handleMessage,
    };
};
