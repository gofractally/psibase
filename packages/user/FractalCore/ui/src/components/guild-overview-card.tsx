import { Crown, User, Users } from "lucide-react";
import z from "zod";

import { useGuild } from "@/hooks/use-guild";
import { Guild } from "@/lib/graphql/fractals/getGuild";

import { Card, CardContent, CardHeader } from "@shared/shadcn/ui/card";

import { FractalGuildHeaderIdentifier } from "./fractal-guild-header-identifier";

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

    const leadershipStatus = getLeadershipStatus(guild);

    return (
        <Card>
            <CardHeader>
                <FractalGuildHeaderIdentifier
                    name={guild?.displayName}
                    account={guild?.account}
                />
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div className="flex justify-between px-2">
                        <div>
                            <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                                Description
                            </h3>
                            <p className="text-sm leading-relaxed">
                                {guild?.bio || "No description available."}
                            </p>
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
