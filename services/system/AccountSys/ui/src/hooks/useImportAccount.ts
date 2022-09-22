import { AccountWithKey, KeyPairWithAccounts } from "../App";
import { fetchAccountsByKey } from "../helpers";
import { useData } from "./useData";

export const useImportAccount = (onImportAccounts: (accounts: AccountWithKey[]) => void): [(keyPair: KeyPairWithAccounts) => void, boolean, string] => {
    const { isLoading, setIsLoading: setImportLoading, setError: setImportError, error } = useData()

    const addKeyPair = async (keyPair: { privateKey: string; publicKey: string }) => {
        try {
            setImportLoading(true);
            setImportError('');

            const res = await fetchAccountsByKey(keyPair.publicKey);
            if (res.length == 0) throw new Error(`No accounts found with public key ${keyPair.publicKey}`);

            if (res.length > 0) {
                const accounts = res.map((res): AccountWithKey => ({ accountNum: res.account, authService: 'auth-ec-sys', publicKey: res.pubkey, privateKey: keyPair.privateKey }));
                onImportAccounts(accounts)
            }
        } catch (e) {
            setImportError(`${e}`)
        } finally {
            setImportLoading(false)
        }
    }

    return [addKeyPair, isLoading, error]

}