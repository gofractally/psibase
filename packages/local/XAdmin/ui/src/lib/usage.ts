import { z } from "zod";

import { getJson, postJson, siblingUrl } from "@psibase/common-lib";

import { adminBearerAuthHeaders } from "./admin-login-jwt";

// Usage metering (the x-usage service): what each connection identity used
// of this node. 64-bit counters arrive as strings.
const count = z.coerce.number();

export const usageCounterNames = [
    "requests",
    "bytesIn",
    "bytesOut",
    "messagesIn",
    "messagesOut",
    "requestNs",
    "trxPushed",
    "trialOk",
    "trialFailed",
    "trialNs",
    "compileNs",
    "verifyRuns",
    "verifyNs",
    "callbackNs",
] as const;
export type UsageCounterName = (typeof usageCounterNames)[number];

const UsageCounters = z.object({
    requests: count,
    bytesIn: count,
    bytesOut: count,
    messagesIn: count,
    messagesOut: count,
    requestNs: count,
    trxPushed: count,
    trialOk: count,
    trialFailed: count,
    trialNs: count,
    compileNs: count,
    verifyRuns: count,
    verifyNs: count,
    callbackNs: count,
});
export type UsageCountersType = z.infer<typeof UsageCounters>;

const UsageRecord = z.object({
    identity: z.string(),
    kind: z.string(),
    id: z.string(),
    firstSeen: count,
    lastSeen: count,
    keepUntil: count,
    units: count,
    total: UsageCounters,
    recent: UsageCounters,
    quota: UsageCounters.nullish(),
});
export type UsageRecordType = z.infer<typeof UsageRecord>;

const UsageKindTotal = z.object({
    kind: z.string(),
    records: count,
    total: UsageCounters,
    recent: UsageCounters,
    expired: UsageCounters,
    overflow: UsageCounters,
});

const UsageReport = z.object({
    now: count,
    settings: z.object({
        enabled: z.boolean(),
        maxRecords: count,
        windowSeconds: count,
        flushSeconds: count,
        retentionBase: count,
        retentionPerUnit: count,
        retentionMax: count,
        trustedProxies: z.string().array(),
    }),
    totals: UsageKindTotal.array(),
    total: UsageCounters,
    order: z.string(),
    recent: z.boolean(),
    top: UsageRecord.array(),
});
export type UsageReportType = z.infer<typeof UsageReport>;

const UsageQuota = z.object({
    identity: z.string(),
    perWindow: UsageCounters,
});
export type UsageQuotaType = z.infer<typeof UsageQuota>;

export interface UsageReportOptions {
    kind?: string;
    order?: string;
    recent?: boolean;
    limit?: number;
}

const usageUrl = (path: string) => siblingUrl(null, "x-usage", path);

const adminOptions = async () => ({
    credentials: "include" as const,
    headers: await adminBearerAuthHeaders(),
});

export async function getUsageReport(
    options: UsageReportOptions = {},
): Promise<UsageReportType> {
    const params = new URLSearchParams();
    if (options.kind) params.set("kind", options.kind);
    if (options.order) params.set("order", options.order);
    if (options.recent) params.set("recent", "1");
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return UsageReport.parse(
        await getJson(
            usageUrl("/report" + (query ? "?" + query : "")),
            await adminOptions(),
        ),
    );
}

export async function getUsageQuotas(): Promise<UsageQuotaType[]> {
    return UsageQuota.array().parse(
        await getJson(usageUrl("/quotas"), await adminOptions()),
    );
}

// Limits per usage window; a limit of 0 is "no limit", and a quota whose
// limits are all 0 is removed. Stored only: nothing enforces a quota yet.
export async function setUsageQuota(
    identity: string,
    limits: Partial<UsageCountersType>,
): Promise<void> {
    const perWindow: Record<string, string> = {};
    for (const name of usageCounterNames) {
        perWindow[name] = String(limits[name] ?? 0);
    }
    await postJson(
        usageUrl("/quota"),
        { identity, perWindow },
        await adminOptions(),
    );
}
