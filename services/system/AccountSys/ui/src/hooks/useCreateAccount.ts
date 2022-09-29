import { AccountWithAuth } from "../App";
import { AccountPair } from "../components/CreateAccountForm";
import { createAccount } from "../operations";
import { useData } from "./useData";

export const useCreateAccount = (
    onAccountCreated: (
        createdAccount: AccountWithAuth,
        privateKey: string
    ) => void
): [(account: AccountPair) => void, boolean, string] => {
    const { error, setError, isLoading, setIsLoading } = useData();

    const accountCreator = async (account: AccountPair) => {
        try {
            setIsLoading(true);
            setError("");
            const newAccount = await createAccount(account);
            onAccountCreated(newAccount, account.privateKey);
        } catch (e: any) {
            setError(e.message);
            console.error(e, "q");
        } finally {
            setIsLoading(false);
        }
    };

    return [accountCreator, isLoading, error];
};
