import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { useApplyReturn } from "@/hooks/fractals/use-apply-return";
import { useJoinFractal } from "@/hooks/fractals/use-join-fractal";
import { getExile } from "@/lib/graphql/fractals/get-exile";
import QueryKey from "@/lib/query-keys";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent } from "@shared/shadcn/ui/card";
import { Spinner } from "@shared/shadcn/ui/spinner";

export const JoinFractalCard = ({
    fractalAccount,
}: {
    fractalAccount?: string;
}) => {
    const { data: currentUser } = useCurrentUser();
    const { data: exiled } = useQuery({
        queryKey: QueryKey.exile(fractalAccount, currentUser),
        enabled: Boolean(fractalAccount && currentUser),
        queryFn: () => getExile(fractalAccount!, currentUser!),
    });
    const { mutateAsync: joinFractal, isPending, error } = useJoinFractal();
    const { mutateAsync: applyReturn, isPending: isApplying } =
        useApplyReturn();

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <GlowingCard cardClassName="border-dashed">
            <CardContent>
                <div className="flex flex-col items-center space-y-4 text-center">
                    <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
                        <Plus className="text-muted-foreground h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold">
                            {exiled ? "Return to fractal" : "Join fractal"}
                        </h3>
                        <p className="text-muted-foreground mt-1 text-sm">
                            {exiled
                                ? "The judiciary decides when you can come back."
                                : "Become a member of this fractal."}
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            if (exiled) {
                                applyReturn([fractalAccount!]);
                            } else {
                                joinFractal({
                                    fractal: fractalAccount!,
                                });
                            }
                        }}
                        size="lg"
                        disabled={!fractalAccount || isPending || isApplying}
                        className="w-full sm:w-auto"
                    >
                        {(isPending || isApplying) && (
                            <Spinner data-icon="inline-start" />
                        )}
                        {exiled ? "Apply to return" : "Join"}
                    </Button>
                </div>
            </CardContent>
        </GlowingCard>
    );
};
