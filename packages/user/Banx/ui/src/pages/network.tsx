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
import { RoutingPolicyDialog } from "@/components/routing-policy-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import {
    useNetworkForwardOffers,
    useNetworkLines,
} from "@/hooks/use-banx-data";
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
    path: string;
    foreground: string;
    ring: string;
    background: string;
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
        path: css("--chart-5", "#ca8a04"),
        foreground: css("--foreground", "#171717"),
        ring: css("--ring", "#a3a3a3"),
        background: css("--background", "#ffffff"),
    };
}

function nodeRadius(node: { you?: boolean }): number {
    return node.you ? 7 : 4.5;
}

/** Matches ForceGraph `nodeRelSize`. Arrow inset uses the same radius. */
const NODE_REL_SIZE = 4;
const LINK_ARROW = 3.5;

function linkPoint(
    link: GLink,
    t: number,
): { x: number; y: number } | null {
    const source = endNode(link.source);
    const target = endNode(link.target);
    if (!source || !target || source.x == null || target.x == null) return null;
    const cp = (link as { __controlPoints?: number[] | null }).__controlPoints;
    if (!cp || cp.length !== 2) {
        return {
            x: source.x + (target.x - source.x) * t,
            y: source.y! + (target.y! - source.y!) * t,
        };
    }
    const mt = 1 - t;
    return {
        x: mt * mt * source.x + 2 * mt * t * cp[0]! + t * t * target.x,
        y: mt * mt * source.y! + 2 * mt * t * cp[1]! + t * t * target.y!,
    };
}

function endNode(end: GLink["source"]): GNode | null {
    if (!end || typeof end !== "object") return null;
    return end as GNode;
}

/** Arrow at the source, pointing back at it. The library only draws the target end. */
function paintSourceArrow(
    link: GLink,
    ctx: CanvasRenderingContext2D,
    color: string,
) {
    const samples = 12;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
        const point = linkPoint(link, i / samples);
        if (!point) return;
        points.push(point);
    }
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < samples; i++) {
        const length = Math.hypot(
            points[i + 1]!.x - points[i]!.x,
            points[i + 1]!.y - points[i]!.y,
        );
        lengths.push(length);
        total += length;
    }
    const headDist = NODE_REL_SIZE;
    const tailDist = NODE_REL_SIZE + LINK_ARROW;
    if (total <= tailDist + NODE_REL_SIZE) return;
    const at = (distance: number) => {
        let left = distance;
        for (let i = 0; i < samples; i++) {
            const span = lengths[i]!;
            if (left <= span || i === samples - 1) {
                const start = points[i]!;
                const end = points[i + 1]!;
                const t = span === 0 ? 0 : Math.min(1, left / span);
                return {
                    x: start.x + (end.x - start.x) * t,
                    y: start.y + (end.y - start.y) * t,
                };
            }
            left -= span;
        }
        return points[0]!;
    };
    const head = at(headDist);
    const tail = at(tailDist);
    const notch = at(NODE_REL_SIZE + LINK_ARROW * 0.8);
    const angle =
        Math.atan2(head.y - tail.y, head.x - tail.x) - Math.PI / 2;
    const half = LINK_ARROW / 1.6 / 2;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(
        tail.x + half * Math.cos(angle),
        tail.y + half * Math.sin(angle),
    );
    ctx.lineTo(notch.x, notch.y);
    ctx.lineTo(
        tail.x - half * Math.cos(angle),
        tail.y - half * Math.sin(angle),
    );
    ctx.fillStyle = color;
    ctx.fill();
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

function nodeAtPoint(
    nodes: readonly GNode[],
    x: number,
    y: number,
    scale: number,
    labelShown: (id: string) => boolean,
): string | null {
    const pad = 10 / (scale || 1);
    const font = 11 / (scale || 1);
    let best: { id: string; dist: number } | null = null;
    for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const id = String(node.id ?? "");
        if (!id) continue;
        const radius = nodeRadius(node);
        const halfW = labelShown(id)
            ? Math.max(
                  radius + pad,
                  (shortLabel(node.label).length * font * 0.55) / 2 + pad,
              )
            : radius + pad;
        const top = node.y - radius - pad;
        const bottom = labelShown(id)
            ? node.y + radius + font + pad
            : node.y + radius + pad;
        if (x < node.x - halfW || x > node.x + halfW || y < top || y > bottom) {
            continue;
        }
        const dist = Math.hypot(node.x - x, node.y - y);
        if (!best || dist < best.dist) best = { id, dist };
    }
    return best?.id ?? null;
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
    forwardingCount,
    onForwarding,
    onTransfer,
}: {
    account: string;
    user: string | undefined;
    lines: CreditLine[];
    labelOf: (account: string) => string;
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number;
    visibleIds: ReadonlySet<string>;
    onSelect: (account: string) => void;
    forwardingCount: number;
    onForwarding: () => void;
    onTransfer: () => void;
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
            <div className="flex flex-wrap gap-2">
                {you ? null : (
                    <Button
                        type="button"
                        size="sm"
                        className="w-fit"
                        onClick={onTransfer}
                    >
                        Transfer
                    </Button>
                )}
                <Button asChild variant="outline" size="sm" className="w-fit">
                    <Link to={accountHref(account)}>Open account</Link>
                </Button>
            </div>

            {you ? (
                <>
                    <YouSummary
                        lines={lines}
                        user={user}
                        forwardingCount={forwardingCount}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={onForwarding}
                    >
                        {forwardingCount > 0
                            ? "Edit path forwarding"
                            : "Turn on path forwarding"}
                    </Button>
                </>
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
    forwardingCount,
}: {
    lines: CreditLine[];
    user: string | undefined;
    forwardingCount: number;
}) {
    const extended = new Set<string>();
    const received = new Set<string>();
    for (const line of lines) {
        if (line.creditor === user) extended.add(line.debtor);
        if (line.debtor === user) received.add(line.creditor);
    }
    const extendedSentence =
        extended.size === 0
            ? "You have not extended a line to anyone."
            : `You have extended lines to ${extended.size} ${
                  extended.size === 1 ? "account" : "accounts"
              }.`;
    const receivedSentence =
        received.size === 0
            ? "Nobody has extended a line to you."
            : received.size === 1
              ? "1 account has extended a line to you."
              : `${received.size} accounts have extended a line to you.`;
    const forwarding =
        forwardingCount === 0
            ? "Path forwarding is off."
            : `Path forwarding is on for ${forwardingCount} ${
                  forwardingCount === 1 ? "currency" : "currencies"
              }.`;
    return (
        <p className="text-muted-foreground text-sm">
            {extended.size === 0 && received.size === 0
                ? "Offer a credit line from Accounts so someone can draw on you. "
                : null}
            {extendedSentence} {receivedSentence} {forwarding}
        </p>
    );
}

export function NetworkPage() {
    const { user, label } = useBanxContacts("/network");
    const { assets, symbolOf, precisionOf, byId } = useAssetMap();
    const {
        data: lines = [],
        isLoading: linesLoading,
        isError,
    } = useNetworkLines();
    const { data: offers = [], isLoading: offersLoading } =
        useNetworkForwardOffers();
    const isLoading = linesLoading || offersLoading;
    const [assetId, setAssetId] = useState<number | "all">("all");
    const [selected, setSelected] = useState<string | null>(null);
    const [forwardingOpen, setForwardingOpen] = useState(false);
    const [transferPayee, setTransferPayee] = useState<string | null>(null);
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
    const hitLabels = useRef<(id: string) => boolean>(() => false);
    const userRef = useRef(user);
    userRef.current = user;
    // A shaky click on You starts a node drag. Finish it as forwarding settings.
    const openForwardAfterDrag = useRef(false);
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
    const visibleOffers = useMemo(
        () =>
            assetId === "all"
                ? offers
                : offers.filter((offer) => offer.assetId === assetId),
        [offers, assetId],
    );

    const graph = useMemo(
        () =>
            buildNetworkGraph(
                visibleLines,
                visibleOffers,
                user ?? undefined,
                label,
            ),
        [visibleLines, visibleOffers, user, label],
    );
    const myForwarding = useMemo(
        () =>
            offers.filter((offer) => offer.isGlobal && offer.poster === user)
                .length,
        [offers, user],
    );
    const transferPrefill = useMemo(() => {
        if (!transferPayee) return null;
        const asset = assetId === "all" ? undefined : assetId;
        return { payee: transferPayee, fromAsset: asset, toAsset: asset };
    }, [transferPayee, assetId]);
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
            const youInside = !!node.you && radius * globalScale >= 16;
            if (youInside) {
                ctx.font = `600 ${12 / globalScale}px ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = colors.background;
                ctx.fillText("You", node.x, node.y);
            }
            if (id === selected || id === hover) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = colors.ring;
                ctx.stroke();
            }
            if (youInside) return;
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

    hitLabels.current = (id: string) => showAllLabels || focusIds.has(id);

    const labelShown = useCallback(
        (id: string) => showAllLabels || focusIds.has(id),
        [focusIds, showAllLabels],
    );

    const paintPointer = useCallback(
        (
            node: GNode,
            color: string,
            ctx: CanvasRenderingContext2D,
            globalScale: number,
        ) => {
            if (node.x == null || node.y == null) return;
            const id = String(node.id ?? "");
            const radius = nodeRadius(node);
            const pad = 10 / (globalScale || 1);
            const font = 11 / (globalScale || 1);
            const halfW = labelShown(id)
                ? Math.max(
                      radius + pad,
                      (shortLabel(node.label).length * font * 0.55) / 2 + pad,
                  )
                : radius + pad;
            const top = node.y - radius - pad;
            const height = labelShown(id)
                ? radius + pad + font + pad + radius
                : radius * 2 + pad * 2;
            ctx.fillStyle = color;
            ctx.fillRect(node.x - halfW, top, halfW * 2, height);
        },
        [labelShown],
    );

    const linkColor = useCallback((link: GLink) => {
        const colors = colorsRef.current ?? themeColors();
        if (link.extended && link.received) return colors.both;
        if (link.extended) return colors.extended;
        if (link.received) return colors.received;
        if (link.path) return colors.path;
        return colors.other;
    }, []);

    const fit = () => {
        fgRef.current?.zoomToFit(400, 56);
    };

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        let down: { x: number; y: number } | null = null;
        const onDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            down = { x: event.clientX, y: event.clientY };
        };
        const onUp = (event: PointerEvent) => {
            if (event.button !== 0 || !down) return;
            const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
            down = null;
            // A drag repositions a node or draws a credit line. Those already
            // choose the account. A click has to, because the graph treats any
            // mouse movement as a pan and then drops the click.
            const canvas = frame.querySelector("canvas");
            const api = fgRef.current;
            if (!canvas || !api) return;
            const rect = canvas.getBoundingClientRect();
            const point = api.screen2GraphCoords(
                event.clientX - rect.left,
                event.clientY - rect.top,
            );
            const id = nodeAtPoint(
                nodesRef.current,
                point.x,
                point.y,
                api.zoom() || 1,
                (account) => hitLabels.current(account),
            );
            const youClick = !!id && id === userRef.current;
            if (moved > 8) return;
            if (swallowClick.current || linkDrag.current) {
                if (youClick) openForwardAfterDrag.current = true;
                return;
            }
            setSelected(id);
            if (youClick) setForwardingOpen(true);
        };
        frame.addEventListener("pointerdown", onDown, true);
        frame.addEventListener("pointerup", onUp, true);
        return () => {
            frame.removeEventListener("pointerdown", onDown, true);
            frame.removeEventListener("pointerup", onUp, true);
        };
    }, []);

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
        const id = String(raw.id ?? "");
        const draft = linkDrag.current;
        const openForward = openForwardAfterDrag.current;
        openForwardAfterDrag.current = false;
        // A small pointer move is still a click. Node drag eats that click,
        // so the account is focused here unless this was a line dropped on someone.
        if (openForward) {
            if (draft) {
                for (const pinned of draft.pinned) {
                    pinned.node.fx = pinned.fx;
                    pinned.node.fy = pinned.fy;
                }
                linkDrag.current = null;
            }
            setHover(null);
            if (id) setSelected(id);
            setForwardingOpen(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    swallowClick.current = false;
                });
            });
            return;
        }
        if (!raw.you || !draft) {
            if (id) setSelected(id);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    swallowClick.current = false;
                });
            });
            return;
        }
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
        } else if (id) {
            setSelected(id);
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
                description="Lines show who can draw on whom. Offer a credit line from Accounts to show up here."
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
                    ) : !user && visibleLines.length === 0 ? (
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
                            nodeRelSize={NODE_REL_SIZE}
                            linkCurvature="curve"
                            linkWidth={(link) =>
                                link.path
                                    ? 1.1
                                    : link.extended || link.received
                                      ? 1.7
                                      : 1.5
                            }
                            linkLineDash={(link) =>
                                link.path ? [2, 3.5] : null
                            }
                            linkColor={linkColor}
                            linkDirectionalArrowLength={(link) =>
                                link.path ? 0 : LINK_ARROW
                            }
                            linkDirectionalArrowRelPos={1}
                            linkDirectionalArrowColor={linkColor}
                            linkDirectionalParticles={(link) =>
                                !link.both && (link.extended || link.received)
                                    ? 2
                                    : 0
                            }
                            linkCanvasObjectMode={(link) =>
                                link.both ? "after" : undefined
                            }
                            linkCanvasObject={(link, ctx) => {
                                if (!link.both) return;
                                paintSourceArrow(link, ctx, linkColor(link));
                            }}
                            linkDirectionalParticleWidth={1.6}
                            linkDirectionalParticleSpeed={0.004}
                            linkDirectionalParticleColor={linkColor}
                            nodeCanvasObjectMode={() => "replace"}
                            nodeCanvasObject={paintNode}
                            nodePointerAreaPaint={paintPointer}
                            onNodeHover={(node) => {
                                if (linkDrag.current) return;
                                setHover(node ? String(node.id ?? "") : null);
                            }}
                            onNodeDrag={(node) => {
                                swallowClick.current = true;
                                onYouDrag(node as GNode);
                            }}
                            onNodeDragEnd={(node) => onYouDragEnd(node as GNode)}
                            onRenderFramePost={paintDraft}
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
                    {(user || visibleLines.length > 0) && !isLoading && !isError ? (
                        <>
                            <div className="bg-card/90 pointer-events-none absolute top-3 left-3 rounded-md border px-2.5 py-2 text-xs shadow-sm">
                                <Legend />
                            </div>
                            {visibleLines.length === 0 ? (
                                <p className="text-muted-foreground pointer-events-none absolute bottom-3 left-3 max-w-xs text-sm">
                                    No credit lines
                                    {assetId === "all"
                                        ? " on the network"
                                        : " in this currency"}{" "}
                                    yet. Offer a credit line from Accounts so
                                    someone can draw on you.
                                </p>
                            ) : null}
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
                    <AccountList
                        nodes={graph.nodes}
                        lines={visibleLines}
                        selected={selected}
                        onSelect={setSelected}
                    />
                    {selected ? (
                        <div className="mt-4 border-t pt-4">
                            <AccountPanel
                                account={selected}
                                user={user ?? undefined}
                                lines={lines}
                                labelOf={label}
                                symbolOf={symbolOf}
                                precisionOf={precisionOf}
                                visibleIds={visibleIds}
                                onSelect={setSelected}
                                forwardingCount={myForwarding}
                                onForwarding={() => setForwardingOpen(true)}
                                onTransfer={() => setTransferPayee(selected)}
                            />
                        </div>
                    ) : null}
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
            <RoutingPolicyDialog
                open={forwardingOpen}
                onOpenChange={setForwardingOpen}
                assets={assets}
                prefill={assetId === "all" ? null : { assetId }}
            />
            <TransferDialog
                open={transferPayee !== null}
                onOpenChange={(open) => {
                    if (!open) setTransferPayee(null);
                }}
                prefill={transferPrefill}
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
                <li className="flex items-center gap-2">
                    <span className="border-chart-5 w-4 border-t border-dashed" />
                    Path forwarding
                </li>
            </ul>
            <p className="text-muted-foreground mt-1.5 max-w-44 leading-snug">
                Solid is a credit line. Arrows at both ends mean credit both
                ways. Drag You onto an account to offer a line.
            </p>
        </>
    );
}

function AccountList({
    nodes,
    lines,
    selected,
    onSelect,
}: {
    nodes: NetNode[];
    lines: CreditLine[];
    selected: string | null;
    onSelect: (account: string) => void;
}) {
    const selectedRef = useRef<HTMLButtonElement>(null);
    const degree = useMemo(() => {
        const counts = new Map<string, number>();
        for (const line of lines) {
            counts.set(line.creditor, (counts.get(line.creditor) ?? 0) + 1);
            counts.set(line.debtor, (counts.get(line.debtor) ?? 0) + 1);
        }
        return counts;
    }, [lines]);

    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: "nearest" });
    }, [selected]);

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
                    const focused = node.id === selected;
                    return (
                        <li key={node.id}>
                            <button
                                type="button"
                                ref={focused ? selectedRef : undefined}
                                aria-current={focused ? "true" : undefined}
                                className={`hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                                    focused ? "bg-muted" : ""
                                }`}
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
