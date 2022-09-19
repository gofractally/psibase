import { useEffect, useState } from "react";
import { AccountWithAuth } from "../App";
import { fetchAccounts } from "../helpers";

export const useAccounts = (): [AccountWithAuth[], () => void] => {
    const [accounts, setAccounts] = useState<AccountWithAuth[]>([]);

    const refreshAccounts = async () => {
        const res = await fetchAccounts()
        setAccounts(res);
    }

    useEffect(() => { refreshAccounts() }, []);

    return [accounts, refreshAccounts];
};
