import { rootAccount, type AccountNumber } from "@shared/lib/schemas/account";

export type RootFreezeGap = {
    root: AccountNumber;
    subaccounts: AccountNumber[];
};

export const rootFreezeGaps = (selected: Iterable<string>): RootFreezeGap[] => {
    const selectedSet = new Set(selected);
    const byRoot = new Map<string, string[]>();
    for (const account of selectedSet) {
        const root = rootAccount(account);
        if (root == null) continue;
        if (selectedSet.has(root)) continue;
        const subs = byRoot.get(root);
        if (subs) subs.push(account);
        else byRoot.set(root, [account]);
    }
    return [...byRoot.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([root, subaccounts]) => ({
            root,
            subaccounts: [...subaccounts].sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true }),
            ),
        }));
};
