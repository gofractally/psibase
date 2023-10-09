import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AppletId,
    ChangeHistoryPayload,
    executeCallback,
    GetClaimParams,
    MessageTypes,
    packAndDigestTransaction,
    packAndPushSignedTransaction,
    storeCallback,
    verifyFields,
    WrappedClaim,
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
const CLAIM_APPLETS: Map<string, AppletId> = new Map([
    ["auth-ec-sys", new AppletId("auth-ec-sys", "")],
]);

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
                            // @ts-ignore
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
                { identifier, params, sender: sender.name },
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

            const claimParams: GetClaimParams[] = Array.from(
                transaction.actions.map((action: any) => ({
                    service: action.service,
                    sender: action.sender,
                    method: action.method,
                    data: action.data,
                }))
            );

            const accountsQueryResponse = await sendQuery(
                COMMON_SYS,
                ACCOUNT_SYS,
                "getAccounts"
            );

            interface AccountWithAuth {
                accountNum: string;
                authService: string;
            }

            const accounts =
                accountsQueryResponse.response as AccountWithAuth[];

            const accountsMap = accounts.reduce((acc, account) => {
                acc.set(account.accountNum, account);
                return acc;
            }, new Map<string, AccountWithAuth>());

            const actionSenderClaims = claimParams
                .filter((action: any) => action.sender)
                .map((claimParams) => {
                    // For now we only support `auth-ec-sys`
                    if (
                        accountsMap.get(claimParams.sender)?.authService !==
                        "auth-ec-sys"
                    ) {
                        return undefined;
                    }

                    return sendQuery(
                        COMMON_SYS,
                        CLAIM_APPLETS.get("auth-ec-sys")!,
                        "getClaim",
                        claimParams
                    )
                        .then((q) => q.response)
                        .catch((error) => {
                            console.error(
                                "error getting sender claim from authService for params",
                                claimParams,
                                error
                            );
                            return undefined;
                        });
                })
                .filter((item) => item) as Promise<WrappedClaim>[];

            const actionAppClaims = claimParams
                .filter((action: any) => action.service)
                .map((claimParams) => {
                    if (!CLAIM_APPLETS.has(claimParams.service)) {
                        CLAIM_APPLETS.set(
                            claimParams.service,
                            new AppletId(claimParams.service, "")
                        );
                    }

                    return sendQuery(
                        COMMON_SYS,
                        CLAIM_APPLETS.get(claimParams.service)!,
                        "getClaim",
                        claimParams
                    )
                        .then((q) => q.response)
                        .catch((error) => {
                            console.info(
                                "applet did not retrieve any claim",
                                claimParams,
                                error
                            );
                            return undefined;
                        });
                })
                .filter((item) => item) as Promise<WrappedClaim>[];

            const claimRequests: WrappedClaim[] = await Promise.all([
                // Sender claims
                ...actionSenderClaims,
                // Application claims
                ...actionAppClaims,
            ]);

            const claims = claimRequests.filter(
                (claim, idx) =>
                    claim &&
                    // ignore duplicates
                    idx ===
                        claimRequests.findIndex(
                            (c) => c.pubkey === claim.pubkey
                        )
            );

            const { transactionHex, digest: trxDigest } =
                await packAndDigestTransaction("", {
                    ...transaction,
                    claims: claims.map((c: WrappedClaim) => c.claim),
                });

            const proofsPromises = await Promise.all(
                claims.map(async (claim: WrappedClaim) => {
                    try {
                        const { response } = await sendQuery(
                            COMMON_SYS,
                            ACCOUNT_SYS,
                            "getProof",
                            { claim, trxDigest }
                        );
                        return response?.proof;
                    } catch (e) {
                        console.error("error getting proof", e);
                        return undefined;
                    }
                })
            );

            const proofs = proofsPromises.filter((item) => item);

            const signedTransaction = { transaction: transactionHex, proofs };
            return signedTransaction;
        },
        [sendQuery, getCurrentUser]
    );

    const executeTransaction = useCallback(async () => {
        const isNoPendingTransaction = pendingTransactionId.current === 0;
        if (isNoPendingTransaction) return;

        const pendingTransaction =
            pendingTransactions.current[pendingTransactionId.current];
        const { actions } = pendingTransaction;

        if (actions.length == 0) {
            return;
        }

        const transactionReceipt: TransactionReceipt = {
            trace: {},
            errors: [],
        };

        try {
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
            // @ts-ignore
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
                    { identifier: name, params, sender: sender.name },
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

    const handleSetActiveUser = useCallback(
        (applet: AppletId, payload: any) => {
            if (applet.name === "account-sys") {
                return setCurrentUser(payload.account);
            }
            console.error(
                "Not authorized: only AccountSys may set the active account in CommonSys."
            );
        },
        [setCurrentUser]
    );

    const handleChangeHistory = useCallback(
        async (
            applet: AppletId,
            { pathname, search, hash }: ChangeHistoryPayload
        ) => {
            // Set history only if the applet is the active one
            if (ACTIVE_APPLET.name === applet.name) {
                // Trim the leading slash because we can't load applets with "/" in their name
                const appletPath = pathname === "/" ? "" : pathname;

                // Set the new applet subpath
                const newPath = `/applet/${applet.name}${appletPath}${search}${hash}`;

                window.history.replaceState(undefined, "", newPath);
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
            [MessageTypes.SetActiveAccount]: {
                fields: ["account"],
                handle: handleSetActiveUser,
            },
            [MessageTypes.ChangeHistory]: {
                fields: ["pathname", "search", "hash"],
                handle: handleChangeHistory,
            },
        }),
        [
            handleOperation,
            handleOperationResponse,
            handleQuery,
            handleQueryResponse,
            handleSetActiveUser,
            handleChangeHistory,
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
