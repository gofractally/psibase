import {
    initializeApplet,
    action,
    operation,
    query,
    setOperations,
    setQueries,
    getJson,
    AppletId,
    packAndDigestTransaction,
    uint8ArrayToHex,
} from "common/rpc.mjs";
import {
    privateStringToKeyPair,
    signatureToFracpack,
} from "common/keyConversions.mjs";
import { KeyPairWithAccounts } from "./App";

interface execArgs {
    name?: any;
    pubKey?: any;
    transaction?: any;
}

const claimApplets: Map<string, AppletId> = new Map();

export const initAppFn = (setAppInitialized: () => void) =>
    initializeApplet(async () => {
        const thisApplet = await getJson<string>("/common/thisservice");
        const accountSysApplet = new AppletId(thisApplet, "");
        claimApplets.set("auth-ec-sys", new AppletId("auth-ec-sys", ""));

        setOperations([
            {
                id: "newAcc",
                exec: async ({ name, pubKey }: execArgs) => {
                    await action(
                        thisApplet,
                        "newAccount",
                        {
                            name,
                            authService: "auth-any-sys",
                            requireNew: true,
                        },
                        "account-sys" // TODO: should we handle the sender for newAccount better?
                    );

                    if (pubKey && pubKey !== "") {
                        await operation(accountSysApplet, "setKey", {
                            name,
                            pubKey,
                        });
                    }
                },
            },
            {
                id: "setKey",
                exec: async ({ name, pubKey }: execArgs) => {
                    if (pubKey !== "") {
                        await action(
                            "auth-ec-sys",
                            "setKey",
                            { key: pubKey },
                            name
                        );
                        await action(
                            thisApplet,
                            "setAuthCntr",
                            { authService: "auth-ec-sys" },
                            name
                        );
                    }
                },
            },
        ]);
        setQueries([
            {
                id: "getLoggedInUser",
                exec: (params: any) => {
                    // TODO - Get the actual logged in user
                    return JSON.parse(
                        window.localStorage.getItem("currentUser") || ""
                    );
                },
            },
            {
                id: "getAuthedTransaction",
                exec: async ({ transaction }: execArgs): Promise<any> => {
                    console.info("transaction >>>", transaction);

                    interface AccountWithAuthService {
                        accountNum: string;
                        authService: string;
                    }

                    interface GetClaimParams {
                        service: string;
                        sender: string;
                        actionName: string;
                        params: any;
                    }

                    const [accounts] = await Promise.all([
                        // query<null, string>(
                        //     accountSysApplet,
                        //     "getLoggedInUser"
                        // ),
                        getJson<AccountWithAuthService[]>("/accounts"),
                    ]);
                    console.info("accounts >>>", accounts);
                    const accountsMap = accounts.reduce((acc, account) => {
                        acc.set(account.accountNum, account);
                        return acc;
                    }, new Map<string, AccountWithAuthService>());
                    console.info("accountsMap >>>", accountsMap);

                    // TODO: optimize by removing any duplicates
                    const claimParams: GetClaimParams[] = Array.from(
                        transaction.actions.map((action: any) => ({
                            service: action.service,
                            sender: action.sender,
                            method: action.method,
                            data: action.data,
                        }))
                    );
                    console.info("claimParams >>>", claimParams);

                    const claimRequests = [
                        // Sender claims
                        ...claimParams
                            .filter((action: any) => action.sender)
                            .map((claimParams) => {
                                // For now we only support `auth-ec-sys`
                                if (
                                    accountsMap.get(claimParams.sender)
                                        ?.authService !== "auth-ec-sys"
                                ) {
                                    return undefined;
                                }

                                return query(
                                    claimApplets.get("auth-ec-sys")!,
                                    "getClaim",
                                    claimParams
                                ).catch((error) => {
                                    console.error(
                                        "error getting sender claim from authService for params",
                                        claimParams,
                                        error
                                    );
                                    return undefined;
                                });
                            })
                            .filter((claimRequest) => claimRequest),
                        // Application claims
                        ...claimParams
                            .filter((action: any) => action.service)
                            .map((claimParams) => {
                                if (!claimApplets.has(claimParams.service)) {
                                    claimApplets.set(
                                        claimParams.service,
                                        new AppletId(claimParams.service, "")
                                    );
                                }

                                return query(
                                    claimApplets.get(claimParams.service)!,
                                    "getClaim",
                                    claimParams
                                ).catch((error) => {
                                    console.info(
                                        "applet did not retrieve any claim",
                                        claimParams,
                                        error
                                    );
                                    return undefined;
                                });
                            })
                            .filter((claimRequest) => claimRequest),
                    ];
                    console.info("claimRequests >>>", claimRequests);

                    const claims = (await Promise.all(claimRequests)).filter(
                        (claim: any) => claim
                    );
                    console.info("claims >>>", claims);
                    // TODO: remove duplicates?

                    const { transactionHex, digest } =
                        await packAndDigestTransaction("", {
                            ...transaction,
                            claims: claims.map((c: any) => c.claim),
                        });
                    console.info("trx >>>", transactionHex, digest);

                    // TODO: migrate to keyvault
                    const keys = JSON.parse(
                        localStorage.getItem("keyPairs") || "[]"
                    ) as KeyPairWithAccounts[];

                    const proofs = claims
                        .map((claim: any) =>
                            keys.find((key) => key.publicKey === claim.pubkey)
                        )
                        .filter((key) => key)
                        .map((key) => {
                            const k = privateStringToKeyPair(key!.privateKey);
                            const packedSignature = signatureToFracpack({
                                keyType: k.keyType,
                                signature: k.keyPair.sign(digest),
                            });
                            return uint8ArrayToHex(packedSignature);
                        });
                    console.info("proofs >>>", proofs);

                    return { transaction: transactionHex, proofs };
                },
            },
        ]);
        setAppInitialized();
    });
