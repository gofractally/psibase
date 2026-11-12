import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CopyButton } from "@shared/components/copy-button";
import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import {
    type Agent,
    type AllowedAction,
    activateCreatorKey,
    adminConfigKey,
    agentsKey,
    createAdminAccounts,
    formatDecimal,
    portalStatusKey,
    resourceTopUp,
    sendCreatorResources,
    sendCreatorTokens,
    setCreatorKey,
    stageCreatorKey,
} from "../lib/admin-api";
import { errorText, formatTokenAmount } from "../lib/portal-api";
import { AdminSection } from "./admin-section";

const Balance = ({ label, value }: { label: string; value: string }) => (
    <div>
        <div className="text-muted-foreground text-xs">{label}</div>
        <p className="text-sm">{value}</p>
    </div>
);

export const CreatorCard = ({
    agents,
    pubkey,
    isProducer,
    producer,
    allowed,
    token,
}: {
    /** Set once `ac-creator` exists. */
    agents: Agent | null;
    pubkey: string | null;
    isProducer: boolean;
    producer: string | null;
    allowed: AllowedAction[];
    token: SystemTokenInfo | null;
}) => {
    const queryClient = useQueryClient();
    const [tokenAmount, setTokenAmount] = useState("");
    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: agentsKey });
        void queryClient.invalidateQueries({ queryKey: adminConfigKey });
        void queryClient.invalidateQueries({ queryKey: portalStatusKey });
    };
    const create = useMutation({
        mutationFn: createAdminAccounts,
        onSuccess: refresh,
    });
    const sendTokens = useMutation({
        mutationFn: sendCreatorTokens,
        onSuccess: () => {
            setTokenAmount("");
            refresh();
        },
    });
    const sendResources = useMutation({
        mutationFn: sendCreatorResources,
        onSuccess: refresh,
    });
    const rotate = useMutation({
        mutationFn: async () => {
            const pending = await stageCreatorKey();
            await setCreatorKey(pending);
            await activateCreatorKey();
        },
        onSuccess: refresh,
    });

    const show = (raw: string) =>
        token ? formatTokenAmount(raw, token) : raw;
    const topUp = agents
        ? resourceTopUp(
              agents.resource_balance.value,
              agents.std_buffer_cost.value,
          )
        : null;
    const resourceAmount =
        topUp != null && token
            ? formatDecimal(topUp, token.precision)
            : null;
    const tokenToSend = tokenAmount.trim();
    const actionError =
        create.error ?? sendTokens.error ?? sendResources.error ?? rotate.error;

    return (
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
                {agents && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
                        <Balance
                            label="Token balance"
                            value={show(agents.psi_balance.value)}
                        />
                        <Balance
                            label="Resource balance"
                            value={show(agents.resource_balance.value)}
                        />
                    </div>
                )}
                {agents ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                disabled={
                                    !resourceAmount || sendResources.isPending
                                }
                                onClick={() => {
                                    if (resourceAmount)
                                        sendResources.mutate(resourceAmount);
                                }}
                            >
                                Send resources
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!isProducer || rotate.isPending}
                                onClick={() => rotate.mutate()}
                            >
                                Rotate key
                            </Button>
                        </div>
                        <form
                            className="flex flex-col gap-2 sm:flex-row sm:items-end"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (tokenToSend) sendTokens.mutate(tokenToSend);
                            }}
                        >
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="creator-token-amount">
                                    Token amount
                                </Label>
                                <Input
                                    id="creator-token-amount"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={tokenAmount}
                                    onChange={(event) =>
                                        setTokenAmount(event.target.value)
                                    }
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={
                                    !tokenToSend || sendTokens.isPending
                                }
                            >
                                Send tokens
                            </Button>
                        </form>
                    </div>
                ) : (
                    <Button
                        type="button"
                        className="self-start"
                        disabled={!isProducer || create.isPending || !pubkey}
                        onClick={() => {
                            if (pubkey && producer) {
                                create.mutate({
                                    pubkeyPem: pubkey,
                                    owner: producer,
                                    allowed,
                                });
                            }
                        }}
                    >
                        Create admin accounts
                    </Button>
                )}
                {actionError && (
                    <p className="text-destructive text-sm">
                        {errorText(actionError)}
                    </p>
                )}
            </div>
        </AdminSection>
    );
};
