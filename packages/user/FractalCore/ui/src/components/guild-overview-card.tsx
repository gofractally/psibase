import { useGuild } from "@/hooks/use-guild";
import { useChainId } from "@shared/hooks/use-chain-id";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { createIdenticon } from "@shared/lib/create-identicon";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { User, Users, Crown } from "lucide-react";
import z from "zod";

const zLeadership = z.enum(['RepAndCouncil', 'RepOnly', 'CouncilOnly']);

export const GuildOverviewCard = ({ guildAccount }: { guildAccount?: string }) => {
    const { data: guild } = useGuild(guildAccount);
    const { data: chainId } = useChainId();

    const leadershipStatus = guild?.rep ? guild.council ? zLeadership.Enum.RepAndCouncil : zLeadership.Enum.RepOnly : zLeadership.Enum.CouncilOnly

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
                        <div className="flex items-center text-muted-foreground">
                            Lead by {guild?.rep ? `representative ${guild.rep.member}` : 'council'}
                            <div className="border rounded-sm text-primary">

                                {leadershipStatus == zLeadership.Enum.RepOnly && <Crown className="h-7 w-7" />}
                                {leadershipStatus == zLeadership.Enum.RepAndCouncil && <User className="h-7 w-7" />}
                                {leadershipStatus == zLeadership.Enum.CouncilOnly && <Users className="h-7 w-7" />}
                            </div>
                        </div>
                    </div>
                </div>

            </CardContent>

        </Card>
    );
};