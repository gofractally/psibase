import React, { useEffect, useState } from "react";

import { getJson } from "common/rpc.mjs";
import { useLocalStorage } from "common/useLocalStorage.mjs";

import appAccountIcon from "./components/assets/icons/app-account.svg";

import { CreateAccountForm, Heading, SetAuth, AccountsList } from "./components";
import { getLoggedInUser, useMsg } from "./helpers";
import { initAppFn } from "./appInit";

import closedIcon from "./components/assets/icons/lock-closed.svg";
import openIcon from "./components/assets/icons/lock-open.svg";


// needed for common files that won't necessarily use bundles
window.React = React;

export interface Account {
    accountNum: string;
    authContract: string;
}

const useAccountsWithKeys = (addMsg: any, clearMsg: any) => {
    const [accounts, setAccounts] = useState<Account[]>([
        {
            accountNum: "alice",
            authContract: "auth-any-sys",
        },
        {
            accountNum: "bob",
            authContract: "auth-any-sys",
        },
        {
            accountNum: "carol",
            authContract: "auth-any-sys",
        },
    ]);
    return accounts;
};



interface ViewAccount extends Account {
    isSecure: boolean;
}

const toViewAccount = (account: Account): ViewAccount => ({ ...account, isSecure: account.authContract !== 'auth-any-sys' })

const useAccounts = (addMsg: any, clearMsg: any) => {
    const [accounts, setAccounts] = useState<Account[]>([]);

    const refreshAccounts = () => {
        addMsg("Fetching accounts...");
        (async () => {
            try {
                const accounts = await getJson<Account[]>("/accounts");
                setAccounts(accounts);
            } catch (e) {
                console.info("refreshAccounts().catch().e:");
                console.info(e);
                clearMsg();
                addMsg(e);
            }
        })();
    };

    useEffect(refreshAccounts, []);

    return accounts;
};

function App() {
    const [appInitialized, setAppInitialized] = useState(false);
    const { msg, addMsg, clearMsg } = useMsg();
    const accountsWithKeys = useAccountsWithKeys(addMsg, clearMsg);
    const allAccounts = useAccounts(addMsg, clearMsg);

    const allViewAccounts = allAccounts.map(toViewAccount);

    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    const [keyPairs, setKeyPairs] = useLocalStorage<{ privateKey: string, publicKey: string }[]>("keyPairs", []);

    useEffect(() => {
        initAppFn(() => {
            setAppInitialized(true);
        });
    }, []);
    useEffect(() => {
        if (!appInitialized) {
            return;
        }
        (async () => {
            // initializeApplet();
            try {
                setCurrentUser(await getLoggedInUser());
            } catch (e: any) {
                console.info(
                    "App.appInitialized.useEffect().error:",
                    e.message
                );
            }
        })();
    }, [appInitialized]);

    const onSelectAccount = (account: string) => {

        const isSelectedAccount = account === currentUser;
        if (isSelectedAccount) {
            console.log('perform logout')
        } else {
            setCurrentUser(account)
        }
    };


    const onAccountCreation = ({ publicKey, privateKey }: { account: string, publicKey: string, privateKey: string }) => {
        const withoutExisting = keyPairs.filter(pair => pair.privateKey !== privateKey && pair.publicKey !== publicKey);
        setKeyPairs([...withoutExisting, { privateKey, publicKey }]);
    }


    console.log({ allAccounts, accountsWithKeys })
    return (
        <div className="ui container p-4">
            <div className="flex gap-2">
                <img src={appAccountIcon} />
                <Heading tag="h1" className="text-gray-600">
                    Accounts
                </Heading>
            </div>
            <AccountsList accounts={accountsWithKeys} selectedAccount={currentUser} onSelectAccount={onSelectAccount} />
            <div className="bg-slate-50 mt-4">
                <CreateAccountForm isLoading={false} onAccountCreation={onAccountCreation} addMsg={addMsg} clearMsg={clearMsg} />
            </div>
            <hr />

            <h2>All accounts</h2>
            <div className="flex flex-col space-y-2">

                {allViewAccounts.map(account => (
                    <div className="flex justify-between">
                        <div>{account.accountNum}</div>
                        <div className="w-5">                        <img src={account.isSecure ? closedIcon : openIcon} alt="" />
                        </div>
                    </div>
                ))}

            </div>
            <hr />

            <SetAuth />

            <hr />
            <h2>Messages</h2>
            <pre style={{ border: "1px solid" }}>
                <code>{msg}</code>
            </pre>
        </div>
    );
}

export default App;
