import { Crown, User, Users } from "lucide-react";
import z from "zod";

import { useGuild } from "@/hooks/use-guild";
import { Guild } from "@/lib/graphql/fractals/getGuild";

import { useChainId } from "@shared/hooks/use-chain-id";
import { createIdenticon } from "@shared/lib/create-identicon";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
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
    const { data: guild } = useGuild(guildAccount);
    const { data: chainId } = useChainId();

    const leadershipStatus = getLeadershipStatus(guild);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-10 items-center justify-center rounded-lg border">
                        {chainId && guild?.account ? (
                            <img
                                src={createIdenticon(chainId + guild?.account)}
                                alt={guild?.displayName || "Guild"}
                                className="size-5"
                            />
                        ) : (
                            <Skeleton className="size-5 rounded-lg" />
                        )}
                    </div>
                    <div>
                        <div className="text-xl font-semibold">
                            {guild?.displayName || "Loading..."}
                        </div>
                        <div className="text-muted-foreground text-sm font-normal">
                            {guild?.bio}
                        </div>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div className="flex justify-between px-2">
                        <div>
                            <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                                Mission
                            </h3>
                            <p className="text-sm leading-relaxed">
                                {guild?.description || "No mission available."}
                            </p>
                        </div>
                        <div className="text-muted-foreground flex items-center">
                            Led by{" "}
                            {guild?.rep
                                ? `representative ${guild.rep.member}`
                                : "council"}
                            <div className="text-primary rounded-sm border">
                                {leadershipStatus ==
                                    zLeadership.Enum.RepOnly && (
                                    <Crown className="h-7 w-7" />
                                )}
                                {leadershipStatus ==
                                    zLeadership.Enum.RepAndCouncil && (
                                    <User className="h-7 w-7" />
                                )}
                                {leadershipStatus ==
                                    zLeadership.Enum.CouncilOnly && (
                                    <Users className="h-7 w-7" />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
