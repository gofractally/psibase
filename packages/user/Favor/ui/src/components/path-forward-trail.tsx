import { formatToPrecision } from "@/lib/amount";
import { cn } from "@shared/lib/utils";

const SAMPLE_IN = 15;

function previewHopOut(
    amountIn: number,
    feeFixed: string,
    feePct: string,
): number | null {
    const fixed = Number(String(feeFixed).trim());
    const pct = Number(String(feePct).trim());
    if (!Number.isFinite(fixed) || !Number.isFinite(pct)) return null;
    if (fixed < 0 || pct < 0 || pct >= 100) return null;
    const afterPct = amountIn * (1 - pct / 100);
    if (fixed >= afterPct) return null;
    return afterPct - fixed;
}

function showAmount(amount: number, precision: number): string {
    return (
        formatToPrecision(amount.toFixed(Math.max(precision, 6)), precision) ??
        amount.toFixed(precision)
    );
}

function shortName(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 12 ? `${trimmed.slice(0, 11)}…` : trimmed;
}

/**
 * One path payment: the amount moves forward, and each hop leaves
 * an obligation pointing back at the person who drew.
 */
function pillLabel(amount: string, symbol?: string): string {
    const unit = symbol?.trim();
    return unit ? `${amount} ${unit}` : amount;
}

export function PathForwardTrail({
    hopFeeFixed,
    hopFeePct,
    precision,
    intermediate,
    symbol,
    nextHop = "bob",
    prior = "alice",
}: {
    hopFeeFixed: string;
    hopFeePct: string;
    precision: number;
    intermediate: string;
    symbol?: string;
    nextHop?: string;
    prior?: string;
}) {
    const payer = prior.trim() === intermediate.trim() ? "payer" : prior;
    const out = previewHopOut(SAMPLE_IN, hopFeeFixed, hopFeePct);
    const inStr = showAmount(SAMPLE_IN, precision);
    const outStr = out === null ? null : showAmount(out, precision);
    const inPill = pillLabel(inStr, symbol);
    const outPill = outStr === null ? null : pillLabel(outStr, symbol);
    const kept = out === null ? null : SAMPLE_IN - out;
    const keptShown =
        kept !== null && kept > 1e-9 ? showAmount(kept, precision) : null;
    const keptStr =
        keptShown !== null && !/^0(?:\.0+)?$/.test(keptShown)
            ? keptShown
            : null;
    const payerName = shortName(payer);
    const youName = shortName(intermediate);
    const nextName = shortName(nextHop);

    return (
        <figure className="space-y-2">
            <style>{TRAIL_CSS}</style>
            <div
                className="bg-muted/40 relative overflow-hidden rounded-lg border px-3 pt-3 pb-2"
                aria-hidden
            >
                <div className="grid grid-cols-3 text-center">
                    <Person name={payerName} />
                    <Person name={youName} you />
                    <Person name={nextName} />
                </div>

                <div className="relative mt-2 h-7">
                    <div className="bg-border absolute top-1/2 right-[16%] left-[16%] h-px -translate-y-1/2" />
                    <span className="bpx-coin bpx-coin-in">{inPill}</span>
                    {outPill ? (
                        <span className="bpx-coin bpx-coin-out">{outPill}</span>
                    ) : null}
                </div>

                <div className="mt-1 grid grid-cols-2 gap-2 px-[8%] text-center">
                    <Debt
                        className="bpx-debt-1"
                        who={`${payerName} owes ${youName}`}
                        amount={inStr}
                    />
                    {outStr ? (
                        <Debt
                            className="bpx-debt-2"
                            who={`${youName} owes ${nextName}`}
                            amount={outStr}
                        />
                    ) : (
                        <p className="text-muted-foreground bpx-debt-1 self-center text-[11px] leading-tight">
                            The fee uses the whole payment. Nothing is
                            forwarded.
                        </p>
                    )}
                </div>

                <p className="text-muted-foreground mt-1.5 h-4 text-center text-[11px]">
                    {keptStr ? (
                        <span className="bpx-keeps">
                            {youName} keeps {keptStr}
                        </span>
                    ) : (
                        <span className="invisible">keeps</span>
                    )}
                </p>
            </div>
            <figcaption className="text-muted-foreground text-xs leading-relaxed">
                {payerName} draws on {youName}, who draws on {nextName}. The
                payment moves forward. The debts stay behind.
            </figcaption>
        </figure>
    );
}

function Person({ name, you = false }: { name: string; you?: boolean }) {
    return (
        <div className="min-w-0">
            <div
                className={cn(
                    "mx-auto size-2.5 rounded-full",
                    you ? "bg-foreground" : "bg-muted-foreground/50",
                )}
            />
            <p
                className={cn(
                    "mt-1 truncate text-xs",
                    you
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                )}
            >
                {name}
            </p>
        </div>
    );
}

function Debt({
    who,
    amount,
    className,
}: {
    who: string;
    amount: string;
    className?: string;
}) {
    return (
        <div className={cn("bg-background rounded-md border px-1.5 py-1", className)}>
            <p className="text-muted-foreground truncate text-[10px] leading-tight">
                {who}
            </p>
            <p className="text-foreground text-xs font-medium tabular-nums">
                {amount}
            </p>
        </div>
    );
}

const TRAIL_CSS = `
.bpx-coin {
  position: absolute;
  top: 50%;
  z-index: 1;
  translate: -50% -50%;
  border-radius: 9999px;
  background: var(--foreground);
  color: var(--background);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  padding: 2px 6px;
  white-space: nowrap;
  pointer-events: none;
}
.bpx-coin-in { animation: bpx-coin-in 7.2s infinite; }
.bpx-coin-out { animation: bpx-coin-out 7.2s infinite; }
.bpx-debt-1 { animation: bpx-debt-1 7.2s infinite; }
.bpx-debt-2 { animation: bpx-debt-2 7.2s infinite; }
.bpx-keeps { animation: bpx-keeps 7.2s infinite; display: inline-block; }
@keyframes bpx-coin-in {
  0% { left: 16.5%; opacity: 0; }
  8% { opacity: 1; }
  30% { left: 50%; opacity: 1; }
  40% { left: 50%; opacity: 0; }
  100% { left: 50%; opacity: 0; }
}
@keyframes bpx-coin-out {
  0%, 36% { left: 50%; opacity: 0; }
  44% { left: 50%; opacity: 1; }
  66% { left: 83.5%; opacity: 1; }
  86% { opacity: 1; }
  96%, 100% { left: 83.5%; opacity: 0; }
}
@keyframes bpx-debt-1 {
  0%, 26% { opacity: 0; }
  36%, 88% { opacity: 1; }
  98%, 100% { opacity: 0; }
}
@keyframes bpx-debt-2 {
  0%, 60% { opacity: 0; }
  70%, 88% { opacity: 1; }
  98%, 100% { opacity: 0; }
}
@keyframes bpx-keeps {
  0%, 40% { opacity: 0; }
  50%, 88% { opacity: 1; }
  98%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bpx-coin-in { animation: none; opacity: 0; }
  .bpx-coin-out { animation: none; left: 83.5%; opacity: 1; }
  .bpx-debt-1, .bpx-debt-2, .bpx-keeps { animation: none; opacity: 1; }
}
`;
