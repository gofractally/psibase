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

export interface KeyPair {
    privateKey: string;
    publicKey: string;
}

export interface Account {
    accountNum: string;
    authContract: string;
    publicKey: KeyPair['publicKey']
}

const useAccountsWithKeys = (): [Account[], (key: string) => void, (account: Account, privateKey: string) => void] => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [keyPairs, setKeyPairs] = useLocalStorage<KeyPair[]>('keyPairs', [])

    const sortedAccounts = accounts.slice().sort((a, b) => a.accountNum < b.accountNum ? -1 : 1)

    useEffect(() => {
        fetchAccounts().then(accounts => setAccounts(currentAccounts => {
            const userAccounts = accounts.filter(account => !account.accountNum.includes('-sys'));

            return [...currentAccounts, ...userAccounts].filter((account, index, arr) => arr.findIndex(a => a.accountNum === account.accountNum) == index)
        }))

    }, [])

    const dropAccount = (accountNum: string) => {
        const foundAccount = accounts.find(a => accountNum == a.accountNum);
        if (foundAccount) {
            const key = foundAccount.publicKey;
            setAccounts(accounts => accounts.filter(account => account.publicKey !== key))
        } else {
            console.warn(`Failed to find account ${accountNum} to drop`)
        }
    };


    const addAccount = (account: Account, privateKey: string) => {
        setAccounts(accounts => {
            const withoutExisting = accounts.filter(a => a.accountNum !== account.accountNum);
            return [...withoutExisting, account]
        });
        setKeyPairs([...keyPairs.filter(pair => pair.publicKey !== account.publicKey), { privateKey, publicKey: account.publicKey }])
    };
    return [sortedAccounts, dropAccount, addAccount];
};


const fetchAccounts = async () => {
    try {
        const accounts = await getJson<Account[]>("/accounts");

        console.log(accounts, 'are the accounts')
        return accounts;
    } catch (e) {
        console.info("refreshAccounts().catch().e:");
        console.info(e);
        return []
    }
}

const useAccounts = (): [Account[], () => void] => {
    const [accounts, setAccounts] = useState<Account[]>([]);

    const refreshAccounts = async () => {
        const res = await fetchAccounts()
        setAccounts(res);
    }

    useEffect(() => { refreshAccounts() }, []);

    return [accounts, refreshAccounts];
};

function App() {
    const [appInitialized, setAppInitialized] = useState(false);
    const [accountsWithKeys, dropAccount, addAccount] = useAccountsWithKeys();


    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");

    const [name, setName] = useState("");
    const [pubKey, setPubKey] = useState("");
    const [privKey, setPrivKey] = useState("");

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
            const thisApplet = await getJson<string>("/common/thiscontract");
            const appletId = new AppletId(thisApplet)

            const newAccount: Account = {
                accountNum: account.account,
                authContract: account.publicKey ? 'auth-ec-sys' : 'auth-any-sys',
                publicKey: account.publicKey
            }

            operation(appletId, 'newAcc', { name: newAccount.accountNum, ...(account.publicKey && { pubKey: account.publicKey }) });

            refreshAccounts()
            addAccount(newAccount, account.privateKey);
            setPrivKey('');
            setPubKey('')
            setName('')
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
                <CreateAccountForm name={name} privKey={privKey} pubKey={pubKey} setPrivKey={setPrivKey} setPubKey={setPubKey} setName={setName} errorMessage={errorMessage} isLoading={isLoading} onCreateAccount={onCreateAccount} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
