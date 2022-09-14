import { AppletId, getJson, operation } from "common/rpc.mjs"
import { useState } from "react"
import { AccountWithAuth } from "../App"
import { AccountPair } from "../components/CreateAccountForm"
import { useData } from "./useData"

export const useCreateAccount = (onAccountCreated: (createdAccount: AccountWithAuth, privateKey: string) => void): [(account: AccountPair) => void, boolean, string] => {
    const { error, setError, isLoading, setIsLoading } = useData();


    const createAccount = async (account: AccountPair) => {

        try {
            setIsLoading(true)
            setError('')
            const thisApplet = await getJson<string>("/common/thisservice");
            const appletId = new AppletId(thisApplet)

            const newAccount: AccountWithAuth = {
                accountNum: account.account,
                authService: account.publicKey ? 'auth-ec-sys' : 'auth-any-sys',
                publicKey: account.publicKey
            }

            operation(appletId, 'newAcc', { name: newAccount.accountNum, ...(account.publicKey && { pubKey: account.publicKey }) });


            onAccountCreated(newAccount, account.privateKey)

        } catch (e: any) {
            setError(e.message)
            console.error(e, 'q');
        } finally {
            setIsLoading(false);
        }

    }

    return [createAccount, isLoading, error]

}