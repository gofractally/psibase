import dayjs from "dayjs";
import humanizeDuration from "humanize-duration";

import { useDistToken } from "@/hooks/fractals/use-dist-token";
import { useFractal } from "@/hooks/fractals/use-fractal";

import { GlowingCard } from "@shared/components/glowing-card";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";

const humanize = (ms: number) =>
    humanizeDuration(ms, {
        units: ["w", "d", "h", "m", "s"],
        largest: 3,
        round: true,
    });

export const ConsensusRewardCard = () => {
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
