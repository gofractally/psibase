import { TokenIcon } from "@shared/components/token-icon";

export const AmountSummary = ({
    tokenId,
    iconHash,
    label,
    title,
    amount,
}: {
    tokenId?: number;
    iconHash?: string | null;
    label: string;
    title: string;
    amount: string;
}) => (
    <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
            <TokenIcon
                tokenId={tokenId}
                iconHash={iconHash}
                className="size-9"
            />
            <div className="min-w-0 leading-tight">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                    {label}
                </p>
                <p className="truncate font-mono text-sm font-medium">
                    {title}
                </p>
            </div>
        </div>
        <div className="shrink-0 font-mono text-xl tabular-nums">{amount}</div>
    </div>
);
