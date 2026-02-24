import { Crown, User, Users } from "lucide-react";
import z from "zod";

import { FractalGuildIdentifier } from "@/components/fractal-guild-header-identifier";

import { useGuild } from "@/hooks/use-guild";
import { Guild } from "@/lib/graphql/fractals/getGuild";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { CardContent, CardFooter, CardHeader } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const zLeadership = z.enum(["RepAndCouncil", "RepOnly", "CouncilOnly"]);

const getLeadershipStatus = (
    guild?: Guild | null,
): z.infer<typeof zLeadership> | undefined => {
    if (guild == undefined || guild == null) return;
    if (guild.rep && guild.council) return zLeadership.Enum.RepAndCouncil;
    if (guild.rep) return zLeadership.Enum.RepOnly;
    if (guild.council) return zLeadership.Enum.CouncilOnly;
    throw new Error("Cannot determine leadership status");
};

export const GuildOverviewCard = ({
    guildAccount,
}: {
    guildAccount?: string;
}) => {
    const { data: guild, isPending, error } = useGuild(guildAccount);
    const leadershipStatus = getLeadershipStatus(guild);

    if (isPending) {
        return (
            <GlowingCard>
                <CardHeader>
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="mt-1 h-4 w-28" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="mt-2 h-4 w-full" />
                        <Skeleton className="mt-1 h-4 w-4/5" />
                    </div>
                    <div>
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="mt-2 h-4 w-full" />
                        <Skeleton className="mt-1 h-4 w-3/4" />
                    </div>
                </CardContent>
                <CardFooter className="flex items-center gap-2">
                    <Skeleton className="size-4 shrink-0 rounded" />
                    <Skeleton className="h-4 w-48" />
                </CardFooter>
            </GlowingCard>
        );
    }

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <GlowingCard>
            <CardHeader>
                <FractalGuildIdentifier
                    name={guild?.displayName}
                    account={guild?.account}
                />
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <h3 className="text-sm font-semibold">Description</h3>
                    <p className="text-sm leading-relaxed">
                        {guild?.bio || "No description available."}
                    </p>
                </div>
                <div>
                    <h3 className="text-sm font-semibold">Mission</h3>
                    <p className="text-sm leading-relaxed">
                        {guild?.description || "No mission available."}
                    </p>
                </div>
            </CardContent>
            <CardFooter className="flex items-center gap-2">
                {leadershipStatus == zLeadership.Enum.RepOnly && (
                    <Crown className="size-4 shrink-0" />
                )}
                {leadershipStatus == zLeadership.Enum.RepAndCouncil && (
                    <User className="size-4 shrink-0" />
                )}
                {leadershipStatus == zLeadership.Enum.CouncilOnly && (
                    <Users className="size-4 shrink-0" />
                )}
                <div className="text-muted-foreground text-sm">
                    {guild?.rep ? (
                        <>
                            Led by representative{" "}
                            <span className="text-primary font-medium">
                                {guild.rep.member}
                            </span>
                        </>
                    ) : (
                        "Led by council"
                    )}
                </div>
            </CardFooter>
        </GlowingCard>
    );
};
