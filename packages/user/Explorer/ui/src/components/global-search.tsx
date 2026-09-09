import { useQuery } from "@tanstack/react-query";
import {
    ArrowRight,
    Box,
    FileCode2,
    KeyRound,
    Loader2,
    Search,
    User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { formatNumber, shortHash } from "@/lib/format";
import { fetchInstalledPackages } from "@/lib/queries";
import { classify, resolveSearch } from "@/lib/search";
import { useLiveChain } from "@/store/use-live-chain";

import { cn } from "@shared/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@shared/shadcn/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@shared/shadcn/ui/dialog";

const KIND_HINT: Record<string, string> = {
    "block-number": "Go to block",
    hash: "Look up block or transaction",
    "public-key": "Find accounts with public key",
    account: "Open account",
    text: "Search",
};

export const GlobalSearch = ({ className }: { className?: string }) => {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setOpen((o) => !o);
            }
            if (e.key === "/" && !open) {
                const target = e.target as HTMLElement | null;
                const tag = target?.tagName;
                if (tag !== "INPUT" && tag !== "TEXTAREA") {
                    e.preventDefault();
                    setOpen(true);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const { data: packages } = useQuery({
        queryKey: ["packages", "installed"],
        queryFn: fetchInstalledPackages,
        staleTime: 5 * 60_000,
        enabled: open,
    });

    const producers = useLiveChain((s) => s.stats.producers);
    const recentTxs = useLiveChain((s) => s.recentUserTransactions);
    const recentBlocks = useLiveChain((s) => s.blocks);

    const term = value.trim();
    const lower = term.toLowerCase();
    const { kind } = classify(term);

    const serviceMatches = useMemo(() => {
        if (!packages || lower.length < 1) return [];
        const seen = new Set<string>();
        const out: { name: string; pkg: string }[] = [];
        for (const p of packages) {
            for (const acct of p.accounts) {
                if (acct.includes(lower) && !seen.has(acct)) {
                    seen.add(acct);
                    out.push({ name: acct, pkg: p.name });
                }
            }
            if (
                p.name.toLowerCase().includes(lower) &&
                p.accounts[0] &&
                !seen.has(p.accounts[0])
            ) {
                seen.add(p.accounts[0]);
                out.push({ name: p.accounts[0], pkg: p.name });
            }
        }
        return out.slice(0, 6);
    }, [packages, lower]);

    const producerMatches = useMemo(
        () =>
            lower.length > 0
                ? producers.filter((p) => p.name.includes(lower)).slice(0, 4)
                : producers.slice(0, 4),
        [producers, lower],
    );

    const txMatches = useMemo(() => {
        if (lower.length < 3 || kind === "account") return [];
        return recentTxs
            .filter((t) => t.id.toLowerCase().startsWith(lower))
            .slice(0, 5);
    }, [recentTxs, lower, kind]);

    const blockMatches = useMemo(() => {
        if (kind !== "block-number" || !term) return [];
        return recentBlocks
            .filter((b) => String(b.header.blockNum).startsWith(term))
            .slice(-5)
            .reverse();
    }, [recentBlocks, term, kind]);

    const go = useCallback(
        (to: string) => {
            setOpen(false);
            setValue("");
            setError(null);
            navigate(to);
        },
        [navigate],
    );

    const submit = useCallback(async () => {
        if (!term) return;
        setBusy(true);
        setError(null);
        try {
            const result = await resolveSearch(term);
            if (result.type === "navigate") {
                go(result.to);
            } else {
                go(`/search?q=${encodeURIComponent(term)}`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, [term, go]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                    "bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 min-w-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
                    className,
                )}
            >
                <Search className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                    <span className="sm:hidden">Search…</span>
                    <span className="hidden sm:inline">
                        Search blocks, transactions, accounts…
                    </span>
                </span>
                <kbd className="bg-muted text-muted-foreground hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline md:hidden lg:inline">
                    ⌘K
                </kbd>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-2xl"
                    showCloseButton={false}
                >
                    <DialogTitle className="sr-only">Search</DialogTitle>
                    <Command
                        shouldFilter={false}
                        className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
                    >
                        <CommandInput
                            value={value}
                            onValueChange={setValue}
                            placeholder="Block number, block ID, transaction ID, account, or public key"
                            className="h-12 border-0 font-mono text-sm shadow-none ring-0 focus:border-0 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.defaultPrevented) {
                                    const list = document.querySelector(
                                        '[cmdk-item][aria-selected="true"]',
                                    );
                                    if (!list) {
                                        e.preventDefault();
                                        void submit();
                                    }
                                }
                            }}
                        />
                        <CommandList className="max-h-[420px]">
                            {term && (
                                <CommandGroup heading="Go">
                                    <CommandItem
                                        value={`__submit__${term}`}
                                        onSelect={() => void submit()}
                                        className="flex items-center gap-3"
                                    >
                                        {busy ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <ArrowRight className="size-4" />
                                        )}
                                        <span className="flex-1 truncate">
                                            <span className="text-muted-foreground">
                                                {KIND_HINT[kind]}
                                            </span>{" "}
                                            <span className="font-mono">
                                                {kind === "hash"
                                                    ? shortHash(term, 10, 8)
                                                    : term}
                                            </span>
                                        </span>
                                        <kbd className="bg-muted rounded border px-1.5 font-mono text-[10px]">
                                            ↵
                                        </kbd>
                                    </CommandItem>
                                </CommandGroup>
                            )}
                            {error && (
                                <div className="text-destructive px-4 py-2 text-xs">
                                    {error}
                                </div>
                            )}
                            {blockMatches.length > 0 && (
                                <CommandGroup heading="Recent blocks">
                                    {blockMatches.map((b) => (
                                        <CommandItem
                                            key={b.id}
                                            value={`block-${b.header.blockNum}`}
                                            onSelect={() =>
                                                go(`/blocks/${b.header.blockNum}`)
                                            }
                                            className="flex items-center gap-3"
                                        >
                                            <Box className="size-4" />
                                            <span className="font-mono">
                                                #{formatNumber(b.header.blockNum)}
                                            </span>
                                            <span className="text-muted-foreground ml-auto font-mono text-xs">
                                                {b.transactions.length} tx ·{" "}
                                                {b.header.producer}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {txMatches.length > 0 && (
                                <CommandGroup heading="Recent transactions">
                                    {txMatches.map((t) => (
                                        <CommandItem
                                            key={t.id}
                                            value={`tx-${t.id}`}
                                            onSelect={() => go(`/tx/${t.id}`)}
                                            className="flex items-center gap-3"
                                        >
                                            <FileCode2 className="size-4" />
                                            <span className="font-mono text-xs">
                                                {shortHash(t.id, 12, 10)}
                                            </span>
                                            <span className="text-muted-foreground ml-auto text-xs">
                                                block {formatNumber(t.blockNum)}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {serviceMatches.length > 0 && (
                                <CommandGroup heading="Services & accounts">
                                    {serviceMatches.map((s) => (
                                        <CommandItem
                                            key={s.name}
                                            value={`svc-${s.name}`}
                                            onSelect={() => go(`/accounts/${s.name}`)}
                                            className="flex items-center gap-3"
                                        >
                                            <User className="size-4" />
                                            <span className="font-mono">{s.name}</span>
                                            <span className="text-muted-foreground ml-auto text-xs">
                                                {s.pkg}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {producerMatches.length > 0 && (
                                <CommandGroup heading="Producers">
                                    {producerMatches.map((p) => (
                                        <CommandItem
                                            key={p.name}
                                            value={`prod-${p.name}`}
                                            onSelect={() => go(`/accounts/${p.name}`)}
                                            className="flex items-center gap-3"
                                        >
                                            <KeyRound className="size-4" />
                                            <span className="font-mono">{p.name}</span>
                                            <span className="text-muted-foreground ml-auto text-xs">
                                                {p.blocks} recent blocks
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                            {!term && (
                                <CommandEmpty className="text-muted-foreground py-6 text-center text-xs">
                                    Type a block number, a 64-hex block or
                                    transaction ID, an account name, or a
                                    public key.
                                </CommandEmpty>
                            )}
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </>
    );
};
