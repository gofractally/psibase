import React, { useEffect, useRef, useState } from "react";

import appAccountIcon from "./components/assets/icons/app-account.svg";
import { AccountsList, AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { fetchAccounts, getLoggedInUser } from "./helpers";
import { initAppFn } from "./appInit";
import { ImportAccountForm } from "./components/ImportAccountForm";
import { useAccountsWithKeys } from "./hooks/useAccountsWithKeys";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useImportAccount } from "./hooks/useImportAccount";
import { useCreateAccount } from "./hooks/useCreateAccount";



// needed for common files that won't necessarily use bundles
window.React = React;

export interface KeyPair {
    privateKey: string;
    publicKey: string;
    knownAccounts?: string[];
}

interface Account {
    accountNum: string;
    publicKey: KeyPair['publicKey']
}
export interface AccountWithAuth extends Account {
    authService: string;
}
export interface AccountWithKey extends AccountWithAuth {
    privateKey: KeyPair['privateKey']
}


const useAccounts = (): [AccountWithAuth[], () => void] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);

    const refreshAccounts = async () => {
        const res = await fetchAccounts()
        setAccounts(res);
    }

    useEffect(() => { refreshAccounts() }, []);

    return [accounts, refreshAccounts];
};



function App() {
    const [appInitialized, setAppInitialized] = useState(false);
    const [accountsWithKeys, dropAccount, addAccounts] = useAccountsWithKeys();


    const [allAccounts, refreshAccounts] = useAccounts();
    const [currentUser, setCurrentUser] = useCurrentUser();

    const onLogout = (account: string) => {
        const isLoggingOutOfCurrentUser = currentUser === account;
        if (isLoggingOutOfCurrentUser) {
            setCurrentUser(accountsWithKeys[0].accountNum);
        }
        dropAccount(account)
    }


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



    const createAccountFormRef = useRef<{ resetForm: () => void }>(null);

    const [onCreateAccount, isAccountLoading, accountError] = useCreateAccount((newAccount, privateKey) => {
        createAccountFormRef.current!.resetForm()
        addAccounts([{ ...newAccount, privateKey }]);
        refreshAccounts();
    })
    const [searchKeyPair, isImportLoading, importError] = useImportAccount(addAccounts);


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
                    onLogout={onLogout}
                    selectedAccount={currentUser}
                    accounts={accountsWithKeys}
                    onSelectAccount={setCurrentUser}
                />
            </div>
            <div className="bg-slate-50 mt-4 flex justify-between">
                <CreateAccountForm errorMessage={accountError} isLoading={isAccountLoading} onCreateAccount={onCreateAccount} ref={createAccountFormRef} />
                <ImportAccountForm errorMessage={importError} isLoading={isImportLoading} onImport={searchKeyPair} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
