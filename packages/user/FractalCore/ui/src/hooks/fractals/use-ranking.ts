import { useAsyncDebouncer } from "@tanstack/react-pacer";
import { useEffect, useRef, useState } from "react";

import { useGroupUsers } from "@/hooks/fractals/use-group-users";
import { useProposal } from "@/hooks/fractals/use-proposal";
import { usePropose } from "@/hooks/fractals/use-propose";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { arrayMove } from "@shared/lib/array-move";
import { Account } from "@shared/lib/schemas/account";

export const useRanking = (groupNumber: number) => {
    const guildAccount = useGuildAccount();

    const { data: groupUsersData } = useGroupUsers(guildAccount, groupNumber);

    const groupUsers = groupUsersData || [];

    const { data: currentProposal, isPending: isProposalPending } =
        useProposal(groupNumber);

    const [rankedAccounts, setRankedAccounts] = useState<Account[]>(
        () => currentProposal ?? [],
    );

    // initialize
    const initialized = useRef(false);
    useEffect(() => {
        if (!currentProposal || initialized.current) return;
        initialized.current = true;
        setRankedAccounts(currentProposal ?? []);
    }, [currentProposal]);
    // end initialize

    const { mutateAsync: propose } = usePropose();

    const {
        maybeExecute: debounceAccounts,
        cancel,
        state,
    } = useAsyncDebouncer(
        async (rankedNumbers: Account[]) => {
            await propose({
                groupNumber,
                proposal: rankedNumbers,
            });
        },
        {
            wait: 4000,
        },
        (state) => ({
            isPending: state.isPending,
            status: state.status,
        }),
    );

    const updateRankedNumbers = (accounts: Account[]) => {
        setRankedAccounts(accounts);
        if (
            currentProposal &&
            accounts.length === currentProposal.length &&
            accounts.every((acc, idx) => acc === currentProposal[idx])
        ) {
            // if the new proposal is the same as the already-submitted proposal, cancel the debounce
            cancel();
        } else {
            debounceAccounts(accounts);
        }
    };

    const remove = (account: Account) => {
        updateRankedNumbers(
            rankedAccounts.filter((a: Account) => a !== account),
        );
    };

    const add = (account: Account) => {
        updateRankedNumbers([...rankedAccounts, account]);
    };

    const unrankedAccounts = groupUsers
        .filter((user) => !rankedAccounts.some((p) => p === user))
        .sort();

    const onSortEnd = (oldIndex: number, newIndex: number) => {
        const next = arrayMove(rankedAccounts, oldIndex, newIndex);
        updateRankedNumbers(next);
    };

    return {
        allAccounts: groupUsers,
        rankedAccounts,
        unrankedAccounts,
        onSortEnd,
        add,
        remove,
        isLoading: isProposalPending,
        isSaving: state.isPending,
        isSaved: state.status === "settled",
    };
};
