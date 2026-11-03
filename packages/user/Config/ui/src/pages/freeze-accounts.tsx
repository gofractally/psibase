import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { useAccountsByPrefix } from "@/hooks/use-accounts-by-prefix";
import {
    useFreezeAccounts,
    useUnfreezeAccounts,
} from "@/hooks/use-freeze-accounts";
import { useFrozenAccounts } from "@/hooks/use-frozen-accounts";

import { PageContainer } from "@shared/components/page-container";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Spinner } from "@shared/shadcn/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";
import { Textarea } from "@shared/shadcn/ui/textarea";

type AccountRow = {
    account: string;
    detail: string;
};

const memoOrUndefined = (memo: string): string | undefined => {
    const trimmed = memo.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const AccountList = ({
    rows,
    selected,
    onToggle,
    onToggleAll,
    empty,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
}: {
    rows: AccountRow[];
    selected: Set<string>;
    onToggle: (account: string, on: boolean) => void;
    onToggleAll: (on: boolean) => void;
    empty: string;
    isLoading: boolean;
    error: Error | null;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
}) => {
    const shownSelected = rows.filter((row) => selected.has(row.account)).length;
    const allShown = rows.length > 0 && shownSelected === rows.length;

    if (isLoading) {
        return (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
                <Spinner />
                Loading accounts...
            </div>
        );
    }

    if (error) {
        return (
            <p className="text-destructive px-3 py-6 text-sm">{error.message}</p>
        );
    }

    if (rows.length === 0) {
        return <p className="text-muted-foreground px-3 py-6 text-sm">{empty}</p>;
    }

    return (
        <div>
            <label className="flex items-center gap-3 border-b px-3 py-2 text-sm">
                <Checkbox
                    checked={
                        allShown ? true : shownSelected > 0 ? "indeterminate" : false
                    }
                    onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
                <span className="text-muted-foreground">
                    {selected.size === 0
                        ? "Select accounts"
                        : `${selected.size} selected`}
                </span>
            </label>
            <ul>
                {rows.map((row) => (
                    <li key={row.account} className="border-b last:border-b-0">
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                            <Checkbox
                                checked={selected.has(row.account)}
                                onCheckedChange={(checked) =>
                                    onToggle(row.account, checked === true)
                                }
                            />
                            <span className="font-medium">{row.account}</span>
                            <span className="text-muted-foreground text-sm">
                                {row.detail}
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            {hasNextPage ? (
                <div className="px-3 py-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isFetchingNextPage}
                        onClick={onLoadMore}
                    >
                        {isFetchingNextPage ? "Loading..." : "Load more"}
                    </Button>
                </div>
            ) : null}
        </div>
    );
};

const ProposeFields = ({
    memoId,
    memo,
    onMemo,
    selectedCount,
    pending,
    submitLabel,
    pendingLabel,
}: {
    memoId: string;
    memo: string;
    onMemo: (memo: string) => void;
    selectedCount: number;
    pending: boolean;
    submitLabel: string;
    pendingLabel: string;
}) => (
    <div className="space-y-3">
        <div className="space-y-1.5">
            <Label htmlFor={memoId}>Memo</Label>
            <Textarea
                id={memoId}
                value={memo}
                onChange={(event) => onMemo(event.target.value)}
                placeholder="Optional. Recorded on each account in this proposal."
            />
        </div>
        <div className="flex justify-end">
            <Button type="submit" disabled={selectedCount === 0 || pending}>
                {pending ? (
                    <>
                        <Spinner data-icon="inline-start" />
                        {pendingLabel}
                    </>
                ) : (
                    submitLabel
                )}
            </Button>
        </div>
    </div>
);

export const FreezeAccounts = () => {
    const [search, setSearch] = useState("");
    const [freezeMemo, setFreezeMemo] = useState("");
    const [unfreezeMemo, setUnfreezeMemo] = useState("");
    const [freezeSelected, setFreezeSelected] = useState<Set<string>>(
        () => new Set(),
    );
    const [unfreezeSelected, setUnfreezeSelected] = useState<Set<string>>(
        () => new Set(),
    );

    const accountsQuery = useAccountsByPrefix(search);
    const frozenQuery = useFrozenAccounts();
    const { mutateAsync: proposeFreeze, isPending: isFreezing } =
        useFreezeAccounts();
    const { mutateAsync: proposeUnfreeze, isPending: isUnfreezing } =
        useUnfreezeAccounts();

    const freezeRows = useMemo<AccountRow[]>(
        () =>
            accountsQuery.accounts.map((account) => ({
                account: account.account,
                detail: `auth ${account.authService}`,
            })),
        [accountsQuery.accounts],
    );
    const unfreezeRows = useMemo<AccountRow[]>(
        () =>
            frozenQuery.accounts.map((account) => ({
                account: account.account,
                detail: `restores ${account.authService}`,
            })),
        [frozenQuery.accounts],
    );

    const toggle = (
        selected: Set<string>,
        setSelected: (next: Set<string>) => void,
        account: string,
        on: boolean,
    ) => {
        const next = new Set(selected);
        if (on) next.add(account);
        else next.delete(account);
        setSelected(next);
    };

    const toggleAll = (
        rows: AccountRow[],
        selected: Set<string>,
        setSelected: (next: Set<string>) => void,
        on: boolean,
    ) => {
        const next = new Set(selected);
        for (const row of rows) {
            if (on) next.add(row.account);
            else next.delete(row.account);
        }
        setSelected(next);
    };

    const freezeEmpty = !accountsQuery.isValid
        ? "Use lowercase letters, digits, and hyphens."
        : search.trim().length === 0
          ? "Search for an account name."
          : "No accounts match that prefix.";

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Freeze accounts</h2>
                <p className="text-muted-foreground text-sm">
                    Propose freezing or unfreezing accounts. Changes wait for
                    staged-transaction acceptance unless they execute immediately.
                </p>
            </div>

            <Tabs defaultValue="freeze">
                <TabsList>
                    <TabsTrigger value="freeze">Freeze</TabsTrigger>
                    <TabsTrigger value="unfreeze">Unfreeze</TabsTrigger>
                </TabsList>

                <TabsContent value="freeze" className="space-y-4">
                    <Alert variant="warning">
                        <TriangleAlert />
                        <AlertTitle variant="warning">
                            Freezing can break the network
                        </AlertTitle>
                        <AlertDescription variant="warning">
                            Freezing sets the account's auth service to
                            auth-none, so it can no longer authorize
                            transactions. Freezing a system account such as
                            accounts, root, or producers can make it impossible
                            to unfreeze.
                        </AlertDescription>
                    </Alert>

                    <form
                        className="space-y-4 rounded-lg border p-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (freezeSelected.size === 0) return;
                            void proposeFreeze([
                                [...freezeSelected],
                                memoOrUndefined(freezeMemo),
                            ])
                                .then(() => {
                                    setFreezeSelected(new Set());
                                    setFreezeMemo("");
                                })
                                .catch(() => undefined);
                        }}
                    >
                        <div className="space-y-1.5">
                            <Label htmlFor="account-search">Search</Label>
                            <Input
                                id="account-search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Account name prefix"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div className="rounded-md border">
                            <AccountList
                                rows={freezeRows}
                                selected={freezeSelected}
                                onToggle={(account, on) =>
                                    toggle(
                                        freezeSelected,
                                        setFreezeSelected,
                                        account,
                                        on,
                                    )
                                }
                                onToggleAll={(on) =>
                                    toggleAll(
                                        freezeRows,
                                        freezeSelected,
                                        setFreezeSelected,
                                        on,
                                    )
                                }
                                empty={freezeEmpty}
                                isLoading={accountsQuery.isLoading}
                                error={accountsQuery.error}
                                hasNextPage={accountsQuery.hasNextPage}
                                isFetchingNextPage={
                                    accountsQuery.isFetchingNextPage
                                }
                                onLoadMore={() => {
                                    void accountsQuery.fetchNextPage();
                                }}
                            />
                        </div>
                        <ProposeFields
                            memoId="freeze-memo"
                            memo={freezeMemo}
                            onMemo={setFreezeMemo}
                            selectedCount={freezeSelected.size}
                            pending={isFreezing}
                            submitLabel={
                                freezeSelected.size > 0
                                    ? `Propose freeze (${freezeSelected.size})`
                                    : "Propose freeze"
                            }
                            pendingLabel="Proposing..."
                        />
                    </form>
                </TabsContent>

                <TabsContent value="unfreeze">
                    <form
                        className="space-y-4 rounded-lg border p-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (unfreezeSelected.size === 0) return;
                            void proposeUnfreeze([
                                [...unfreezeSelected],
                                memoOrUndefined(unfreezeMemo),
                            ])
                                .then(() => {
                                    setUnfreezeSelected(new Set());
                                    setUnfreezeMemo("");
                                })
                                .catch(() => undefined);
                        }}
                    >
                        <div className="rounded-md border">
                            <AccountList
                                rows={unfreezeRows}
                                selected={unfreezeSelected}
                                onToggle={(account, on) =>
                                    toggle(
                                        unfreezeSelected,
                                        setUnfreezeSelected,
                                        account,
                                        on,
                                    )
                                }
                                onToggleAll={(on) =>
                                    toggleAll(
                                        unfreezeRows,
                                        unfreezeSelected,
                                        setUnfreezeSelected,
                                        on,
                                    )
                                }
                                empty="No frozen accounts."
                                isLoading={frozenQuery.isLoading}
                                error={frozenQuery.error}
                                hasNextPage={frozenQuery.hasNextPage}
                                isFetchingNextPage={frozenQuery.isFetchingNextPage}
                                onLoadMore={() => {
                                    void frozenQuery.fetchNextPage();
                                }}
                            />
                        </div>
                        <ProposeFields
                            memoId="unfreeze-memo"
                            memo={unfreezeMemo}
                            onMemo={setUnfreezeMemo}
                            selectedCount={unfreezeSelected.size}
                            pending={isUnfreezing}
                            submitLabel={
                                unfreezeSelected.size > 0
                                    ? `Propose unfreeze (${unfreezeSelected.size})`
                                    : "Propose unfreeze"
                            }
                            pendingLabel="Proposing..."
                        />
                    </form>
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
};
