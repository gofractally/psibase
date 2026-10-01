import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ForceGraph2D, {
    type ForceGraphMethods,
    type LinkObject,
    type NodeObject,
} from "react-force-graph-2d";

// The published component type wraps node generics twice and rejects a React 19 ref.
type ForceGraphHandle = ForceGraphMethods<Record<string, never>, Record<string, never>>;

import { CreditLineDialog } from "@/components/credit-line-dialog";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useNetworkLines } from "@/hooks/use-banx-data";
import { accountHref } from "@/lib/account-groups";
import {
    displayAmount,
    formatRawAmount,
    humanToRaw,
    lineAvailableRaw,
} from "@/lib/amount";
import { formatGracePeriod, ppmToPercent } from "@/lib/constants";
import type { CreditLine } from "@/lib/graphql";
import {
    buildNetworkGraph,
    type NetLink,
    type NetNode,
} from "@/lib/network-graph";

import { Avatar } from "@shared/components/avatar";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

type GNode = NodeObject<NetNode>;
type GLink = LinkObject<NetNode, NetLink> & NetLink;

type ThemeColors = {
    you: string;
    extended: string;
    received: string;
    both: string;
    other: string;
    foreground: string;
    ring: string;
};

function themeColors(): ThemeColors {
    const css = (name: string, fallback: string) => {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        return value || fallback;
    };
    return {
        you: css("--primary", "#171717"),
        extended: css("--chart-2", "#0f766e"),
        received: css("--chart-1", "#c2410c"),
        both: css("--chart-4", "#7c3aed"),
        other: css("--muted-foreground", "#737373"),
        foreground: css("--foreground", "#171717"),
        ring: css("--ring", "#a3a3a3"),
    };
}

function nodeRadius(node: { you?: boolean }): number {
    return node.you ? 7 : 4.5;
}

type DragOrigin = { x: number; y: number; fx?: number; fy?: number };

function dragOrigin(node: GNode): DragOrigin | null {
    const parked = (node as { __initialDragPos?: DragOrigin }).__initialDragPos;
    if (parked?.x == null || parked.y == null) return null;
    return parked;
}

function holdAt(node: GNode, x: number, y: number) {
    node.x = x;
    node.y = y;
    node.fx = x;
    node.fy = y;
}

function dropTargetId(
    nodes: readonly GNode[],
    selfId: string,
    x: number,
    y: number,
    scale: number,
): string | null {
    const extra = 24 / (scale || 1);
    let best: { id: string; dist: number } | null = null;
    for (const node of nodes) {
        const id = String(node.id ?? "");
        if (!id || id === selfId || node.x == null || node.y == null) continue;
        const dist = Math.hypot(node.x - x, node.y - y);
        if (dist > nodeRadius(node) + extra) continue;
        if (!best || dist < best.dist) best = { id, dist };
    }
    return best?.id ?? null;
}

function offerFromDrop(
    lines: CreditLine[],
    user: string,
    debtor: string,
    assetFilter: number | "all",
): { debtor: string; editing: CreditLine | null; assetId?: number } {
    const mine = lines.filter(
        (line) => line.creditor === user && line.debtor === debtor,
    );
    if (assetFilter !== "all") {
        const existing = mine.find((line) => line.assetId === assetFilter);
        return existing
            ? { debtor, editing: existing }
            : { debtor, editing: null, assetId: assetFilter };
    }
    if (mine.length === 1) return { debtor, editing: mine[0]! };
    return { debtor, editing: null };
}

function endId(end: unknown): string {
    if (typeof end === "string" || typeof end === "number") return String(end);
    if (end && typeof end === "object" && "id" in end) {
        const id = (end as { id?: unknown }).id;
        return id == null ? "" : String(id);
    }
    return "";
}

function shortLabel(label: string): string {
    return label.length > 18 ? `${label.slice(0, 16)}…` : label;
}

function LineTerms({
    line,
    symbol,
    precision,
}: {
    line: CreditLine;
    symbol: string;
    precision: number;
}) {
    const open = formatRawAmount(
        lineAvailableRaw(
            humanToRaw(line.limit || "0", precision),
            humanToRaw(line.exposure || "0", precision),
            humanToRaw(line.remaining || "0", precision),
            line.depleteOnDebit,
        ).toString(),
        precision,
    );
    const grace = line.cycleStartedAt
        ? line.cycleGraceSeconds
        : line.graceSeconds;
    return (
        <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="font-mono">
                    {symbol}
                </Badge>
                <span className="text-muted-foreground text-xs">
                    {line.depleteOnDebit ? "Non-revolving" : "Revolving"}
                </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Limit</dt>
                <dd className="text-right font-mono tabular-nums">
                    {displayAmount(line.limit)}
                </dd>
                <dt className="text-muted-foreground">Drawn</dt>
                <dd className="text-right font-mono tabular-nums">
                    {displayAmount(line.exposure)}
                </dd>
                <dt className="text-muted-foreground">Open</dt>
                <dd className="text-right font-mono tabular-nums">{open}</dd>
                <dt className="text-muted-foreground">APR</dt>
                <dd className="text-right font-mono tabular-nums">
                    {ppmToPercent(line.interestRatePpm)}
                </dd>
            </dl>
            {grace > 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">
                    Interest-free {formatGracePeriod(grace)}
                    {line.cycleStartedAt ? " this cycle" : ""}
                </p>
            ) : null}
        </div>
    );
}

function AccountPanel({
    account,
    user,
    lines,
    labelOf,
    symbolOf,
    precisionOf,
    visibleIds,
    onSelect,
}: {
    account: string;
    user: string | undefined;
    lines: CreditLine[];
    labelOf: (account: string) => string;
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
    visibleIds: ReadonlySet<string>;
    onSelect: (account: string) => void;
}) {
    const you = account === user;
    const extended = lines.filter(
        (line) => line.creditor === user && line.debtor === account,
    );
    const received = lines.filter(
        (line) => line.debtor === user && line.creditor === account,
    );
    const others = useMemo(() => {
        const counts = new Map<string, number>();
        for (const line of lines) {
            const other =
                line.creditor === account
                    ? line.debtor
                    : line.debtor === account
                      ? line.creditor
                      : null;
            if (!other || other === user) continue;
            counts.set(other, (counts.get(other) ?? 0) + 1);
        }
        return [...counts.entries()]
            .filter(([id]) => visibleIds.has(id))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [lines, account, user, visibleIds]);

    const name = you ? user || "You" : labelOf(account);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
                <Avatar account={account} className="size-10 shrink-0" />
                <div className="min-w-0">
                    <p className="truncate font-medium">{you ? "You" : name}</p>
                    <p className="text-muted-foreground truncate text-sm">
                        {account}
                    </p>
                </div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to={accountHref(account)}>Open account</Link>
            </Button>

            {you ? (
                <YouSummary lines={lines} user={user} />
            ) : (
                <>
                    <section className="space-y-2">
                        <h2 className="text-sm font-medium">
                            Credit you extended
                        </h2>
                        {extended.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                You have not extended {name} a credit line.
                            </p>
                        ) : (
                            extended.map((line) => (
                                <LineTerms
                                    key={`${line.assetId}`}
                                    line={line}
                                    symbol={symbolOf(line.assetId)}
                                    precision={precisionOf(line.assetId)}
                                />
                            ))
                        )}
                    </section>
                    {received.length > 0 ? (
                        <section className="space-y-2">
                            <h2 className="text-sm font-medium">
                                Credit they extended you
                            </h2>
                            {received.map((line) => (
                                <LineTerms
                                    key={`in-${line.assetId}`}
                                    line={line}
                                    symbol={symbolOf(line.assetId)}
                                    precision={precisionOf(line.assetId)}
                                />
                            ))}
                        </section>
                    ) : null}
                </>
            )}

            {others.length > 0 ? (
                <section className="space-y-1">
                    <h2 className="text-sm font-medium">Also connected to</h2>
                    <ul className="space-y-0.5">
                        {others.slice(0, 12).map(([id, count]) => (
                            <li key={id}>
                                <button
                                    type="button"
                                    className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm"
                                    onClick={() => onSelect(id)}
                                >
                                    <span className="font-medium">
                                        {labelOf(id)}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {" "}
                                        · {count}{" "}
                                        {count === 1 ? "line" : "lines"}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    {others.length > 12 ? (
                        <p className="text-muted-foreground px-2 text-xs">
                            and {others.length - 12} more
                        </p>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}

function YouSummary({
    lines,
    user,
}: {
    lines: CreditLine[];
    user: string | undefined;
}) {
    const extended = new Set<string>();
    const received = new Set<string>();
    for (const line of lines) {
        if (line.creditor === user) extended.add(line.debtor);
        if (line.debtor === user) received.add(line.creditor);
    }
    return (
        <p className="text-muted-foreground text-sm">
            You have extended lines to {extended.size}{" "}
            {extended.size === 1 ? "account" : "accounts"}. {received.size}{" "}
            {received.size === 1 ? "account has" : "accounts have"} extended
            you a line.
        </p>
    );
}

export function NetworkPage() {
    const { user, label } = useBanxContacts("/network");
    const { assets, symbolOf, precisionOf, byId } = useAssetMap();
    const {
        data: lines = [],
        isLoading,
        isError,
    } = useNetworkLines();
    const [assetId, setAssetId] = useState<number | "all">("all");
    const [selected, setSelected] = useState<string | null>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [offer, setOffer] = useState<{
        debtor: string;
        editing: CreditLine | null;
        assetId?: number;
    } | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const frameRef = useRef<HTMLDivElement>(null);
    const fitted = useRef(false);
    const colorsRef = useRef<ThemeColors | null>(null);
    const fgRef = useRef<ForceGraphHandle | undefined>(undefined);
    const linkDrag = useRef<{
        fromX: number;
        fromY: number;
        x: number;
        y: number;
        targetId: string | null;
        pinned: { node: GNode; fx: number | undefined; fy: number | undefined }[];
    } | null>(null);
    const nodesRef = useRef<GNode[]>([]);
    // A finished drag still emits a click on the next frame.
    const swallowClick = useRef(false);
    if (typeof document !== "undefined") colorsRef.current = themeColors();
    const assetShown = useRef(assetId);
    if (assetShown.current !== assetId) {
        assetShown.current = assetId;
        fitted.current = false;
    }

    const assetIds = useMemo(() => {
        const ids = [...new Set(lines.map((line) => line.assetId))];
        ids.sort((a, b) =>
            (byId.get(a)?.symbol ?? "").localeCompare(byId.get(b)?.symbol ?? ""),
        );
        return ids;
    }, [lines, byId]);

    const visibleLines = useMemo(
        () =>
            assetId === "all"
                ? lines
                : lines.filter((line) => line.assetId === assetId),
        [lines, assetId],
    );

    const graph = useMemo(
        () => buildNetworkGraph(visibleLines, user ?? undefined, label),
        [visibleLines, user, label],
    );
    const visibleIds = useMemo(
        () => new Set(graph.nodes.map((node) => node.id)),
        [graph.nodes],
    );
    nodesRef.current = graph.nodes as GNode[];

    useEffect(() => {
        if (!selected) return;
        if (!graph.nodes.some((node) => node.id === selected)) {
            setSelected(null);
        }
    }, [graph.nodes, selected]);

    useEffect(() => {
        const el = frameRef.current;
        if (!el) return;
        const measure = () => {
            // clientWidth excludes the border. Measuring the border box and
            // painting a canvas of that size makes the frame grow every tick.
            const width = el.clientWidth;
            const height = el.clientHeight;
            setSize((prev) =>
                prev.width === width && prev.height === height
                    ? prev
                    : { width, height },
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [isLoading, visibleLines.length]);

    const focusIds = useMemo(() => {
        const ids = new Set<string>();
        if (user) ids.add(user);
        if (selected) ids.add(selected);
        if (hover) ids.add(hover);
        if (selected) {
            for (const link of graph.links) {
                const source = endId(link.source);
                const target = endId(link.target);
                if (source === selected) ids.add(target);
                if (target === selected) ids.add(source);
            }
        }
        return ids;
    }, [graph.links, hover, selected, user]);

    const showAllLabels = graph.nodes.length <= 40;

    const paintNode = useCallback(
        (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
            if (node.x == null || node.y == null) return;
            const colors = colorsRef.current ?? themeColors();
            const radius = nodeRadius(node);
            const id = String(node.id ?? "");
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = node.you
                ? colors.you
                : node.extended && node.received
                  ? colors.both
                  : node.extended
                    ? colors.extended
                    : node.received
                      ? colors.received
                      : colors.other;
            ctx.fill();
            if (id === selected || id === hover) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = colors.ring;
                ctx.stroke();
            }
            if (!showAllLabels && !focusIds.has(id)) return;
            const fontSize = 11 / globalScale;
            ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = colors.foreground;
            ctx.fillText(
                shortLabel(node.label),
                node.x,
                node.y + radius + 1.5 / globalScale,
            );
        },
        [focusIds, hover, selected, showAllLabels],
    );

    const paintPointer = useCallback(
        (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
            if (node.x == null || node.y == null) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(
                node.x,
                node.y,
                nodeRadius(node) + (node.you ? 8 : 2),
                0,
                2 * Math.PI,
            );
            ctx.fill();
        },
        [],
    );

    const linkColor = useCallback((link: GLink) => {
        const colors = colorsRef.current ?? themeColors();
        if (link.extended) return colors.extended;
        if (link.received) return colors.received;
        return colors.other;
    }, []);

    const fit = () => {
        fgRef.current?.zoomToFit(400, 56);
    };

    const paintDraft = useCallback(
        (ctx: CanvasRenderingContext2D, globalScale: number) => {
            const draft = linkDrag.current;
            if (!draft) return;
            const colors = colorsRef.current ?? themeColors();
            let x = draft.x;
            let y = draft.y;
            if (draft.targetId) {
                const target = nodesRef.current.find(
                    (node) => String(node.id) === draft.targetId,
                );
                if (target?.x != null && target.y != null) {
                    x = target.x;
                    y = target.y;
                }
            }
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(draft.fromX, draft.fromY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = draft.targetId ? colors.extended : colors.ring;
            ctx.lineWidth = 1.75 / globalScale;
            ctx.setLineDash([5 / globalScale, 4 / globalScale]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(x, y, 3.5 / globalScale, 0, 2 * Math.PI);
            ctx.fillStyle = draft.targetId ? colors.extended : colors.ring;
            ctx.fill();
            ctx.restore();
        },
        [],
    );

    const onYouDrag = (raw: GNode) => {
        if (!raw.you || raw.x == null || raw.y == null) return;
        const pointer = { x: raw.x, y: raw.y };
        const origin = dragOrigin(raw);
        if (!origin) return;
        // The library moves the dragged node to the pointer. You stays put;
        // the pointer is the end of a new credit line.
        holdAt(raw, origin.x, origin.y);
        const selfId = String(raw.id ?? "");
        const scale = fgRef.current?.zoom() ?? 1;
        const targetId = dropTargetId(
            nodesRef.current,
            selfId,
            pointer.x,
            pointer.y,
            scale,
        );
        if (!linkDrag.current) {
            const pinned = nodesRef.current
                .filter((node) => String(node.id) !== selfId)
                .map((node) => {
                    const saved = { node, fx: node.fx, fy: node.fy };
                    if (node.x != null) node.fx = node.x;
                    if (node.y != null) node.fy = node.y;
                    return saved;
                });
            linkDrag.current = {
                fromX: origin.x,
                fromY: origin.y,
                x: pointer.x,
                y: pointer.y,
                targetId,
                pinned,
            };
        } else {
            linkDrag.current.fromX = origin.x;
            linkDrag.current.fromY = origin.y;
            linkDrag.current.x = pointer.x;
            linkDrag.current.y = pointer.y;
            linkDrag.current.targetId = targetId;
        }
        swallowClick.current = true;
        setHover((prev) => (prev === targetId ? prev : targetId));
    };

    const onYouDragEnd = (raw: GNode) => {
        const draft = linkDrag.current;
        if (!raw.you || !draft) return;
        for (const pinned of draft.pinned) {
            pinned.node.fx = pinned.fx;
            pinned.node.fy = pinned.fy;
        }
        const targetId = draft.targetId;
        linkDrag.current = null;
        setHover(null);
        if (targetId && user) {
            setSelected(targetId);
            setOffer(offerFromDrop(lines, user, targetId, assetId));
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                swallowClick.current = false;
            });
        });
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <PageHeader
                title="Network"
                description="Every credit line. The arrow points at the account that can draw. Drag from you onto someone to offer them a line."
                action={
                    assetIds.length > 1 ? (
                        <select
                            aria-label="Currency"
                            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                            value={assetId === "all" ? "" : String(assetId)}
                            onChange={(event) => {
                                const value = event.target.value;
                                setAssetId(value ? Number(value) : "all");
                            }}
                        >
                            <option value="">All currencies</option>
                            {assetIds.map((id) => (
                                <option key={id} value={id}>
                                    {symbolOf(id)}
                                </option>
                            ))}
                        </select>
                    ) : null
                }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
                <div className="bg-card relative min-h-80 w-full flex-1 overflow-hidden rounded-xl border lg:min-h-0 lg:min-w-0">
                    <div ref={frameRef} className="absolute inset-0 overflow-hidden">
                    {isLoading ? (
                        <Skeleton className="h-full w-full rounded-none" />
                    ) : isError ? (
                        <p className="text-destructive p-4 text-sm">
                            Could not load the network.
                        </p>
                    ) : visibleLines.length === 0 ? (
                        <p className="text-muted-foreground p-4 text-sm">
                            No credit lines
                            {assetId === "all" ? " on the network" : " in this currency"}{" "}
                            yet.
                        </p>
                    ) : size.width > 0 && size.height > 0 ? (
                        <ForceGraph2D
                            ref={fgRef as never}
                            width={size.width}
                            height={size.height}
                            graphData={graph as never}
                            backgroundColor="rgba(0,0,0,0)"
                            nodeId="id"
                            nodeLabel="label"
                            nodeRelSize={4}
                            linkCurvature="curve"
                            linkWidth={(link) =>
                                link.extended || link.received ? 1.6 : 0.65
                            }
                            linkColor={linkColor}
                            linkDirectionalArrowLength={3.5}
                            linkDirectionalArrowRelPos={1}
                            linkDirectionalArrowColor={linkColor}
                            linkDirectionalParticles={(link) =>
                                link.extended || link.received ? 2 : 0
                            }
                            linkDirectionalParticleWidth={1.6}
                            linkDirectionalParticleSpeed={0.004}
                            linkDirectionalParticleColor={linkColor}
                            nodeCanvasObjectMode={() => "replace"}
                            nodeCanvasObject={paintNode}
                            nodePointerAreaPaint={paintPointer}
                            onNodeClick={(node) => {
                                if (swallowClick.current) return;
                                setSelected(String(node.id ?? ""));
                            }}
                            onNodeHover={(node) => {
                                if (linkDrag.current) return;
                                setHover(node ? String(node.id ?? "") : null);
                            }}
                            onNodeDrag={(node) => onYouDrag(node as GNode)}
                            onNodeDragEnd={(node) => onYouDragEnd(node as GNode)}
                            onRenderFramePost={paintDraft}
                            onBackgroundClick={() => {
                                if (swallowClick.current) return;
                                setSelected(null);
                            }}
                            onEngineStop={() => {
                                if (fitted.current) return;
                                fitted.current = true;
                                fgRef.current?.zoomToFit(400, 56);
                            }}
                            cooldownTicks={90}
                            warmupTicks={40}
                            autoPauseRedraw={
                                !graph.links.some(
                                    (link) => link.extended || link.received,
                                )
                            }
                            minZoom={0.25}
                            maxZoom={8}
                            enableNodeDrag
                        />
                    ) : null}
                    </div>
                    {visibleLines.length > 0 ? (
                        <>
                            <div className="bg-card/90 pointer-events-none absolute top-3 left-3 rounded-md border px-2.5 py-2 text-xs shadow-sm">
                                <Legend />
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="absolute top-3 right-3"
                                onClick={fit}
                            >
                                Fit
                            </Button>
                        </>
                    ) : null}
                </div>

                <aside className="bg-card h-64 w-full shrink-0 overflow-y-auto rounded-xl border p-4 lg:h-auto lg:min-h-0 lg:w-80">
                    {selected ? (
                        <AccountPanel
                            account={selected}
                            user={user ?? undefined}
                            lines={lines}
                            labelOf={label}
                            symbolOf={symbolOf}
                            precisionOf={precisionOf}
                            visibleIds={visibleIds}
                            onSelect={setSelected}
                        />
                    ) : (
                        <AccountList
                            nodes={graph.nodes}
                            lines={visibleLines}
                            onSelect={setSelected}
                        />
                    )}
                </aside>
            </div>
            <CreditLineDialog
                open={offer !== null}
                onOpenChange={(open) => {
                    if (!open) setOffer(null);
                }}
                assets={assets}
                precisionOf={precisionOf}
                editing={offer?.editing ?? null}
                prefillDebtor={offer?.debtor}
                assetId={offer?.assetId}
            />
        </div>
    );
}

function Legend() {
    const items = [
        ["bg-primary", "You"],
        ["bg-chart-2", "Line you extended"],
        ["bg-chart-1", "Line extended to you"],
        ["bg-chart-4", "Both"],
        ["bg-muted-foreground", "Other lines"],
    ] as const;
    return (
        <>
            <ul className="space-y-1">
                {items.map(([dot, text]) => (
                    <li key={text} className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${dot}`} />
                        {text}
                    </li>
                ))}
            </ul>
            <p className="text-muted-foreground mt-1.5 max-w-44 leading-snug">
                Drag You onto an account to offer a line.
            </p>
        </>
    );
}

function AccountList({
    nodes,
    lines,
    onSelect,
}: {
    nodes: NetNode[];
    lines: CreditLine[];
    onSelect: (account: string) => void;
}) {
    const degree = useMemo(() => {
        const counts = new Map<string, number>();
        for (const line of lines) {
            counts.set(line.creditor, (counts.get(line.creditor) ?? 0) + 1);
            counts.set(line.debtor, (counts.get(line.debtor) ?? 0) + 1);
        }
        return counts;
    }, [lines]);

    if (nodes.length === 0) {
        return (
            <p className="text-muted-foreground text-sm">
                Accounts show up here once a credit line exists.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <h2 className="text-sm font-medium">Accounts</h2>
            <ul className="space-y-0.5">
                {nodes.map((node) => {
                    const count = degree.get(node.id) ?? 0;
                    return (
                        <li key={node.id}>
                            <button
                                type="button"
                                className="hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                                onClick={() => onSelect(node.id)}
                            >
                                <span className="truncate font-medium">
                                    {node.you ? "You" : node.label}
                                </span>
                                <span className="text-muted-foreground shrink-0 text-xs">
                                    {count} {count === 1 ? "line" : "lines"}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
