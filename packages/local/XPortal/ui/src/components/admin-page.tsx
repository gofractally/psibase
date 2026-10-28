import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CopyButton } from "@shared/components/copy-button";
import { PageContainer } from "@shared/components/page-container";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
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

import {
    type FailedSignup,
    type PortalStatus,
    createAdminAccounts,
    getAdminConfig,
    getFailedSignups,
    getPortalStatus,
    loadCreatorKey,
    putAdminConfig,
    putRequestsEnabled,
} from "../lib/admin-api";
import { PortalError, errorText } from "../lib/portal-api";
import { savedPricing } from "../lib/pricing";
import { AdminSection } from "./admin-section";
import { PricingSection } from "./admin-pricing";

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

const errorMessage = (error: unknown) =>
    error == null ? "Request failed" : errorText(error);

const conditionOk = (
    conditions: PortalStatus["conditions"],
    id: string,
) => conditions.find((condition) => condition.id === id)?.ok ?? false;

const billingReadinessRows = [
    {
        id: "creator_tokens",
        label: "ac-creator invite tokens",
        unmet: "ac-creator needs system tokens to pay for invites.",
    },
    {
        id: "creator_resources",
        label: "ac-creator resource buffer",
        unmet: "ac-creator needs resources bought for it. Sending tokens does not add resources.",
    },
] as const;

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
            {!ok && <p className="text-muted-foreground text-sm">{unmet}</p>}
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

type CredentialField = {
    key: string;
    label: string;
    /** The stored value; a secret's last four characters. */
    current: string | null | undefined;
    secret?: boolean;
};

const currentHint = ({ current, secret }: CredentialField) => {
    if (!current) return "Not set";
    return secret ? `••••${current}` : current;
};

/** Saves only the fields the admin filled in; blank fields keep their value. */
const CredentialsForm = ({
    fields,
    onSave,
}: {
    fields: CredentialField[];
    onSave: (values: Record<string, string>) => Promise<void>;
}) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const filled = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value.trim() !== ""),
    );
    const save = useMutation({
        mutationFn: onSave,
        onSuccess: () => setValues({}),
    });
    return (
        <form
            className="flex flex-col gap-4 rounded-lg border px-4 py-3"
            onSubmit={(event) => {
                event.preventDefault();
                save.mutate(filled);
            }}
        >
            {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <Input
                        id={field.key}
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        placeholder={currentHint(field)}
                        value={values[field.key] ?? ""}
                        onChange={(event) =>
                            setValues({
                                ...values,
                                [field.key]: event.target.value,
                            })
                        }
                    />
                </div>
            ))}
            {save.error && (
                <p className="text-destructive text-sm">
                    {errorText(save.error)}
                </p>
            )}
            <Button
                type="submit"
                className="self-start"
                disabled={
                    save.isPending || Object.keys(filled).length === 0
                }
            >
                Save
            </Button>
        </form>
    );
};

const FailedRequests = ({
    rows,
    error,
}: {
    rows: FailedSignup[] | undefined;
    error: unknown;
}) => (
    <AdminSection title="Failed requests">
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
                            <TableHead>Time</TableHead>
                            <TableHead>Tries</TableHead>
                            <TableHead>Error</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="whitespace-nowrap">
                                    {formatUtc(row.created)}
                                </TableCell>
                                <TableCell>{row.attempts}</TableCell>
                                <TableCell className="whitespace-pre-wrap break-words">
                                    {row.last_error}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    </AdminSection>
);

const currentPagePath = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

const AccountLogin = ({
    account,
    signedOutLabel = "Sign in",
    variant = "outline",
}: {
    account: string | null;
    signedOutLabel?: string;
    variant?: React.ComponentProps<typeof Button>["variant"];
}) => {
    const connect = useConnectAccount();
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                <p className="min-w-0 truncate text-sm">
                    {account ?? "Not signed in"}
                </p>
                <Button
                    type="button"
                    variant={variant}
                    disabled={connect.isPending}
                    onClick={() =>
                        connect.mutate({
                            enabled: true,
                            returnPath: currentPagePath(),
                        })
                    }
                >
                    {account ? "Switch account" : signedOutLabel}
                </Button>
            </div>
            {connect.error && (
                <p className="text-destructive text-sm">
                    {errorText(connect.error)}
                </p>
            )}
        </div>
    );
};

const SignIn = () => (
    <PageContainer className="space-y-6">
        <AdminSection title="Sign in">
            <AccountLogin
                account={null}
                signedOutLabel="Node admin? Sign in"
                variant="default"
            />
        </AdminSection>
    </PageContainer>
);

const AdminLoading = () => (
    <PageContainer className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
    </PageContainer>
);

const AdminError = ({ message }: { message: string }) => (
    <PageContainer>
        <p className="text-destructive text-sm">{message}</p>
    </PageContainer>
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
    const adminConfigReady = config.isSuccess;
    const creator = useQuery({
        queryKey: creatorKey,
        queryFn: loadCreatorKey,
        enabled: adminConfigReady,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const failed = useQuery({
        queryKey: failedSignupsKey,
        queryFn: getFailedSignups,
        enabled: adminConfigReady,
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
    const saveConfig = async (patch: Parameters<typeof putAdminConfig>[0]) => {
        await putAdminConfig(patch);
        void queryClient.invalidateQueries({ queryKey: portalStatusKey });
        await queryClient.invalidateQueries({ queryKey: adminConfigKey });
    };

    if (
        config.isPending ||
        status.isPending ||
        (adminConfigReady && creator.isPending)
    ) {
        return <AdminLoading />;
    }
    if (config.error instanceof PortalError && config.error.status === 401) {
        return <SignIn />;
    }
    if (config.error || !config.data || status.error || !status.data) {
        return (
            <AdminError message={errorMessage(config.error ?? status.error)} />
        );
    }
    if (creator.error || !creator.data) {
        return <AdminError message={errorMessage(creator.error)} />;
    }

    const enabled = requests.isPending
        ? requests.variables
        : config.data.requests_enabled;
    const isProducer = Boolean(
        config.data.account &&
        config.data.producer &&
        config.data.account === config.data.producer,
    );
    const conditions = status.data.conditions;
    const creatorReady = conditionOk(conditions, "creator_ready");
    const pubkey = creator.data.pubkey ?? config.data.creator_pubkey ?? null;
    const { x, stripe } = config.data;
    const pricing = savedPricing(config.data);
    const webhookUrl = `${window.location.origin}/stripe/webhook`;

    return (
        <PageContainer className="space-y-6">
            {!enabled && (
                <Alert variant="warning">
                    <AlertDescription variant="warning">
                        Account requests are disabled - No new user accounts can
                        be created by this node.
                    </AlertDescription>
                </Alert>
            )}

            <AdminSection title="Account">
                <AccountLogin account={config.data.account ?? null} />
            </AdminSection>

            <AdminSection title="Account requests">
                <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                    <div className="min-w-0">
                        <p className="text-muted-foreground text-sm">
                            Turning this off prevents users from creating new
                            accounts.
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
            </AdminSection>

            <AdminSection title="Readiness">
                <div className="divide-y rounded-lg border">
                    <ReadinessRow
                        label="Admin accounts created"
                        ok={creatorReady}
                        unmet="Create admin accounts below."
                    />
                    {status.data.billing_enabled &&
                        billingReadinessRows.map((row) => (
                            <ReadinessRow
                                key={row.id}
                                label={row.label}
                                ok={conditionOk(conditions, row.id)}
                                unmet={row.unmet}
                            />
                        ))}
                    <ReadinessRow
                        label="Sign in with X"
                        ok={conditionOk(conditions, "x_configured")}
                        unmet="Visitors can't sign up until the X credentials below are set."
                    />
                    <ReadinessRow
                        label="Stripe keys"
                        ok={conditionOk(conditions, "stripe_configured")}
                        unmet="Paid tiers can't be sold until the Stripe keys below are set."
                    />
                </div>
                {!status.data.billing_enabled && (
                    <p className="text-muted-foreground text-sm">
                        Billing is off. New accounts aren&apos;t funded.
                    </p>
                )}
            </AdminSection>

            {pricing && <PricingSection saved={pricing} onSave={saveConfig} />}

            <AdminSection title="Sign in with X">
                <div className="flex items-start gap-2 rounded-lg border px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground text-xs">
                            Callback URL, for the X developer portal redirect
                        </div>
                        <p className="break-all font-mono text-xs">
                            {config.data.x_callback_url}
                        </p>
                    </div>
                    <CopyButton
                        text={config.data.x_callback_url}
                        ariaLabel="Copy X OAuth callback URL"
                    />
                </div>
                <CredentialsForm
                    fields={[
                        {
                            key: "client_id",
                            label: "Client ID",
                            current: x.client_id,
                        },
                        {
                            key: "client_secret",
                            label: "Client secret",
                            current: x.client_secret,
                            secret: true,
                        },
                    ]}
                    onSave={(values) => saveConfig({ x: values })}
                />
            </AdminSection>

            <AdminSection title="Stripe (sandbox)">
                <div className="flex items-start gap-2 rounded-lg border px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground text-xs">
                            Webhook endpoint, for checkout.session.completed
                            and checkout.session.async_payment_succeeded
                        </div>
                        <p className="break-all font-mono text-xs">
                            {webhookUrl}
                        </p>
                    </div>
                    <CopyButton
                        text={webhookUrl}
                        ariaLabel="Copy Stripe webhook endpoint"
                    />
                </div>
                <CredentialsForm
                    fields={[
                        {
                            key: "publishable_key",
                            label: "Publishable key",
                            current: stripe.sandbox.publishable_key,
                        },
                        {
                            key: "secret_key",
                            label: "Secret key",
                            current: stripe.sandbox.secret_key,
                            secret: true,
                        },
                        {
                            key: "webhook_secret",
                            label: "Webhook signing secret",
                            current: stripe.sandbox.webhook_secret,
                            secret: true,
                        },
                    ]}
                    onSave={(values) =>
                        saveConfig({ stripe: { sandbox: values } })
                    }
                />
            </AdminSection>

            <AdminSection title="ac-creator">
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
                                !isProducer || create.isPending || !pubkey
                            }
                            onClick={() => {
                                if (pubkey && config.data.producer) {
                                    create.mutate({
                                        pubkeyPem: pubkey,
                                        owner: config.data.producer,
                                        allowed: config.data.creator_allowed,
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
            </AdminSection>

            <FailedRequests rows={failed.data} error={failed.error} />
        </PageContainer>
    );
};
