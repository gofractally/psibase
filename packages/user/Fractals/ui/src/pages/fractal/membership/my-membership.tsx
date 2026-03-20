import type { FractalRes } from "@/lib/graphql/fractals/getFractal";

import { siblingUrl } from "@psibase/common-lib";

import { ErrorCard } from "@/components/error-card";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { createIdenticon } from "@/lib/createIdenticon";

import { useChainId } from "@shared/hooks/use-chain-id";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const MyMembership = () => {
    const fractalAccount = useCurrentFractal();

    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: errorFractal,
    } = useFractal(fractalAccount);

    const {
        data: chainId,
        isLoading: isLoadingChainId,
        error: errorChainId,
    } = useChainId();

    const isLoading = isLoadingFractal || isLoadingChainId;

    const error = errorFractal || errorChainId;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">My membership</h1>
            </div>
            <div className="mt-3 space-y-6">
                {isLoading || !chainId ? (
                    <>
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <FractalOverviewCard
                            fractal={fractal}
                            fractalAccount={fractalAccount}
                            chainId={chainId}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

const FractalOverviewCard = ({
    fractal,
    fractalAccount,
    chainId,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
    chainId: string;
}) => {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="flex w-full justify-between ">
                        <div>
                            <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-10 items-center justify-center rounded-lg border">
                                <img
                                    src={createIdenticon(
                                        chainId + fractalAccount,
                                    )}
                                    alt={`${fractal?.fractal?.name || "Fractal"} identicon`}
                                    className="size-5"
                                />
                            </div>
                            <div>
                                <div className="text-xl font-semibold">
                                    {fractal?.fractal?.name || "Loading..."}
                                </div>
                                <div className="text-muted-foreground text-sm font-normal">
                                    {fractalAccount}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <Button
                                onClick={() => {
                                    window.open(
                                        siblingUrl(null, fractalAccount),
                                    );
                                }}
                            >
                                Open
                            </Button>
                        </div>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div>
                        <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                            Mission
                        </h3>
                        <p className="text-sm leading-relaxed">
                            {fractal?.fractal?.mission ||
                                "No mission available"}
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
