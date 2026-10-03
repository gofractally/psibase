import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useCandidates } from "@/hooks/use-candidates";
import { useRegResProvider } from "@/hooks/use-reg-res-provider";
import { useResourceProviders } from "@/hooks/use-resource-providers";
import { useUnregResProvider } from "@/hooks/use-unreg-res-provider";

import { PageContainer } from "@shared/components/page-container";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { getProducers } from "@shared/lib/get-producers";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

const parseAccepted = (raw: string): string[] =>
    raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

export const ResourceProviders = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: candidates, isLoading: candidatesLoading } = useCandidates();
    const { data: providers, isLoading: providersLoading } =
        useResourceProviders();
    const { data: producerAccounts, isLoading: producersLoading } = useQuery({
        queryKey: ["producers", "names"],
        queryFn: async () => {
            const producers = await getProducers();
            return producers.map((producer) => producer.name);
        },
    });

    const { mutateAsync: regResProvider, isPending: isRegistering } =
        useRegResProvider();
    const { mutateAsync: unregResProvider, isPending: isUnregistering } =
        useUnregResProvider();

    const candidate = useMemo(
        () => candidates?.find((row) => row.account === currentUser),
        [candidates, currentUser],
    );
    const isActiveProducer = Boolean(
        currentUser && producerAccounts?.includes(currentUser),
    );
    const existing = useMemo(
        () => providers?.find((row) => row.producer === currentUser),
        [providers, currentUser],
    );

    const [app, setApp] = useState("");
    const [accepted, setAccepted] = useState("");

    useEffect(() => {
        if (existing) {
            setApp(existing.app);
            setAccepted(existing.accepted.join(", "));
        }
    }, [existing]);

    const isLoading =
        candidatesLoading || providersLoading || producersLoading;

    // Same gates as the disabled inputs — keep reason and canSubmit in lockstep.
    const submitBlockReason = !currentUser
        ? "Log in as a producer to register."
        : !isActiveProducer
          ? "Only active producers can register. Unregister remains available if you previously registered."
          : !candidate?.endpoint
            ? "Register as a block-production candidate with a non-empty endpoint first (Block production)."
            : null;

    const canSubmit =
        !submitBlockReason && !isRegistering && !isUnregistering;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const acceptedList = parseAccepted(accepted);
        await regResProvider([app.trim(), acceptedList]);
    };

    const handleUnregister = async () => {
        await unregResProvider([]);
        setApp("");
        setAccepted("");
    };

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Resource providers</h2>
                <p className="text-muted-foreground text-sm">
                    Register this producer&apos;s payment portal so users can
                    purchase resources.
                </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading...</p>
                ) : (
                    <>
                        {submitBlockReason && (
                            <p className="text-sm text-amber-700 dark:text-amber-400">
                                Registration is disabled: {submitBlockReason}
                            </p>
                        )}
                        {existing && (
                            <p className="text-sm">
                                Currently registered:{" "}
                                <span className="font-medium">
                                    {existing.app}
                                </span>{" "}
                                ({existing.accepted.join(", ")})
                            </p>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="resource-provider-app">
                                    Payment app account
                                </Label>
                                <Input
                                    id="resource-provider-app"
                                    value={app}
                                    onChange={(event) =>
                                        setApp(event.target.value)
                                    }
                                    placeholder="x-portal"
                                    disabled={!canSubmit}
                                />
                                <p className="text-muted-foreground text-xs">
                                    Must be a valid account name starting with
                                    x-.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="resource-provider-accepted">
                                    Accepted currencies
                                </Label>
                                <Input
                                    id="resource-provider-accepted"
                                    value={accepted}
                                    onChange={(event) =>
                                        setAccepted(event.target.value)
                                    }
                                    placeholder="USD, EUR"
                                    disabled={!canSubmit}
                                />
                                <p className="text-muted-foreground text-xs">
                                    Comma-separated list. Values are free-form.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="submit"
                                    disabled={
                                        !canSubmit ||
                                        !app.trim() ||
                                        parseAccepted(accepted).length === 0
                                    }
                                >
                                    {existing ? "Update" : "Register"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        !currentUser ||
                                        isRegistering ||
                                        isUnregistering
                                    }
                                    onClick={handleUnregister}
                                >
                                    Unregister
                                </Button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </PageContainer>
    );
};
