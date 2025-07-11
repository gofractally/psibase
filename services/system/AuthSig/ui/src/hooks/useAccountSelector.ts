import { useEffect, useRef, useState } from "react";

export const useAccountSelector = (
    accounts: string[],
    onOtherSelected: () => void,
) => {
    const hasSetAccounts = useRef(false);

    const [selectedAccount, setTheAccount] = useState<string>();

    const setSelectedAccount = (account: string) => {
        if (account == "other") {
            onOtherSelected();
        } else {
            setTheAccount(account);
        }
    };

    useEffect(() => {
        if (!hasSetAccounts.current && accounts.length > 0) {
            hasSetAccounts.current = true;
            setTheAccount(accounts[0]);
        }
    }, [hasSetAccounts, accounts]);

    return {
        selectedAccount,
        setSelectedAccount,
    };
};
