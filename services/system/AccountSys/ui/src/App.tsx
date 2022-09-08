import React, { useEffect, useState } from "react";

import { AppletId, getJson, operation } from "common/rpc.mjs";
import { useLocalStorage } from "common/useLocalStorage.mjs";

import appAccountIcon from "./components/assets/icons/app-account.svg";

import { AccountsList, AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { getLoggedInUser, useMsg } from "./helpers";
import { initAppFn } from "./appInit";
import { AccountPair } from "./components/CreateAccountForm";



// needed for common files that won't necessarily use bundles
window.React = React;

interface KeyPair {
    privateKey: string;
    publicKey: string;
}

export interface Account {
    accountNum: string;
    authContract: string;
    publicKey: KeyPair['publicKey']
}

const useAccountsWithKeys = (): [Account[], (key: string) => void] => {
    const [accounts, setAccounts] = useState<Account[]>([
        {
            accountNum: "alice",
            authContract: "auth-any-sys",
            publicKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2)
        },
        {
            accountNum: "bob",
            authContract: "auth-any-sys",
            publicKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2)
        },
        {
            accountNum: "carol",
            authContract: "auth-any-sys",
            publicKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2)
        },
    ]);
    const dropAccount = (accountNum: string) => {
        const foundAccount = accounts.find(a => accountNum == a.accountNum);
        if (foundAccount) {
            const key = foundAccount.publicKey;
            setAccounts(accounts => accounts.filter(account => account.publicKey !== key))
        } else {
            console.warn(`Failed to find account ${accountNum} to drop`)
        }
    }
    return [accounts, dropAccount];
};


const useAccounts = (): [Account[], () => void] => {
    const [accounts, setAccounts] = useState<Account[]>([]);

    const refreshAccounts = () => {
        console.info("Fetching accounts...");
        (async () => {
            try {
                const accounts = await getJson<Account[]>("/accounts");
                console.log(accounts, 'are the accounts')
                setAccounts(accounts);
            } catch (e) {
                console.info("refreshAccounts().catch().e:");
                console.info(e);
            }
        })();
    };

    useEffect(refreshAccounts, []);

    return [accounts, refreshAccounts];
};

function App() {
    const [appInitialized, setAppInitialized] = useState(false);
    const [accountsWithKeys, dropAccount] = useAccountsWithKeys();
    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");

    console.log({ currentUser })
    const [keyPairs, setKeyPairs] = useLocalStorage<KeyPair[]>('keyPairs', [])
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');


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

    const onCreateAccount = async (account: AccountPair) => {

        try {
            setIsLoading(true)
            setErrorMessage('')
            const thisApplet = await getJson("/common/thiscontract");
            await operation(new AppletId(thisApplet, ""), "newAcc", {
                name: account,
                pubKey: account.publicKey,
            });
        } catch (e: any) {
            setErrorMessage(e.message)
            console.error(e, 'q');
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="ui container p-4">
            <div className="flex gap-2">
                <img src={appAccountIcon} />
                <Heading tag="h1" className="text-gray-600">
                    Accounts
                </Heading>
            </div>
            <div className="bg-slate-50">
                <AccountList
                    onLogout={dropAccount}
                    selectedAccount={currentUser}
                    accounts={accountsWithKeys}
                    onSelectAccount={setCurrentUser}
                />
            </div>
            <div className="bg-slate-50 mt-4">
                <CreateAccountForm errorMessage={errorMessage} isLoading={isLoading} onCreateAccount={onCreateAccount} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
