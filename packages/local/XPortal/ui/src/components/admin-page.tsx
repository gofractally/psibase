import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import { CopyButton } from "@shared/components/copy-button";
import { PageContainer } from "@shared/components/page-container";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";

import {
    type AdminConfig,
    type StripeKeys,
    type PortalStatus,
    adminConfigKey,
    adminSignupsKey,
    agentsKey,
    getAdminConfig,
    portalStatusKey,
    getAgents,
    getPortalStatus,
    loadCreatorKey,
    putAdminConfig,
    putRequestsEnabled,
} from "../lib/admin-api";
import {
    PortalError,
    errorText,
    getSystemToken,
    systemTokenQueryKey,
} from "../lib/portal-api";
import { savedPricing } from "../lib/pricing";
import { CreatorCard } from "./admin-creator";
import { AdminSection } from "./admin-section";
import { PricingSection } from "./admin-pricing";
import { RequestLists } from "./admin-requests";

const creatorKey = ["admin-creator-key"];

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
    idPrefix = "",
    fields,
    onSave,
}: {
    idPrefix?: string;
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
            {fields.map((field) => {
                const inputId = `${idPrefix}${field.key}`;
                return (
                    <div key={field.key} className="flex flex-col gap-1.5">
                        <Label htmlFor={inputId}>{field.label}</Label>
                        <Input
                            id={inputId}
                            type={field.secret ? "password" : "text"}
                            autoComplete="off"
                            placeholder={currentHint(field)}
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                                setValues((prev) => ({
                                    ...prev,
                                    [field.key]: event.target.value,
                                }))
                            }
                        />
                    </div>
                );
            })}
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

const stripeCredentialFields = (keys: StripeKeys): CredentialField[] => [
    {
        key: "publishable_key",
        label: "Publishable key",
        current: keys.publishable_key,
    },
    {
        key: "secret_key",
        label: "Secret key",
        current: keys.secret_key,
        secret: true,
    },
    {
        key: "webhook_secret",
        label: "Webhook signing secret",
        current: keys.webhook_secret,
        secret: true,
    },
];

const StripeModeToggle = ({
    mode,
    onSave,
}: {
    mode: AdminConfig["mode"];
    onSave: (mode: AdminConfig["mode"]) => Promise<void>;
}) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const save = useMutation({ mutationFn: onSave });
    const displayed = save.isPending && save.variables ? save.variables : mode;
    const choose = (next: AdminConfig["mode"]) => {
        if (next === displayed || save.isPending) return;
        if (next === "production") {
            setConfirmOpen(true);
            return;
        }
        save.mutate(next);
    };
    return (
        <>
            <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                <div className="min-w-0">
                    <p className="text-sm">Stripe mode</p>
                    <p className="text-muted-foreground text-sm">
                        Sandbox until you switch. Production charges real
                        cards.
                    </p>
                    {save.error && (
                        <p className="text-destructive mt-1 text-sm">
                            {errorText(save.error)}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span
                        className={
                            displayed === "sandbox"
                                ? "text-sm"
                                : "text-muted-foreground text-sm"
                        }
                    >
                        Sandbox
                    </span>
                    <Switch
                        checked={displayed === "production"}
                        disabled={save.isPending}
                        onCheckedChange={(on) =>
                            choose(on ? "production" : "sandbox")
                        }
                        aria-label="Production Stripe mode"
                    />
                    <span
                        className={
                            displayed === "production"
                                ? "text-sm"
                                : "text-muted-foreground text-sm"
                        }
                    >
                        Production
                    </span>
                </div>
            </div>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Switch to production?
                        </AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogDescription>
                        New checkouts will use the production Stripe keys and
                        charge real cards. A checkout started in sandbox still
                        completes.
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => save.mutate("production")}
                        >
                            Switch to production
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

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
    const agents = useQuery({
        queryKey: agentsKey,
        queryFn: getAgents,
        enabled: adminConfigReady,
        retry: false,
    });
    const accountMissing =
        agents.error instanceof PortalError && agents.error.status === 404;
    const creator = useQuery({
        queryKey: creatorKey,
        queryFn: loadCreatorKey,
        enabled: adminConfigReady && accountMissing,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const token = useQuery({
        queryKey: systemTokenQueryKey,
        queryFn: getSystemToken,
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
    const saveConfig = async (patch: Parameters<typeof putAdminConfig>[0]) => {
        await putAdminConfig(patch);
        void queryClient.invalidateQueries({ queryKey: portalStatusKey });
        await queryClient.invalidateQueries({ queryKey: adminConfigKey });
    };

    if (
        config.isPending ||
        status.isPending ||
        (adminConfigReady && agents.isPending) ||
        (accountMissing && creator.isPending)
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
    if (agents.error && !accountMissing) {
        return <AdminError message={errorMessage(agents.error)} />;
    }
    if (accountMissing && (creator.error || !creator.data)) {
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
    const pubkey =
        agents.data?.pubkey_pem ??
        creator.data?.pubkey ??
        config.data.creator_pubkey ??
        null;
    const { x, stripe } = config.data;
    const pricing = savedPricing(config.data);
    const webhookUrl = `${window.location.origin}/stripe/webhook`;
    const saveStripeKeys =
        (mode: AdminConfig["mode"]) => (values: Record<string, string>) =>
            saveConfig({ stripe: { [mode]: values } });

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
                        unmet="Paid tiers can't be sold until this mode's Stripe keys are set."
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

            <AdminSection title="Stripe">
                <StripeModeToggle
                    mode={config.data.mode}
                    onSave={async (mode) => {
                        await saveConfig({ mode });
                        await queryClient.invalidateQueries({
                            queryKey: adminSignupsKey,
                        });
                    }}
                />
                <div className="flex items-start gap-2 rounded-lg border px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground text-xs">
                            Webhook endpoint for both modes, for
                            checkout.session.completed and
                            checkout.session.async_payment_succeeded
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
                {(
                    [
                        ["sandbox", "Sandbox keys"],
                        ["production", "Production keys"],
                    ] as const
                ).map(([mode, label]) => (
                    <Fragment key={mode}>
                        <p className="text-sm font-medium">{label}</p>
                        <CredentialsForm
                            idPrefix={`${mode}-`}
                            fields={stripeCredentialFields(stripe[mode])}
                            onSave={saveStripeKeys(mode)}
                        />
                    </Fragment>
                ))}
            </AdminSection>

            <CreatorCard
                agents={agents.data ?? null}
                pubkey={pubkey}
                isProducer={isProducer}
                producer={config.data.producer ?? null}
                allowed={config.data.creator_allowed}
                token={token.data ?? null}
            />

            <RequestLists tiers={config.data.tiers} mode={config.data.mode} />
        </PageContainer>
    );
};
