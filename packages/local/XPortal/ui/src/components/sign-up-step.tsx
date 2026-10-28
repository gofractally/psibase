import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";

import { Loader } from "./loader";
import {
    formatTokenAmount,
    formatUsdCents,
    getSystemToken,
    systemTokenQueryKey,
    getTiers,
    PortalError,
    type SignupReceipt,
} from "../lib/portal-api";
import { startSignup } from "../lib/signup-request";

const FREE = "free";

export const SignUpStep = ({
    onRequested,
    onClosed,
    onFailed,
    onSignedOut,
}: {
    onRequested: (receipt: SignupReceipt) => void;
    /** The node stopped accepting requests. */
    onClosed: () => void;
    onFailed: () => void;
    onSignedOut: () => void;
}) => {
    const tiers = useQuery({ queryKey: ["tiers"], queryFn: getTiers });
    const systemToken = useQuery({
        queryKey: systemTokenQueryKey,
        queryFn: getSystemToken,
    });
    const [chosen, setChosen] = useState<string | null>(null);
    const [alreadyRequested, setAlreadyRequested] = useState(false);
    const { mutate: signUp, isPending } = useMutation({
        mutationFn: startSignup,
        onSuccess: onRequested,
        onError: (error) => {
            if (error instanceof PortalError) {
                if (error.status === 403) {
                    onClosed();
                    return;
                }
                if (error.status === 401) {
                    onSignedOut();
                    return;
                }
                if (
                    error.status === 409 &&
                    error.message === "free signup already exists"
                ) {
                    setAlreadyRequested(true);
                    return;
                }
            }
            console.error("Signup request failed:", error);
            onFailed();
        },
    });

    const grants = [
        ...(tiers.data?.free ? [tiers.data.free.tokens.value] : []),
        ...(tiers.data?.tiers.map((tier) => tier.tokens.value) ?? []),
    ];
    const token = systemToken.data;
    const unscaledGrant = !token && grants.some((grant) => grant !== "0");

    useEffect(() => {
        const error = tiers.error ?? systemToken.error;
        if (error || (systemToken.isSuccess && unscaledGrant)) {
            console.error("Loading tiers failed:", error ?? "system token is not set");
            onFailed();
        }
    }, [
        tiers.error,
        systemToken.error,
        systemToken.isSuccess,
        unscaledGrant,
        onFailed,
    ]);

    if (!tiers.data || systemToken.isPending || unscaledGrant) return <Loader />;

    const amount = (raw: string) =>
        token ? formatTokenAmount(raw, token) : raw;
    const options = [
        ...(tiers.data.free
            ? [
                  {
                      value: FREE,
                      label: "Free",
                      usdCents: 0,
                      tokens: amount(tiers.data.free.tokens.value),
                  },
              ]
            : []),
        ...tiers.data.tiers.map((tier) => ({
            value: String(tier.index),
            label: tier.label,
            usdCents: tier.usd_cents,
            tokens: amount(tier.tokens.value),
        })),
    ];
    const selected = chosen ?? options[0]?.value;

    return (
        <PageContainer className="space-y-6">
            <h2 className="text-lg font-medium">Choose an account</h2>
            {options.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No accounts are offered right now.
                </p>
            ) : (
                <RadioGroup
                    value={selected}
                    onValueChange={setChosen}
                    className="divide-y rounded-lg border"
                >
                    {options.map((option) => (
                        <Label
                            key={option.value}
                            htmlFor={`tier-${option.value}`}
                            className="flex cursor-pointer items-center gap-3 px-4 py-3 font-normal"
                        >
                            <RadioGroupItem
                                value={option.value}
                                id={`tier-${option.value}`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span>{option.label}</span>
                                <span className="text-muted-foreground text-sm">
                                    {option.tokens}
                                </span>
                            </span>
                            <span className="text-muted-foreground">
                                {formatUsdCents(option.usdCents)}
                            </span>
                        </Label>
                    ))}
                </RadioGroup>
            )}
            {alreadyRequested && (
                <p className="text-destructive text-sm">
                    This X account already has a free account.
                </p>
            )}
            <div className="flex justify-end">
                <Button
                    type="button"
                    disabled={isPending || !selected}
                    onClick={() =>
                        signUp(selected === FREE ? undefined : Number(selected))
                    }
                >
                    {isPending ? "Signing up..." : "Sign up"}
                </Button>
            </div>
        </PageContainer>
    );
};
