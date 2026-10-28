import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import {
    type AdminConfig,
    type AdminSignup,
    adminSignupsKey,
    getAdminSignups,
    retrySignup,
} from "../lib/admin-api";
import { errorText } from "../lib/portal-api";
import { AdminSection } from "./admin-section";

const utcTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

const formatUtc = (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return `${utcTime.format(parsed)} UTC`;
};

/** Free tier, or the paid tier's label. A removed tier has no label left. */
const tierLabel = (
    tier: number | null | undefined,
    tiers: AdminConfig["tiers"],
) => {
    if (tier == null) return "Free";
    return tiers[tier]?.label ?? "Paid";
};

/**
 * Dashboard search for this Checkout Session. Object ids open the object,
 * and test-mode sessions live under `/test/`.
 * https://docs.stripe.com/dashboard/search
 */
const stripeSessionUrl = (
    sessionId: string,
    mode: AdminConfig["mode"],
) => {
    const prefix = mode === "sandbox" ? "test/" : "";
    return `https://dashboard.stripe.com/${prefix}search?query=${encodeURIComponent(sessionId)}`;
};

const byNewest = (rows: AdminSignup[]) =>
    [...rows].sort((a, b) => b.created.localeCompare(a.created));

const ListMessage = ({
    error,
    empty,
    rows,
    pending,
}: {
    error: unknown;
    empty: string;
    rows: AdminSignup[] | undefined;
    pending?: boolean;
}) => {
    if (pending) {
        return (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                Loading…
            </p>
        );
    }
    if (error) {
        return (
            <p className="text-destructive px-4 py-6 text-sm">
                {errorText(error)}
            </p>
        );
    }
    if (!rows || rows.length === 0) {
        return (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                {empty}
            </p>
        );
    }
    return null;
};

export const RequestLists = ({
    tiers,
    mode,
}: {
    tiers: AdminConfig["tiers"];
    mode: AdminConfig["mode"];
}) => {
    const queryClient = useQueryClient();
    const invited = useQuery({
        queryKey: [...adminSignupsKey, "invited"],
        queryFn: () => getAdminSignups("invited"),
        retry: false,
    });
    const redeemed = useQuery({
        queryKey: [...adminSignupsKey, "redeemed"],
        queryFn: () => getAdminSignups("redeemed"),
        retry: false,
    });
    const failed = useQuery({
        queryKey: [...adminSignupsKey, "failed"],
        queryFn: () => getAdminSignups("failed"),
        retry: false,
    });
    const retry = useMutation({
        mutationFn: retrySignup,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: adminSignupsKey });
        },
    });

    const successfulPending = invited.isPending || redeemed.isPending;
    const successfulError = invited.error ?? redeemed.error;
    const successful =
        successfulPending || successfulError
            ? undefined
            : byNewest([...(invited.data ?? []), ...(redeemed.data ?? [])]);

    return (
        <>
            <AdminSection title="Successful requests">
                <div className="rounded-lg border">
                    <ListMessage
                        error={successfulError}
                        empty="No successful requests."
                        rows={successful}
                        pending={successfulPending && !successfulError}
                    />
                    {successful && successful.length > 0 && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Handle</TableHead>
                                    <TableHead>Account</TableHead>
                                    <TableHead>Tier</TableHead>
                                    <TableHead>State</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {successful.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="whitespace-nowrap">
                                            {formatUtc(row.created)}
                                        </TableCell>
                                        <TableCell>{row.handle}</TableCell>
                                        <TableCell>{row.account ?? ""}</TableCell>
                                        <TableCell>
                                            {tierLabel(row.tier, tiers)}
                                        </TableCell>
                                        <TableCell>{row.state}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </AdminSection>

            <AdminSection title="Requests needing attention">
                <div className="rounded-lg border">
                    <ListMessage
                        error={failed.error}
                        empty="No requests needing attention."
                        rows={failed.data}
                        pending={failed.isPending && !failed.error}
                    />
                    {failed.data && failed.data.length > 0 && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Handle</TableHead>
                                    <TableHead>Tier</TableHead>
                                    <TableHead>Tries</TableHead>
                                    <TableHead>Error</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {failed.data.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="whitespace-nowrap">
                                            {formatUtc(row.created)}
                                        </TableCell>
                                        <TableCell>{row.handle}</TableCell>
                                        <TableCell>
                                            {tierLabel(row.tier, tiers)}
                                        </TableCell>
                                        <TableCell>{row.attempts}</TableCell>
                                        <TableCell className="whitespace-pre-wrap break-words">
                                            {row.last_error}
                                        </TableCell>
                                        <TableCell className="space-x-3 whitespace-nowrap text-right">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={retry.isPending}
                                                onClick={() => retry.mutate(row.id)}
                                            >
                                                Retry
                                            </Button>
                                            {row.stripe_session_id && (
                                                <a
                                                    className="text-sm underline"
                                                    href={stripeSessionUrl(
                                                        row.stripe_session_id,
                                                        mode,
                                                    )}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    Stripe
                                                </a>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {retry.error && (
                        <p className="text-destructive px-4 py-3 text-sm">
                            {errorText(retry.error)}
                        </p>
                    )}
                </div>
            </AdminSection>
        </>
    );
};
