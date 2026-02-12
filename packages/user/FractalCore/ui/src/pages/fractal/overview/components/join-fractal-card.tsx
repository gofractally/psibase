import { Loader2, Plus } from "lucide-react";

import { useJoinFractal } from "@/hooks/fractals/use-join-fractal";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent } from "@shared/shadcn/ui/card";

export const JoinFractalCard = ({
    fractalAccount,
}: {
    fractalAccount?: string;
}) => {
    const { mutateAsync: joinFractal, isPending, error } = useJoinFractal();

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
                        <h3 className="text-lg font-semibold">Apply to Join</h3>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Create an application to join this fractal.
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            joinFractal({
                                fractal: fractalAccount!,
                            });
                        }}
                        size="lg"
                        disabled={!fractalAccount || isPending}
                        className="w-full sm:w-auto"
                    >
                        {isPending && <Loader2 className="animate-spin" />}
                        Apply
                    </Button>
                </div>
            </CardContent>
        </GlowingCard>
    );
};
