export type ParamLimit = {
    parameter: string;
    lt: string | null;
    gt: string | null;
    eq: string | null;
};
export type InspectedAction = {
    service: string;
    method: string;
    parameters: Record<string, unknown>;
    limits: ParamLimit[];
    failures: string[];
};

export type Comparison = "lt" | "gt" | "eq";

/** Leaf fields only, as JSON pointers (nested objects are not listed themselves). */
export function parameters(
    value: Record<string, unknown>,
    prefix = "",
): [string, unknown][] {
    return Object.entries(value).flatMap(([name, v]) => {
        const path = `${prefix}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            return parameters(v as Record<string, unknown>, path);
        }
        return [[path, v] as [string, unknown]];
    });
}

/** One rule set per method; never silently pick between conflicting action rows. */
export function standingRules(actions: InspectedAction[]) {
    const methods = new Map<
        string,
        Pick<InspectedAction, "service" | "method" | "limits">
    >();
    for (const { service, method, limits } of actions) {
        const key = `${service}:${method}`;
        const existing = methods.get(key);
        if (
            existing &&
            JSON.stringify(existing.limits) !== JSON.stringify(limits)
        ) {
            throw new Error(
                `Conflicting limits for ${key}; use the same limits for each action`,
            );
        }
        for (const limit of limits) {
            for (const bound of [limit.lt, limit.gt, limit.eq]) {
                if (bound !== null) JSON.parse(bound);
            }
        }
        methods.set(key, { service, method, limits });
    }
    return [...methods.values()];
}

/** Keep stale/missing constrained fields editable so the owner can remove a rule. */
export function displayedParameters(
    action: InspectedAction,
): [string, unknown][] {
    const rows = parameters(action.parameters);
    const names = new Set(rows.map(([name]) => name));
    for (const limit of action.limits) {
        if (!names.has(limit.parameter))
            rows.push([limit.parameter, undefined]);
    }
    return rows;
}

/** Active comparison for a limit row (at most one is set by the Approvals UI). */
export function activeComparison(limit?: ParamLimit): Comparison | null {
    if (!limit) return null;
    if (limit.gt !== null) return "gt";
    if (limit.lt !== null) return "lt";
    if (limit.eq !== null) return "eq";
    return null;
}

export function activeBound(limit?: ParamLimit): string | null {
    const comparison = activeComparison(limit);
    if (!comparison || !limit) return null;
    return limit[comparison];
}

/** Build a single-comparison limit, or drop the parameter when the value is empty. */
export function setComparison(
    limits: ParamLimit[],
    parameter: string,
    comparison: Comparison,
    value: string,
): ParamLimit[] {
    const rest = limits.filter((l) => l.parameter !== parameter);
    if (value.trim() === "") return rest;
    return [
        ...rest,
        {
            parameter,
            lt: null,
            gt: null,
            eq: null,
            [comparison]: value,
        },
    ];
}
