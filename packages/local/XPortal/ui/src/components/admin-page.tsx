import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { siblingUrl } from "@psibase/common-lib";

import { GlowingCard } from "@shared/components/glowing-card";
import { NetworkLogo } from "@shared/components/network-logo";
import { CopyButton } from "@shared/components/copy-button";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { PortalCard } from "./portal-card";
import {
    createAdminAccounts,
    getAdminConfig,
    getFailedSignups,
    getPortalStatus,
    loadCreatorKey,
    putRequestsEnabled,
    type FailedSignup,
} from "../lib/admin-api";
import { PortalError } from "../lib/portal-api";

const adminConfigKey = ["admin-config"];
const portalStatusKey = ["portal-status"];
const failedSignupsKey = ["admin-failed-signups"];
const creatorKey = ["admin-creator-key"];

const formatUtc = (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())} UTC`;
};

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const ReadinessRow = ({
    label,
    ok,
    unmet,
}: {
    label: string;
    ok: boolean;
    unmet: string;
}) => (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
            <div className="text-sm">{label}</div>
            {!ok && (
                <p className="text-muted-foreground text-sm">{unmet}</p>
            )}
        </div>
        <span
            className={
                ok
                    ? "text-muted-foreground text-sm"
                    : "text-destructive text-sm"
            }
        >
            {ok ? "OK" : "Unmet"}
        </span>
    </div>
);

const FailedRequests = ({
    rows,
    error,
}: {
    rows: FailedSignup[] | undefined;
    error: unknown;
}) => (
    <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Failed requests</h2>
        <div className="rounded-lg border">
            {error ? (
                <p className="text-destructive px-4 py-6 text-sm">
                    {errorText(error)}
                </p>
            ) : !rows || rows.length === 0 ? (
                <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                    No failed requests.
                </p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Tries</TableHead>
                            <TableHead>Error</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>{row.name}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                    {formatUtc(row.created)}
                                </TableCell>
                                <TableCell>{row.attempts}</TableCell>
                                <TableCell className="break-words whitespace-pre-wrap">
                                    {row.last_error}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    </section>
);

const SignIn = () => {
    const connect = useConnectAccount();
    return (
        <div className="flex min-h-dvh w-full items-center justify-center p-4">
            <div className="w-full min-w-0">
                <PortalCard>
                    <CardContent className="flex flex-col gap-6">
                        <CardTitle className="text-3xl font-normal">
                            Sign in
                        </CardTitle>
                        <Button
                            type="button"
                            className="self-start"
                            disabled={connect.isPending}
                            onClick={() => connect.mutate()}
                        >
                            Node admin? Sign in
                        </Button>
                        {connect.error && (
                            <p className="text-destructive text-sm">
                                {errorText(connect.error)}
                            </p>
                        )}
                    </CardContent>
                </PortalCard>
            </div>
        </div>
    );
};

const AdminLoading = () => (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
    </div>
);

export const AdminPage = () => {
    const queryClient = useQueryClient();
    const config = useQuery({
        queryKey: adminConfigKey,
        queryFn: getAdminConfig,
        retry: false,
    });
    const status = useQuery({
        queryKey: portalStatusKey,
        queryFn: getPortalStatus,
    });
    const authenticated = config.isSuccess;
    const creator = useQuery({
        queryKey: creatorKey,
        queryFn: loadCreatorKey,
        enabled: authenticated,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const failed = useQuery({
        queryKey: failedSignupsKey,
        queryFn: getFailedSignups,
        enabled: authenticated,
        retry: false,
    });
    const requests = useMutation({
        mutationFn: putRequestsEnabled,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: adminConfigKey });
            void queryClient.invalidateQueries({ queryKey: portalStatusKey });
        },
    });
    const create = useMutation({
        mutationFn: createAdminAccounts,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: creatorKey });
            void queryClient.invalidateQueries({ queryKey: adminConfigKey });
            void queryClient.invalidateQueries({ queryKey: portalStatusKey });
        },
    });

    if (
        config.isPending ||
        status.isPending ||
        (authenticated && creator.isPending)
    ) {
        return <AdminLoading />;
    }
    if (config.error instanceof PortalError && config.error.status === 401) {
        return <SignIn />;
    }
    if (config.error || !config.data || status.error || !status.data) {
        return (
            <div className="flex min-h-dvh w-full items-center justify-center p-4">
                <p className="text-destructive text-sm">
                    {errorText(config.error ?? status.error)}
                </p>
            </div>
        );
    }
    if (creator.error || !creator.data) {
        return (
            <div className="flex min-h-dvh w-full items-center justify-center p-4">
                <p className="text-destructive text-sm">
                    {errorText(creator.error)}
                </p>
            </div>
        );
    }

    const enabled = requests.isPending
        ? requests.variables
        : config.data.requests_enabled;
    const isProducer = Boolean(
        config.data.account &&
            config.data.producer &&
            config.data.account === config.data.producer,
    );
    const creatorReady =
        status.data.conditions.find((condition) => condition.id === "creator_ready")
            ?.ok ?? false;
    const creatorFunded =
        status.data.conditions.find(
            (condition) => condition.id === "creator_funded",
        )?.ok ?? false;
    const pubkey = creator.data.pubkey ?? config.data.creator_pubkey ?? null;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            {!enabled && (
                <Alert variant="warning">
                    <AlertDescription variant="warning">
                        Account requests are disabled - No new user accounts
                        can be created by this node.
                    </AlertDescription>
                </Alert>
            )}
            <GlowingCard>
                <CardHeader className="-ml-2 -mt-2">
                    <NetworkLogo
                        onClick={() => {
                            window.top!.location.href = siblingUrl();
                        }}
                    />
                </CardHeader>
                <CardContent className="flex flex-col gap-8">
                    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-sm font-medium">
                                Account requests
                            </div>
                            <p className="text-muted-foreground text-sm">
                                Turning this off prevents users from creating
                                new accounts.
                            </p>
                            {requests.error && (
                                <p className="text-destructive mt-1 text-sm">
                                    {errorText(requests.error)}
                                </p>
                            )}
                        </div>
                        <Switch
                            checked={enabled}
                            disabled={requests.isPending}
                            onCheckedChange={(next) => requests.mutate(next)}
                            aria-label="Account requests"
                        />
                    </div>

                    <section className="flex flex-col gap-2">
                        <h2 className="text-sm font-medium">Readiness</h2>
                        <div className="divide-y rounded-lg border">
                            <ReadinessRow
                                label="Admin accounts created"
                                ok={creatorReady}
                                unmet="Create admin accounts below."
                            />
                            {status.data.billing_enabled && (
                                <ReadinessRow
                                    label="ac-creator funded"
                                    ok={creatorFunded}
                                    unmet="Needs funds."
                                />
                            )}
                        </div>
                        {!status.data.billing_enabled && (
                            <p className="text-muted-foreground text-sm">
                                Billing is off. New accounts aren&apos;t
                                funded.
                            </p>
                        )}
                    </section>

                    <section className="flex flex-col gap-2">
                        <h2 className="text-sm font-medium">ac-creator</h2>
                        <div className="flex flex-col gap-4 rounded-lg border px-4 py-3">
                            {pubkey && (
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-muted-foreground text-xs">
                                            Public key
                                        </div>
                                        <p className="whitespace-pre-wrap font-mono text-xs">
                                            {pubkey}
                                        </p>
                                    </div>
                                    <CopyButton
                                        text={pubkey}
                                        ariaLabel="Copy ac-creator public key"
                                    />
                                </div>
                            )}
                            {!creator.data.accountExists && (
                                <Button
                                    type="button"
                                    className="self-start"
                                    disabled={
                                        !isProducer ||
                                        create.isPending ||
                                        !pubkey
                                    }
                                    onClick={() => {
                                        if (
                                            pubkey &&
                                            config.data.producer
                                        ) {
                                            create.mutate({
                                                pubkeyPem: pubkey,
                                                owner: config.data.producer,
                                                allowed: config.data
                                                    .creator_allowed,
                                            });
                                        }
                                    }}
                                >
                                    Create admin accounts
                                </Button>
                            )}
                            {create.error && (
                                <p className="text-destructive text-sm">
                                    {errorText(create.error)}
                                </p>
                            )}
                        </div>
                    </section>

                    <FailedRequests
                        rows={failed.data}
                        error={failed.error}
                    />
                </CardContent>
            </GlowingCard>
        </div>
    );
};
