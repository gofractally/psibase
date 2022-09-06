import React, { useEffect, useState } from "react";

import { getJson } from "common/rpc.mjs";
import { useLocalStorage } from "common/useLocalStorage.mjs";

import appAccountIcon from "./components/assets/icons/app-account.svg";

import { AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { getLoggedInUser, useMsg } from "./helpers";
import { initAppFn } from "./appInit";

import closedIcon from "./components/assets/icons/lock-closed.svg";
import openIcon from "./components/assets/icons/lock-open.svg";


// needed for common files that won't necessarily use bundles
window.React = React;

const useAccountsWithKeys = (addMsg: any, clearMsg: any) => {
    const [accounts, setAccounts] = useState([
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

interface Account {
    accountNum: string;
    authContract: string;
}

export interface ViewAccount extends Account {
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

    const allViewAccounts = allAccounts.map(toViewAccount)
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
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

    const onSelectAccount = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.id) {
            setCurrentUser(e.target.id);
        }
    };

    console.log({ allAccounts, accountsWithKeys })
    return (
        <div className="ui container p-4">
            <div className="flex gap-2">
                <img src={appAccountIcon} />
                <Heading tag="h1" className="text-gray-600">
                    Accounts
                </Heading>
            </div>
            <div className="bg-slate-50">
                <h2 className="pt-6">Available accounts</h2>
                <div>Choose and account below to make it active.</div>
                <div className="flex w-full flex-nowrap place-content-between">
                    <div className="w-20 text-center">Active</div>
                    <div className="w-32">Accounts</div>
                    <div className="grow">Pubkey</div>
                    <div className="w-20">Action</div>
                </div>
                <AccountList
                    accounts={accountsWithKeys}
                    onSelectAccount={onSelectAccount}
                    addMsg={addMsg}
                    clearMsg={clearMsg}
                />
            </div>
            <div className="bg-slate-50 mt-4">
                <CreateAccountForm addMsg={addMsg} clearMsg={clearMsg} />
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
