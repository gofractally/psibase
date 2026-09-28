import type { Token } from "../hooks/tokens-plugin/use-user-token-balances";

import { Lock } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export const TokenBalances = ({
    tokens,
    selectedToken,
    onSelect,
}: {
    tokens: Token[];
    selectedToken?: Token;
    onSelect: (tokenId: string) => void;
}) => {
    return (
        <Panel
            title="Balances"
            description={`${tokens.length} token${tokens.length === 1 ? "" : "s"}`}
            className="self-start"
        >
            {tokens.length === 0 ? (
                <EmptyState className="min-h-24">No tokens held</EmptyState>
            ) : (
                <ul className="flex flex-col">
                    {tokens.map((token) => {
                        const selected = token.id === selectedToken?.id;
                        return (
                            <li
                                key={token.id}
                                className="border-b last:border-b-0"
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        onSelect(token.id.toString())
                                    }
                                    aria-pressed={selected}
                                    className={cn(
                                        "hover:bg-accent/40 relative flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                                        selected && "bg-accent/60",
                                    )}
                                >
                                    {selected && (
                                        <span className="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-r" />
                                    )}
                                    <Avatar
                                        account={token.label}
                                        type="glass"
                                        className="size-6 shrink-0 border-0 shadow-none"
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                                        <span className="flex items-center gap-1.5">
                                            <span
                                                className={cn(
                                                    "truncate font-mono text-sm font-medium",
                                                    !token.symbol &&
                                                        "text-muted-foreground italic",
                                                )}
                                            >
                                                {token.label}
                                            </span>
                                            {!token.isTransferable && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Lock className="text-muted-foreground size-3 shrink-0" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        Not transferable
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </span>
                                        <span className="text-muted-foreground text-[11px]">
                                            Token #{token.id}
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-right font-mono text-sm tabular-nums">
                                        {token.balance?.format({
                                            includeLabel: false,
                                        }) ?? "0"}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Panel>
    );
};
