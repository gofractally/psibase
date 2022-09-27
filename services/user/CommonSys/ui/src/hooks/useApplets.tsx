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

const SERVICE_NAME = "common-sys";
const ACCOUNT_SYS = new AppletId("account-sys", "");
const COMMON_SYS = new AppletId(SERVICE_NAME);
const ACTIVE_APPLET = getAppletInURL();

type AppletsMap = {
    [appletPath: string]: NewAppletState;
};

type TransactionReceipt = {
    trace: any;
    errors: string[];
};

type PendingTransaction = {
    id: number;
    actions: any[];
    applets: Set<AppletId>;
    transactionReceipt?: TransactionReceipt;
};

/**
 * Handles Inter-Applets Comms
 */
export const useApplets = () => {
    const [currentUser, setCurrentUser] = useState("");

    // Group of pending transactions, for every new transaction a new object is created,
    // this way children applets can access transactions that happened before, if needed.
    const pendingTransactions = useRef<PendingTransaction[]>([
        { id: 0, actions: [], applets: new Set() },
    ]);

    // Current pending transaction id: for every new submitted operation it will bump the
    // transaction Id, which signalizes that a trx is happening and create a new pendingTransaction
    // object; When the operation and it nested operations are complete, it will be reset to zero
    const pendingTransactionId = useRef(0);

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
        ): Promise<ReplyWithCallbackId> => {
            const iframe = await getIframe(receiver, shouldOpenReceiver);
            const restrictedTargetOrigin = await receiver.url();

            // TODO: Could check that sender isn't on a blacklist before making the IPC call.
            // TODO: handle timeout if I never get a response from an applet
            return new Promise<ReplyWithCallbackId>((resolve, reject) => {
                try {
                    if (!payload.callbackId) {
                        payload.callbackId = storeCallback(
                            ({ sender: responseApplet, response, errors }) => {
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
            });
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
        if (pendingTransactionId.current === 0) {
            console.error(
                "returning now as there is no pending transaction happening"
            );
            return;
        }

        const pendingTransaction =
            pendingTransactions.current[pendingTransactionId.current];

        const transactionReceipt: TransactionReceipt = {
            trace: {},
            errors: [],
        };
        try {
            const { actions } = pendingTransaction;
            const signedTransaction = await signTransaction(actions);

            const trace = await packAndPushSignedTransaction(
                "",
                signedTransaction
            );
            transactionReceipt.trace = trace;
        } catch (e) {
            const exceptionMessage = e
                ? (e as Error).message
                : `Unknown error: ${e}`;
            console.error("Failure when pushing trx:", exceptionMessage, e);
            transactionReceipt.errors.push(exceptionMessage);
        }

        pendingTransaction.transactionReceipt = transactionReceipt;

        // Broadcast trx receipts to all involved Applets
        pendingTransaction.applets.forEach((applet) => {
            sendMessage(MessageTypes.TransactionReceipt, COMMON_SYS, applet, {
                ...transactionReceipt,
                transactionId: pendingTransaction.id,
            });
        });

        // TODO: broadcast globally all events, properly parsed from the receipt

        pendingTransactionId.current = 0;
    }, [sendMessage, signTransaction]);

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
            response: {},
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
            let transactionId = pendingTransactionId.current;
            if (transactionId === 0) {
                transactionId = pendingTransactions.current.length;
                pendingTransactionId.current = transactionId;
                pendingTransactions.current.push({
                    id: transactionId,
                    actions: [],
                    applets: new Set(),
                });
            }

            const { callbackId, appletId, name, params } = payload;

            const receiver = AppletId.fromObject(appletId);
            ClientOps.add(receiver);

            let reply: ReplyWithCallbackId;
            try {
                reply = await sendMessage(
                    MessageTypes.Operation,
                    sender,
                    receiver,
                    { identifier: name, params },
                    true
                );
                reply.response = reply.response ?? {};
                reply.callbackId = callbackId;
            } catch (e) {
                reply = makeErroredReply(sender, receiver, payload, e);
            }
            reply.response.transactionId = transactionId;

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

            let reply: ReplyWithCallbackId;
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

        const pendingTransaction =
            pendingTransactions.current[pendingTransactionId.current];
        pendingTransaction.applets.add(sender);
        pendingTransaction.actions.push(action);

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

            await executeCallback(callbackId, { sender, response, errors });

            ClientOps.opReturned(sender);
            if (ClientOps.allCompleted()) {
                executeTransaction();
            }
        },
        [executeTransaction]
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
