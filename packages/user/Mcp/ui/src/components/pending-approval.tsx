import type { PendingRow } from "../lib/logic";

import { useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";

import {
    type InspectedAction,
    type ParamLimit,
    displayedParameters,
    standingRules,
} from "../lib/limits";

export type ApprovalMethod = "approve" | "approve-and-grant" | "reject";

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
    const [error, setError] = useState("");
    const change = (
        index: number,
        parameter: string,
        comparison: "lt" | "gt" | "eq",
        value: string | null,
    ) => {
        setActions((old) =>
            old.map((a) => {
                if (
                    a.service !== old[index].service ||
                    a.method !== old[index].method
                )
                    return a;
                const limit: ParamLimit = a.limits.find(
                    (l) => l.parameter === parameter,
                ) ?? { parameter, lt: null, gt: null, eq: null };
                return {
                    ...a,
                    limits: [
                        ...a.limits.filter((l) => l.parameter !== parameter),
                        { ...limit, [comparison]: value },
                    ],
                };
            }),
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
                <section key={index} className="space-y-2">
                    <h3 className="font-medium">
                        {a.service}.{a.method}
                    </h3>
                    {a.failures.map((reason) => (
                        <p
                            key={reason}
                            className="text-amber-700"
                            role="status"
                        >
                            {reason}
                        </p>
                    ))}
                    <p className="text-muted-foreground text-xs">
                        Enabled limits are saved by Approve and Grant. Values
                        are JSON: quote strings; numbers compare exactly,
                        including numeric strings. &lt; and &gt; are strict.
                    </p>
                    {displayedParameters(a).map(([name, value]) => {
                        const limit = a.limits.find(
                            (l) => l.parameter === name,
                        );
                        return (
                            <div
                                key={name}
                                className="border-border space-y-1 border-t pt-2"
                            >
                                <p>
                                    <code>{name}</code>:{" "}
                                    <code>
                                        {JSON.stringify(value) ?? "missing"}
                                    </code>
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
                                {(["lt", "gt", "eq"] as const).map(
                                    (comparison) => {
                                        const bound =
                                            limit?.[comparison] ?? null;
                                        const label = `${name} ${comparison}`;
                                        return (
                                            <div
                                                key={comparison}
                                                className="flex items-center gap-2"
                                            >
                                                <Checkbox
                                                    aria-label={`Enable ${label}`}
                                                    checked={bound !== null}
                                                    onCheckedChange={(
                                                        checked,
                                                    ) =>
                                                        change(
                                                            index,
                                                            name,
                                                            comparison,
                                                            checked === true
                                                                ? (JSON.stringify(
                                                                      value,
                                                                  ) ?? "null")
                                                                : null,
                                                        )
                                                    }
                                                />
                                                <span>
                                                    {comparison === "lt"
                                                        ? "Less than"
                                                        : comparison === "gt"
                                                          ? "Greater than"
                                                          : "Specific value"}
                                                </span>
                                                <Input
                                                    aria-label={label}
                                                    disabled={bound === null}
                                                    value={bound ?? ""}
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
                                        );
                                    },
                                )}
                            </div>
                        );
                    })}
                </section>
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
