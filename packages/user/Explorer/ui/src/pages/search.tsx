import { useQuery } from "@tanstack/react-query";
import { Loader2, SearchX } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { shortHash } from "@/lib/format";
import { fetchInstalledPackages } from "@/lib/queries";
import { classify, resolveSearch } from "@/lib/search";
import { useLiveChain } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { PageHeader, Panel } from "@/components/page-header";

const KIND_LABEL: Record<string, string> = {
    "block-number": "block number",
    hash: "block or transaction ID",
    "public-key": "public key",
    account: "account name",
    text: "text",
};

export const SearchPage = () => {
    const [params] = useSearchParams();
    const q = params.get("q")?.trim() ?? "";
    const navigate = useNavigate();
    const { kind } = classify(q);

    const resolution = useQuery({
        queryKey: ["search", q],
        queryFn: () => resolveSearch(q),
        enabled: q.length > 0,
        staleTime: 30_000,
    });

    useEffect(() => {
        if (resolution.data?.type === "navigate") {
            navigate(resolution.data.to, { replace: true });
        }
    }, [resolution.data, navigate]);

    const packages = useQuery({
        queryKey: ["packages", "installed"],
        queryFn: fetchInstalledPackages,
        staleTime: 5 * 60_000,
    });
    const producers = useLiveChain((s) => s.stats.producers);
    const recentTxs = useLiveChain((s) => s.recentTransactions);

    const lower = q.toLowerCase();
    const fuzzyAccounts = useMemo(() => {
        const out = new Map<string, string>();
        for (const p of packages.data ?? []) {
            for (const a of p.accounts) if (a.includes(lower)) out.set(a, p.name);
            if (p.name.toLowerCase().includes(lower))
                for (const a of p.accounts) if (!out.has(a)) out.set(a, p.name);
        }
        for (const p of producers) if (p.name.includes(lower)) out.set(p.name, "producer");
        return [...out.entries()].slice(0, 30);
    }, [packages.data, producers, lower]);

    const partialTxs = useMemo(
        () =>
            lower.length >= 4
                ? recentTxs.filter((t) => t.id.toLowerCase().includes(lower)).slice(0, 20)
                : [],
        [recentTxs, lower],
    );

    if (!q) {
        return (
            <PageHeader title="Search" description="Use the search box (⌘K) to look up blocks, transactions, accounts, or public keys." />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        Results for <span className="font-mono">{kind === "hash" ? shortHash(q, 10, 8) : q}</span>
                    </span>
                }
                description={`Interpreted as ${KIND_LABEL[kind]}`}
            />

            {resolution.isPending && (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" /> Looking up…
                </div>
            )}

            {resolution.data?.type === "accounts" && (
                <Panel title={`Accounts using this key (${resolution.data.accounts.length})`} bodyClassName="p-2">
                    {resolution.data.accounts.length === 0 ? (
                        <div className="text-muted-foreground p-4 text-sm">No accounts are secured by this public key.</div>
                    ) : (
                        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            {resolution.data.accounts.map((a) => (
                                <li key={a} className="hover:bg-accent/40 rounded-md px-2 py-1.5">
                                    <AccountLink name={a} />
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            )}

            {resolution.data?.type === "not-found" && (
                <div className="bg-card/70 flex flex-col items-center gap-2 rounded-xl border p-8 text-center">
                    <SearchX className="text-muted-foreground size-8" />
                    <div className="text-lg font-semibold">
                        {kind === "hash"
                            ? "No block or transaction with this ID"
                            : kind === "account"
                              ? `No account named “${q}”`
                              : kind === "public-key"
                                ? "Could not look up this key"
                                : "Nothing matched exactly"}
                    </div>
                    <p className="text-muted-foreground max-w-md text-sm">
                        {kind === "hash"
                            ? "Transaction lookups scan the most recent 20,000 blocks. Older transactions can be found by browsing the block they were included in."
                            : "Try one of the partial matches below, or refine your search."}
                    </p>
                </div>
            )}

            {resolution.isError && (
                <div className="text-destructive text-sm">{(resolution.error as Error).message}</div>
            )}

            {fuzzyAccounts.length > 0 && (
                <Panel title={`Accounts & services matching “${q}”`} bodyClassName="p-2">
                    <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {fuzzyAccounts.map(([name, pkg]) => (
                            <li key={name} className="hover:bg-accent/40 flex items-center justify-between rounded-md px-2 py-1.5">
                                <AccountLink name={name} />
                                <span className="text-muted-foreground text-xs">{pkg}</span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}

            {partialTxs.length > 0 && (
                <Panel title="Recent transactions with matching ID fragment" bodyClassName="p-2">
                    <ul className="flex flex-col gap-1">
                        {partialTxs.map((t) => (
                            <li key={t.id} className="hover:bg-accent/40 flex items-center justify-between rounded-md px-2 py-1.5 font-mono text-xs">
                                <Link to={`/tx/${t.id}`} className="text-primary hover:underline">
                                    {t.id}
                                </Link>
                                <span className="text-muted-foreground">block {t.blockNum}</span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
        </div>
    );
};
