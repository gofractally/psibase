import type { PendingRow } from "../lib/logic";

import { useState, type Dispatch, type SetStateAction } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

import {
    type Comparison,
    type InspectedAction,
    activeBound,
    activeComparison,
    displayedParameters,
    setComparison,
    standingRules,
} from "../lib/limits";

export type ApprovalMethod = "approve" | "approve-and-grant" | "reject";

const COMPARISON_LABEL: Record<Comparison, string> = {
    gt: ">",
    lt: "<",
    eq: "=",
};

function ActionSection({
    action: a,
    index,
    ops,
    setOps,
    change,
}: {
    action: InspectedAction;
    index: number;
    ops: Record<string, Comparison>;
    setOps: Dispatch<SetStateAction<Record<string, Comparison>>>;
    change: (
        index: number,
        parameter: string,
        comparison: Comparison,
        value: string,
    ) => void;
}) {
    const fields = displayedParameters(a);
    const fieldFailures = new Set(
        fields.flatMap(([name]) =>
            a.failures.filter((reason) => reason.startsWith(`${name}:`)),
        ),
    );
    return (
        <section className="space-y-2">
            <h3 className="font-medium">
                {a.service}.{a.method}
            </h3>
            {a.failures
                .filter((reason) => !fieldFailures.has(reason))
                .map((reason) => (
                    <p key={reason} className="text-amber-700" role="status">
                        {reason}
                    </p>
                ))}
            <p className="text-muted-foreground text-xs">
                Filled thresholds are saved by Approve and Grant for future txs.
                Values are JSON: quote strings; numbers compare exactly. &lt;
                and &gt; are strict.
            </p>
            {fields.map(([name, value]) => {
                const limit = a.limits.find((l) => l.parameter === name);
                const comparison =
                    ops[`${index}:${name}`] ??
                    activeComparison(limit) ??
                    "gt";
                const bound = activeBound(limit) ?? "";
                return (
                    <div
                        key={name}
                        className="border-border space-y-1 border-t pt-2"
                    >
                        <p>
                            <code>{name}</code>:{" "}
                            <code>{JSON.stringify(value) ?? "missing"}</code>
                        </p>
                        {a.failures
                            .filter((reason) =>
                                reason.startsWith(`${name}:`),
                            )
                            .map((reason) => (
                                <p
                                    key={reason}
                                    className="text-xs text-amber-700"
                                >
                                    {reason}
                                </p>
                            ))}
                        <div className="flex items-center gap-2">
                            <Select
                                value={comparison}
                                onValueChange={(next) => {
                                    const op = next as Comparison;
                                    setOps((old) => ({
                                        ...old,
                                        [`${index}:${name}`]: op,
                                    }));
                                    if (bound !== "")
                                        change(index, name, op, bound);
                                }}
                            >
                                <SelectTrigger
                                    size="sm"
                                    className="w-16"
                                    aria-label={`${name} comparison`}
                                >
                                    <SelectValue>
                                        {COMPARISON_LABEL[comparison]}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {(["gt", "lt", "eq"] as const).map(
                                        (op) => (
                                            <SelectItem key={op} value={op}>
                                                {COMPARISON_LABEL[op]}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                            <Input
                                aria-label={`${name} threshold`}
                                placeholder="threshold"
                                value={bound}
                                onChange={(e) =>
                                    change(
                                        index,
                                        name,
                                        comparison,
                                        e.target.value,
                                    )
                                }
                            />
                        </div>
                    </div>
                );
            })}
        </section>
    );
}

export function PendingApproval({
    row,
    busy,
    run,
}: {
    row: PendingRow;
    busy: boolean;
    run: (
        method: ApprovalMethod,
        row: PendingRow,
        rules?: string,
    ) => Promise<void>;
}) {
    const [actions, setActions] = useState<InspectedAction[]>(() =>
        JSON.parse(row.inspection ?? "[]"),
    );
    const [ops, setOps] = useState<Record<string, Comparison>>({});
    const [error, setError] = useState("");
    const change = (
        index: number,
        parameter: string,
        comparison: Comparison,
        value: string,
    ) => {
        setActions((old) =>
            old.map((a, i) =>
                i !== index
                    ? a
                    : {
                          ...a,
                          limits: setComparison(
                              a.limits,
                              parameter,
                              comparison,
                              value,
                          ),
                      },
            ),
        );
    };
    return (
        <div
            className="border-border space-y-3 rounded-lg border p-4"
            data-testid="pending-row"
            data-id={row.pending.id}
        >
            <p>
                #{row.pending.id} for <code>{row.pending.account}</code>{" "}
                (proposed by {row.pending.proposer})
            </p>
            <p>Not yet granted: {row.missing.join(", ") || "none"}</p>
            {actions.map((a, index) => (
                <ActionSection
                    key={index}
                    action={a}
                    index={index}
                    ops={ops}
                    setOps={setOps}
                    change={change}
                />
            ))}
            {error && <p role="alert">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    disabled={busy}
                    data-act="approve"
                    onClick={() => void run("approve", row)}
                >
                    Approve
                </Button>
                <Button
                    disabled={busy}
                    data-act="grant"
                    onClick={() => {
                        try {
                            const rules = JSON.stringify(
                                standingRules(actions),
                            );
                            setError("");
                            void run("approve-and-grant", row, rules);
                        } catch (e) {
                            setError(String(e));
                        }
                    }}
                >
                    Approve and Grant
                </Button>
                <Button
                    variant="outline"
                    disabled={busy}
                    data-act="reject"
                    onClick={() => void run("reject", row)}
                >
                    Reject
                </Button>
            </div>
        </div>
    );
}
