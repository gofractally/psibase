import {
    action,
    operation,
    setOperations,
    setQueries,
    getJson,
    AppletId,
    uint8ArrayToHex,
    WrappedClaim,
    MessageMetadata,
    publicStringToDER,
    privateStringToKeyPair,
    signatureToBin,
    signatureToFracpack,
} from "@psibase/common-lib";
import { AccountWithKey, KeyPair, KeyPairWithAccounts } from "./App";
import { fetchAccounts } from "./helpers";

interface execArgs {
    name?: any;
    pubKey?: any;
    transaction?: any;
}

const CURRENT_USER = "currentUser";

interface GetProofParams {
    claim: WrappedClaim;
    trxDigest: number[];
}

function comparePublicKeys(lhs: string, rhs: string): boolean {
    try {
        const lhsDER = publicStringToDER(lhs);
        const rhsDER = publicStringToDER(rhs);
        console.log("compare ", lhsDER, " to ", rhsDER);
        if (lhsDER.length !== rhsDER.length) {
            return false;
        }
        for (let i = 0; i < lhsDER.length; i++) {
            if (lhsDER[i] !== rhsDER[i]) {
                return false;
            }
        }
        return true;
    } catch (e) {
        console.warn(e);
        return false;
    }
}

function serializeSignature(claim: WrappedClaim, sig: any): Uint8Array {
    if (claim.claim.service === "verifyec-sys") {
        return signatureToFracpack(sig);
    } else if (claim.claim.service === "verify-sys") {
        return signatureToBin(sig);
    } else {
        console.error(`Don't know how to sign for ${claim.claim.service}`);
        throw new Error("Wrong service");
    }
}

class KeyStore {
    getKeyStore(): KeyPairWithAccounts[] {
        return JSON.parse(window.localStorage.getItem("keyPairs") || "[]");
    }

    findKeyPairForPublicKey(
        publicKey: string
    ): KeyPairWithAccounts | undefined {
        const keyStore = this.getKeyStore();
        return (
            keyStore.find((keyPair) =>
                comparePublicKeys(keyPair.publicKey, publicKey)
            ) || undefined
        );
    }

    getProof({ claim, trxDigest }: GetProofParams) {
        const keyPair = this.findKeyPairForPublicKey(claim.pubkey);
        if (!keyPair) {
            return undefined;
        }

        const k = privateStringToKeyPair(keyPair.privateKey);
        const packedSignature = serializeSignature(claim, {
            keyType: k.keyType,
            signature: k.keyPair.sign(trxDigest),
        });

        return uint8ArrayToHex(packedSignature);
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
                (keyPair): KeyPairWithAccounts => ({
                    ...keyPair,
                    knownAccounts: combined.flatMap((kp) =>
                        kp.publicKey === keyPair.publicKey
                            ? kp.knownAccounts || []
                            : []
                    ),
                })
            );

            this.setKeyStore(fresh);
        }
    }
}

const keystore = new KeyStore();

export const initAppFn = (setAppInitialized: () => void) => {
    setAppInitialized();
};

/*

TODO: All of these operations and queries should be made into functions in the accountsys plugin

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
                            "auth-sys",
                            "setKey",
                            { key: pubKey },
                            name
                        );
                        await action(
                            thisApplet,
                            "setAuthServ",
                            { authService: "auth-sys" },
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
                            authService: "auth-sys",
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
                        window.localStorage.getItem(CURRENT_USER) || ""
                    );
                },
            },
            {
                id: "getKeyStoreAccounts",
                exec: () => {
                    return keystore.getAccounts();
                },
            },
            {
                id: "getProof",
                exec: async (
                    params: GetProofParams,
                    metadata: MessageMetadata
                ): Promise<any> => {
                    if (metadata.sender !== "common-sys") {
                        console.error(
                            "Security error: only common-sys can get proofs"
                        );
                        return { proof: undefined };
                    }

                    const proof = keystore.getProof(params);
                    return { proof };
                },
            },
            {
                id: "getAccounts",
                exec: () => {
                    return fetchAccounts();
                },
            },
        ]);

*/
