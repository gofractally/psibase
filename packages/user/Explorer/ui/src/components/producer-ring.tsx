import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { BlockHeader } from "@/lib/types";
import type { ProducerStats } from "@/store/live-chain";
import { colorFor } from "@/lib/colors";
import { formatNumber } from "@/lib/format";

interface Props {
    producers: string[];
    stats: ProducerStats[];
    head: BlockHeader | null;
    mode?: string;
    size?: number;
    className?: string;
}

interface Pulse {
    key: number;
    from: string;
}

/**
 * A live constellation of the block producers. Each producer sits on a ring
 * around the chain head; every time a block is produced a pulse travels from
 * the producing node into the center and the node flashes.
 */
export const ProducerRing = ({
    producers,
    stats,
    head,
    mode,
    size = 360,
    className,
}: Props) => {
    const [pulses, setPulses] = useState<Pulse[]>([]);
    const lastBlock = useRef<number | null>(null);

    useEffect(() => {
        if (!head) return;
        if (lastBlock.current !== null && head.blockNum !== lastBlock.current) {
            setPulses((p) =>
                [...p, { key: head.blockNum, from: head.producer }].slice(-4),
            );
        }
        lastBlock.current = head.blockNum;
    }, [head]);

    const names = useMemo(() => {
        const set = new Set(producers);
        for (const s of stats) set.add(s.name);
        if (head) set.add(head.producer);
        return [...set];
    }, [producers, stats, head]);

    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.36;
    const nodeR = Math.max(14, Math.min(24, size / 16));
    const statMap = new Map(stats.map((s) => [s.name, s]));
    const totalBlocks = stats.reduce((a, b) => a + b.blocks, 0);

    const positions = useMemo(
        () =>
            names.map((name, i) => {
                const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, names.length);
                return {
                    name,
                    x: cx + R * Math.cos(angle),
                    y: cy + R * Math.sin(angle),
                };
            }),
        [names, cx, cy, R],
    );
    const posMap = new Map(positions.map((p) => [p.name, p]));

    return (
        <div className={className}>
            <svg
                viewBox={`0 0 ${size} ${size}`}
                className="h-auto w-full"
                role="img"
                aria-label="Block producer network"
            >
                <defs>
                    <radialGradient id="ring-core" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0" />
                    </radialGradient>
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* orbit */}
                <circle
                    cx={cx}
                    cy={cy}
                    r={R}
                    fill="none"
                    stroke="var(--border)"
                    strokeDasharray="3 5"
                />
                <circle cx={cx} cy={cy} r={R * 0.55} fill="url(#ring-core)" />

                {/* spokes */}
                {positions.map((p) => {
                    const active = head?.producer === p.name;
                    return (
                        <line
                            key={p.name}
                            x1={p.x}
                            y1={p.y}
                            x2={cx}
                            y2={cy}
                            stroke={active ? colorFor(p.name) : "var(--border)"}
                            strokeOpacity={active ? 0.6 : 0.8}
                            strokeWidth={active ? 1.5 : 1}
                        />
                    );
                })}

                {/* pulses */}
                <AnimatePresence>
                    {pulses.map((pulse) => {
                        const from = posMap.get(pulse.from);
                        if (!from) return null;
                        return (
                            <motion.circle
                                key={pulse.key}
                                r={5}
                                fill={colorFor(pulse.from)}
                                filter="url(#glow)"
                                initial={{ cx: from.x, cy: from.y, opacity: 1 }}
                                animate={{ cx, cy, opacity: 0.2 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.9, ease: "easeInOut" }}
                                onAnimationComplete={() =>
                                    setPulses((p) =>
                                        p.filter((x) => x.key !== pulse.key),
                                    )
                                }
                            />
                        );
                    })}
                </AnimatePresence>

                {/* center: head block */}
                <motion.circle
                    key={head?.blockNum ?? "none"}
                    cx={cx}
                    cy={cy}
                    r={R * 0.42}
                    fill="none"
                    stroke="var(--chart-2)"
                    initial={{ opacity: 0.7, scale: 0.92 }}
                    animate={{ opacity: 0, scale: 1.25 }}
                    transition={{ duration: 1 }}
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                />
                <circle
                    cx={cx}
                    cy={cy}
                    r={R * 0.42}
                    fill="var(--card)"
                    stroke="var(--border)"
                />
                <text
                    x={cx}
                    y={cy - 10}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{ fontSize: 10, letterSpacing: 1.5 }}
                >
                    HEAD
                </text>
                <text
                    x={cx}
                    y={cy + 10}
                    textAnchor="middle"
                    className="fill-foreground font-mono"
                    style={{ fontSize: Math.max(14, size / 18), fontWeight: 600 }}
                >
                    {head ? `#${formatNumber(head.blockNum)}` : "—"}
                </text>
                <text
                    x={cx}
                    y={cy + 26}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{ fontSize: 10 }}
                >
                    {mode ? `${mode} · term ${head?.term ?? "—"}` : ""}
                </text>

                {/* producer nodes */}
                {positions.map((p) => {
                    const s = statMap.get(p.name);
                    const active = head?.producer === p.name;
                    const inSet = producers.includes(p.name);
                    const color = colorFor(p.name);
                    const share = totalBlocks ? (s?.blocks ?? 0) / totalBlocks : 0;
                    const arcR = nodeR + 5;
                    const circumference = 2 * Math.PI * arcR;
                    const labelBelow = p.y >= cy;
                    return (
                        <g key={p.name}>
                            <Link to={`/accounts/${p.name}`}>
                                {active && (
                                    <motion.circle
                                        key={`${p.name}-${head?.blockNum}`}
                                        cx={p.x}
                                        cy={p.y}
                                        r={nodeR}
                                        fill={color}
                                        initial={{ opacity: 0.6, scale: 1 }}
                                        animate={{ opacity: 0, scale: 2 }}
                                        transition={{ duration: 1.1 }}
                                        style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                                    />
                                )}
                                {/* share arc */}
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={arcR}
                                    fill="none"
                                    stroke="var(--border)"
                                    strokeWidth={3}
                                />
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={arcR}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                    strokeDasharray={`${circumference * share} ${circumference}`}
                                    transform={`rotate(-90 ${p.x} ${p.y})`}
                                    style={{ transition: "stroke-dasharray 0.6s ease" }}
                                />
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={nodeR}
                                    fill="var(--card)"
                                    stroke={color}
                                    strokeWidth={active ? 2.5 : 1.5}
                                    strokeDasharray={inSet ? undefined : "3 3"}
                                    filter={active ? "url(#glow)" : undefined}
                                />
                                <text
                                    x={p.x}
                                    y={p.y + 4}
                                    textAnchor="middle"
                                    className="fill-foreground font-mono"
                                    style={{ fontSize: 11, fontWeight: 600 }}
                                >
                                    {p.name.slice(0, 2).toUpperCase()}
                                </text>
                                <text
                                    x={p.x}
                                    y={labelBelow ? p.y + arcR + 14 : p.y - arcR - 8}
                                    textAnchor="middle"
                                    className="fill-foreground font-mono"
                                    style={{ fontSize: 11 }}
                                >
                                    {p.name}
                                </text>
                                <text
                                    x={p.x}
                                    y={labelBelow ? p.y + arcR + 26 : p.y - arcR - 20}
                                    textAnchor="middle"
                                    className="fill-muted-foreground"
                                    style={{ fontSize: 9 }}
                                >
                                    {s ? `${s.blocks} blocks · ${Math.round(share * 100)}%` : "no blocks yet"}
                                </text>
                            </Link>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};
