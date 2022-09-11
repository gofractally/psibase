import {
    initializeApplet,
    action,
    operation,
    query,
    setOperations,
    setQueries,
    signTransaction,
    getJson,
    AppletId,
    SignedTransaction,
} from "common/rpc.mjs";
import { KeyPair } from "./App";

interface execArgs {
    name?: any;
    pubKey?: any;
    transaction?: any;
}

export const initAppFn = (setAppInitialized: () => void) =>
    initializeApplet(async () => {

        const thisApplet = await getJson<string>("/common/thiscontract");
        const accountSysApplet = new AppletId(thisApplet, "");

        setOperations([
            {
                id: "newAcc",
                exec: async ({ name, pubKey }: execArgs) => {
                    action(thisApplet, "newAccount", {
                        name,
                        authContract: "auth-any-sys",
                        requireNew: true,
                    });

                    if (pubKey && pubKey !== "") {
                        operation(accountSysApplet, "setKey", { name, pubKey });
                    }
                },
            },
            {
                id: "setKey",
                exec: async ({ name, pubKey }: execArgs) => {
                    if (pubKey !== "") {
                        action("auth-ec-sys", "setKey", { key: pubKey }, name);
                        action(
                            thisApplet,
                            "setAuthCntr",
                            { authContract: "auth-ec-sys" },
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
                exec: async ({ transaction }: execArgs): Promise<SignedTransaction> => {
                    const [user, accounts] = await Promise.all([query<null, string>(accountSysApplet, "getLoggedInUser"), getJson<{ accountNum: string; authContract: string }[]>("/accounts")]);

                    const sendingAccount = accounts.find(account => account.accountNum === user);
                    if (!sendingAccount) {
                        console.error('No sending account', sendingAccount, { loggedInUser: user, sending: transaction.actions[0].sender })
                        throw new Error('No sending account found');
                    }
                    const isSecureAccount = sendingAccount.authContract === "auth-ec-sys"
                    if (isSecureAccount) {
                        const keys = JSON.parse(localStorage.getItem('keyPairs') || '[]') as KeyPair[]

                        const foundKey = keys.find(key => {
                            if (key.knownAccounts) {
                                return key.knownAccounts.includes(user)
                            }
                        });

                        if (foundKey) {
                            const signingPrivateKey = foundKey.privateKey;
                            return signTransaction("", transaction, [signingPrivateKey]);
                        } else {
                            console.error(`Failed to find the key pair for sender ${user}`);
                            throw new Error(`Failed to find the key pair for sender ${user}`);
                        }

                    } else {
                        return signTransaction("", transaction);
                    }
                },
            },
        ]);
        setAppInitialized();
    });
