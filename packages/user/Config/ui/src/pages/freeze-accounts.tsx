import { useStore } from "@tanstack/react-form";
import { TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";

import { FreezeRootWarning } from "@/components/freeze-root-warning";
import { useAccountsByPrefix } from "@/hooks/use-accounts-by-prefix";
import {
    useFreezeAccounts,
    useUnfreezeAccounts,
} from "@/hooks/use-freeze-accounts";
import { useFrozenAccounts } from "@/hooks/use-frozen-accounts";
import { rootFreezeGaps, type RootFreezeGap } from "@/lib/freeze-root-gap";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Spinner } from "@shared/shadcn/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";

type AccountRow = {
    account: string;
    detail: string;
};

const zOptionalMemo = z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : undefined));

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

export const FreezeAccounts = () => {
    const [freezeSelected, setFreezeSelected] = useState<Set<string>>(
        () => new Set(),
    );
    const [unfreezeSelected, setUnfreezeSelected] = useState<Set<string>>(
        () => new Set(),
    );
    const [rootGaps, setRootGaps] = useState<RootFreezeGap[] | null>(null);
    const allowRootGap = useRef(false);

    const { mutateAsync: proposeFreeze, isPending: isFreezing } =
        useFreezeAccounts();
    const { mutateAsync: proposeUnfreeze, isPending: isUnfreezing } =
        useUnfreezeAccounts();

    const freezeForm = useAppForm({
        defaultValues: { search: "", memo: "" },
        onSubmit: async ({ value }) => {
            if (freezeSelected.size === 0) return;
            const bypassWarning = allowRootGap.current;
            allowRootGap.current = false;
            if (!bypassWarning) {
                const gaps = rootFreezeGaps(freezeSelected);
                if (gaps.length > 0) {
                    setRootGaps(gaps);
                    return;
                }
            }
            await proposeFreeze([
                [...freezeSelected],
                zOptionalMemo.parse(value.memo),
            ]);
            setFreezeSelected(new Set());
            setRootGaps(null);
            freezeForm.setFieldValue("memo", "");
        },
    });
    const unfreezeForm = useAppForm({
        defaultValues: { memo: "" },
        onSubmit: async ({ value }) => {
            if (unfreezeSelected.size === 0) return;
            await proposeUnfreeze([
                [...unfreezeSelected],
                zOptionalMemo.parse(value.memo),
            ]);
            setUnfreezeSelected(new Set());
            unfreezeForm.setFieldValue("memo", "");
        },
    });

    const search = useStore(freezeForm.store, (state) => state.values.search);
    const accountsQuery = useAccountsByPrefix(search);
    const frozenQuery = useFrozenAccounts();

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

    const confirmFreeze = () => {
        allowRootGap.current = true;
        void freezeForm.handleSubmit();
    };

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
                        <AlertDescription variant="warning">
                            Freezing sets the account's auth service to
                            auth-none, so it can no longer authorize
                            transactions.
                        </AlertDescription>
                    </Alert>

                    <form
                        className="space-y-4 rounded-lg border p-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void freezeForm.handleSubmit();
                        }}
                    >
                        <freezeForm.AppField name="search">
                            {(field) => (
                                <field.TextField
                                    id="account-search"
                                    label="Search"
                                    placeholder="Account name prefix"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            )}
                        </freezeForm.AppField>
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
                        <freezeForm.AppField name="memo">
                            {(field) => (
                                <field.TextArea
                                    id="freeze-memo"
                                    label="Memo"
                                    placeholder="Optional. Recorded on each account in this proposal."
                                />
                            )}
                        </freezeForm.AppField>
                        <div className="flex justify-end">
                            <freezeForm.AppForm>
                                <freezeForm.SubmitButton
                                    disabled={freezeSelected.size === 0}
                                    loading={isFreezing}
                                    labels={[
                                        freezeSelected.size > 0
                                            ? `Propose freeze (${freezeSelected.size})`
                                            : "Propose freeze",
                                        "Proposing...",
                                    ]}
                                />
                            </freezeForm.AppForm>
                        </div>
                    </form>
                    <FreezeRootWarning
                        gaps={rootGaps}
                        pending={isFreezing}
                        onOpenChange={(open) => {
                            if (!open && !isFreezing) setRootGaps(null);
                        }}
                        onUnderstand={confirmFreeze}
                    />
                </TabsContent>

                <TabsContent value="unfreeze">
                    <form
                        className="space-y-4 rounded-lg border p-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void unfreezeForm.handleSubmit();
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
                        <unfreezeForm.AppField name="memo">
                            {(field) => (
                                <field.TextArea
                                    id="unfreeze-memo"
                                    label="Memo"
                                    placeholder="Optional. Recorded on each account in this proposal."
                                />
                            )}
                        </unfreezeForm.AppField>
                        <div className="flex justify-end">
                            <unfreezeForm.AppForm>
                                <unfreezeForm.SubmitButton
                                    disabled={unfreezeSelected.size === 0}
                                    loading={isUnfreezing}
                                    labels={[
                                        unfreezeSelected.size > 0
                                            ? `Propose unfreeze (${unfreezeSelected.size})`
                                            : "Propose unfreeze",
                                        "Proposing...",
                                    ]}
                                />
                            </unfreezeForm.AppForm>
                        </div>
                    </form>
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
};
