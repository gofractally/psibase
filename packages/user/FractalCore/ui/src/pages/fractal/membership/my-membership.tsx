import type { FractalRes } from "@/lib/graphql/fractals/getFractal";
import type { Membership } from "@/lib/graphql/fractals/getMembership";

import dayjs from "dayjs";
import humanizeDuration from "humanize-duration";
import { Loader2, Plus } from "lucide-react";

import { useDistToken } from "@/hooks/fractals/use-dist-token";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useJoinFractal } from "@/hooks/fractals/use-join-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { getMemberLabel } from "@/lib/getMemberLabel";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import { createIdenticon } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const humanize = (ms: number) =>
    humanizeDuration(ms, {
        units: ["w", "d", "h", "m", "s"],
        largest: 3,
        round: true,
    });

export const MyMembership = () => {
    const fractalAccount = useFractalAccount();

    const {
        data: currentUser,
        isLoading: isLoadingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: errorFractal,
    } = useFractal();

    const {
        data: membership,
        isLoading: isLoadingMembership,
        error: errorMembership,
    } = useMembership(fractalAccount, currentUser);

    const {
        data: chainId,
        isLoading: isLoadingChainId,
        error: errorChainId,
    } = useChainId();

    const isLoading =
        isLoadingCurrentUser ||
        isLoadingFractal ||
        isLoadingMembership ||
        isLoadingChainId;

    const error =
        errorCurrentUser || errorFractal || errorMembership || errorChainId;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <div className="mt-3 space-y-6">
                {isLoading || !chainId ? (
                    <>
                        <Skeleton className="h-48 w-full rounded-xl" />
                        <Skeleton className="h-48 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <FractalOverviewCard
                            fractal={fractal}
                            fractalAccount={fractalAccount}
                            chainId={chainId}
                            membership={membership}
                        />
                        <ConsensusRewardStatusCard />
                        {membership == null && (
                            <JoinFractalCard fractalAccount={fractalAccount} />
                        )}
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
    membership,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
    chainId: string;
    membership?: Membership;
}) => {
    const isMember = membership != null;
    const status = !isMember
        ? "Not a member"
        : membership
          ? getMemberLabel(membership.memberStatus)
          : "Loading...";

    return (
        <GlowingCard>
            <CardHeader className="flex items-center gap-2">
                <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-12 items-center justify-center rounded-lg border">
                    <img
                        src={createIdenticon(chainId + fractalAccount)}
                        alt={`${fractal?.fractal?.name || "Fractal"} identicon`}
                        className="size-3/5"
                    />
                </div>
                <div className="flex-1">
                    <div className="text-xl font-semibold leading-tight">
                        {fractal?.fractal?.name || "Loading..."}
                    </div>
                    <div className="text-muted-foreground text-sm font-normal leading-tight">
                        {fractalAccount}
                    </div>
                </div>
                <Badge
                    variant={isMember ? "default" : "destructive"}
                    className={cn({
                        "bg-destructive/10 text-destructive border-destructive/20":
                            !isMember,
                    })}
                >
                    {status}
                </Badge>
            </CardHeader>
            <CardContent className="space-y-1">
                <h3 className="text-muted-foreground text-sm font-medium">
                    Mission
                </h3>
                <p className="text-sm leading-relaxed">
                    {fractal?.fractal?.mission ?? "No mission available"}
                </p>
            </CardContent>
            <CardFooter className="justify-end">
                <div className="text-muted-foreground text-xs font-normal italic">
                    Member since{" "}
                    {dayjs(membership?.createdAt).format("MMMM D, YYYY")}
                </div>
            </CardFooter>
        </GlowingCard>
    );
};

const ConsensusRewardStatusCard = () => {
    const { data: fractal, isLoading } = useFractal();
    const now = useNowUnix();

    const { mutateAsync: distributeToken, isPending: isDistributing } =
        useDistToken();

    if (isLoading) return null;
    if (!fractal?.fractal?.consensusReward) return null;

    const intervalPeriod = humanize(
        fractal.fractal.consensusReward.stream.distIntervalSecs * 1000,
    );
    const nextPeriod = fractal.fractal.consensusReward.stream.lastDistributed;

    const nextClaimTime = dayjs(nextPeriod).add(
        fractal.fractal.consensusReward.stream.distIntervalSecs,
        "seconds",
    );
    const isClaimTime = nextClaimTime.unix() < now;

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Consensus Rewards</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                            Reward distribution interval
                        </span>
                        <span className="text-muted-foreground text-sm">
                            Every {intervalPeriod}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                            Next distribution
                        </span>
                        <span className="text-muted-foreground text-sm">
                            {isClaimTime ? (
                                <Button
                                    disabled={isDistributing}
                                    onClick={() => {
                                        distributeToken([]);
                                    }}
                                >
                                    Claim now
                                </Button>
                            ) : (
                                `${nextClaimTime.format(
                                    "MMMM D, YYYY [at] h:mm A z",
                                )} (${humanize(nextClaimTime.diff(dayjs()))})`
                            )}
                        </span>
                    </div>
                </div>
            </CardContent>
        </GlowingCard>
    );
};

const JoinFractalCard = ({ fractalAccount }: { fractalAccount?: string }) => {
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
