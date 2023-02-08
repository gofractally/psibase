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
import { AccountWithKey, KeyPair, KeyPairWithAccounts } from "./App";

interface execArgs {
    name?: any;
    pubKey?: any;
    transaction?: any;
}

const claimApplets: Map<string, AppletId> = new Map();

class KeyStore {
    getKeyStore(): KeyPairWithAccounts[] {
        return JSON.parse(window.localStorage.getItem("keyPairs") || "[]");
    }

    setKeyStore(keyStore: KeyPairWithAccounts[]): void {
        window.localStorage.setItem("keyPairs", JSON.stringify(keyStore));
    }

    getAccounts(): string[] {
        const keyStore = this.getKeyStore();

        const allAccounts = keyStore.flatMap(
            (keyPair) => keyPair.knownAccounts || []
        );
        const duplicateAccounts = allAccounts.filter(
            (item, index, arr) => arr.indexOf(item) !== index
        );
        if (duplicateAccounts.length > 0) {
            duplicateAccounts.forEach((account) => {
                const keys = keyStore
                    .filter(
                        (keyStore) =>
                            keyStore.knownAccounts &&
                            keyStore.knownAccounts.includes(account)
                    )
                    .map((keystore) => keystore.publicKey)
                    .join("Key: ");
                console.warn(
                    `Keystore has recorded multiple keys for account "${account}", possible chance existing logic will pick the wrong one to use for tx signing. ${keys}`
                );
            });
        }

        return allAccounts.filter(
            (item, index, arr) => arr.indexOf(item) === index
        );
    }

    addAccount(newAccounts: AccountWithKey[]): void {
        const keyPairs = this.getKeyStore();

        const newAccountsWithPrivateKeys = newAccounts.filter(
            (account) => "privateKey" in account
        );
        if (newAccountsWithPrivateKeys.length > 0) {
            const incomingAccounts: KeyPairWithAccounts[] = newAccounts.map(
                ({
                    privateKey,
                    accountNum,
                    publicKey,
                }): KeyPairWithAccounts => ({
                    privateKey,
                    knownAccounts: [accountNum],
                    publicKey,
                })
            );
            const accountNumsCovered = incomingAccounts.flatMap(
                (account) => account.knownAccounts || []
            );

            const easier = keyPairs.map((keyPair) => ({
                ...keyPair,
                knownAccounts: keyPair.knownAccounts || [],
            }));
            const keypairsWithoutStaleAccounts = easier.map((keyPair) => ({
                ...keyPair,
                knownAccounts: keyPair.knownAccounts.filter(
                    (account) => !accountNumsCovered.some((a) => a == account)
                ),
            }));
            const existingAccountsToRemain = keypairsWithoutStaleAccounts;

            console.log({ existingAccountsToRemain });

            const combined = [...existingAccountsToRemain, ...incomingAccounts];
            const pureUniqueKeyPairs = combined
                .map(
                    ({ privateKey, publicKey }): KeyPair => ({
                        privateKey,
                        publicKey,
                    })
                )
                .filter(
                    (keyPair, index, arr) =>
                        arr.findIndex(
                            (kp) => kp.publicKey === keyPair.publicKey
                        ) === index
                );

            const fresh = pureUniqueKeyPairs.map(
                (keyPair): KeyPairWithAccounts => {
                    return {
                        ...keyPair,
                        knownAccounts: combined.flatMap((kp) =>
                            kp.publicKey === keyPair.publicKey
                                ? kp.knownAccounts || []
                                : []
                        ),
                    };
                }
            );

            console.log("adding accounts", incomingAccounts);
            this.setKeyStore(fresh);
        }
    }
}

const keystore = new KeyStore();

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
            {
                id: "addAccount",
                exec: async ({
                    accountNum,
                    keyPair,
                }: {
                    accountNum: string;
                    keyPair: KeyPair;
                }) => {
                    keystore.addAccount([
                        {
                            accountNum,
                            authService: "auth-ec-sys",
                            privateKey: keyPair.privateKey,
                            publicKey: keyPair.publicKey,
                        },
                    ]);
                },
            },
            {
                id: "storeKey",
                exec: async (keyPair: KeyPair) => {
                    const keyStore = JSON.parse(
                        window.localStorage.getItem("keyPairs") || "[]"
                    );

                    const existingKey = keyStore.find(
                        (kp: KeyPair) => kp.publicKey === keyPair.publicKey
                    );

                    // Checks if the key is already in the store
                    if (existingKey) {
                        return;
                    } else {
                        keyStore.push(keyPair);
                        window.localStorage.setItem(
                            "keyPairs",
                            JSON.stringify(keyStore)
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
                id: "getAccounts",
                exec: () => {
                    return keystore.getAccounts();
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
                        method: string;
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
                    const keys = keystore.getKeyStore();

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
