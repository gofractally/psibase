import React, { useEffect, useState } from "react";

import { AppletId, getJson, operation, siblingUrl } from "common/rpc.mjs";
import { useLocalStorage } from "common/useLocalStorage.mjs";

import appAccountIcon from "./components/assets/icons/app-account.svg";

import { AccountsList, AccountList, CreateAccountForm, Heading, SetAuth } from "./components";
import { fetchAccounts, getLoggedInUser } from "./helpers";
import { initAppFn } from "./appInit";
import { AccountPair } from "./components/CreateAccountForm";
import { ImportAccountForm } from "./components/ImportAccountForm";
import { useAccountsWithKeys } from "./hooks/useAccountsWithKeys";



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


const useData = (loadingState: boolean = false) => {
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(loadingState);
    return { isLoading, error, setError, setIsLoading }
}

const useCurrentUser = (): [string, (newUser: string) => void] => {
    const [currentUser, setCurrentUser] = useLocalStorage("currentUser", "");
    return [currentUser, setCurrentUser]
}

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

    const [name, setName] = useState("");
    const [pubKey, setPubKey] = useState("");
    const [privKey, setPrivKey] = useState("");

    const { error: accountError, setError: setAccountError, isLoading: isAccountLoading, setIsLoading: setIsAccountLoading } = useData()


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
            setIsAccountLoading(true)
            setAccountError('')
            const thisApplet = await getJson<string>("/common/thisservice");
            const appletId = new AppletId(thisApplet)

            const newAccount: AccountWithAuth = {
                accountNum: account.account,
                authService: account.publicKey ? 'auth-ec-sys' : 'auth-any-sys',
                publicKey: account.publicKey
            }

            operation(appletId, 'newAcc', { name: newAccount.accountNum, ...(account.publicKey && { pubKey: account.publicKey }) });

            refreshAccounts();
            addAccounts([{ ...newAccount, privateKey: account.privateKey }]);
            setPrivKey('');
            setPubKey('')
            setName('')
        } catch (e: any) {
            setAccountError(e.message)
            console.error(e, 'q');
        } finally {
            setIsAccountLoading(false);
        }
    };


    const { isLoading: isImportLoading, setIsLoading: setImportLoading, setError: setImportError, error: importError } = useData()


    const onImport = async (acc: { privateKey: string; publicKey: string }) => {
        try {
            setImportLoading(true);
            setImportError('');

            const res = await fetchAccountsByKey(acc.publicKey);
            if (res.length == 0) throw new Error(`No accounts found with public key ${acc.publicKey}`);

            if (res.length > 0) {
                const accounts = res.map((res): AccountWithKey => ({ accountNum: res.account, authService: 'auth-ec-sys', publicKey: res.pubkey, privateKey: acc.privateKey }));
                addAccounts(accounts);
                const newAccountsFound = res.filter(account => !accountsWithKeys.some(a => a.accountNum == account.account && account.pubkey == a.publicKey));
                if (newAccountsFound.length == 0) throw new Error("No new accounts found")
            }
        } catch (e) {
            setImportError(`${e}`)
        } finally {
            setImportLoading(false)
        }
    }
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
                <CreateAccountForm name={name} privKey={privKey} pubKey={pubKey} setPrivKey={setPrivKey} setPubKey={setPubKey} setName={setName} errorMessage={accountError} isLoading={isAccountLoading} onCreateAccount={onCreateAccount} />
                <ImportAccountForm errorMessage={importError} isLoading={isImportLoading} onImport={onImport} />
            </div>
            {/* <SetAuth /> */}
            <AccountsList
                accounts={allAccounts}
            />


        </div>
    );
}

export default App;
