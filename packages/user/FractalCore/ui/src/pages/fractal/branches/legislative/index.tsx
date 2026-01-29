import { Scale } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { SetMinScorersModal } from "@/components/modals/set-min-scorers-modal";
import { SetRankedGuildSlots } from "@/components/modals/set-ranked-guild-slots-modal";
import { SetRankedGuilds } from "@/components/modals/set-ranked-guilds-modal";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";

import { ErrorCard } from "@shared/components/error-card";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

export const Legislative = () => {
    const { data: fractal, error: fractalError } = useFractal();

    const awaitingConsensusReward = !fractal?.fractal?.consensusReward;

    const focusedGuild = fractal?.fractal?.legislature.account;
    const { data, error: guildError } = useGuild(focusedGuild);

    const [showMinScorersModal, setShowMinScorers] = useState(false);
    const [showRankedGuildsModal, setShowRankedGuildsModal] = useState(false);
    const [showRankGuildsModal, setShowRankGuildsModal] = useState(false);

    const error = fractalError || guildError;

    const { data: currentUser } = useCurrentUser();

    const isAdministrativeUser =
        currentUser == data?.rep?.member ||
        (typeof currentUser == "string" &&
            data?.council?.includes(currentUser));

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-4 px-6">
            <SetMinScorersModal
                openChange={(e) => setShowMinScorers(e)}
                show={showMinScorersModal}
            />
            <SetRankedGuildSlots
                openChange={(e) => setShowRankedGuildsModal(e)}
                show={showRankedGuildsModal}
            />
            <SetRankedGuilds
                openChange={(e) => setShowRankGuildsModal(e)}
                show={showRankGuildsModal}
            />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Scale className="h-5 w-5" />
                        LEGISLATIVE
                    </CardTitle>
                    <CardDescription>
                        Architects of the Fractal’s Future
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div>Powers</div>
                    <ul className="ml-2 list-inside list-disc space-y-1">
                        <li>Guild ranking</li>
                        <li>Foreign guild subsidies</li>
                        <li>Immigration fees</li>
                        <li>Consensus reward intervals</li>
                        <li>All policy that shapes growth and incentives</li>
                    </ul>
                    <p className="text-muted-foreground mt-3">
                        <Scale className="mr-1 inline h-4 w-4" />
                        The{" "}
                        <span className="text-primary font-medium">
                            {data?.account}
                        </span>{" "}
                        guild is selected to act as the legislature led by{" "}
                        {data?.rep
                            ? `its representative ${data.rep.member}.`
                            : `its council.`}
                    </p>
                </CardContent>
            </Card>

            <GuildOverviewCard guildAccount={data?.account} />

            {isAdministrativeUser && (
                <div className="flex flex-col gap-2 rounded-xl border p-6">
                    <div className="py-2 text-lg">Control Panel</div>
                    {awaitingConsensusReward && (
                        <Item variant="outline">
                            <ItemContent>
                                <ItemTitle>Set minimum scorers</ItemTitle>
                                <ItemDescription>
                                    Set the minimum amount of users in an
                                    evaluation required to initialise the
                                    Fractal token and consensus rewards.
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowMinScorers(true)}
                                >
                                    Set minimum scorers
                                </Button>
                            </ItemActions>
                        </Item>
                    )}

                    {!awaitingConsensusReward && (
                        <>
                            <Item variant="outline">
                                <ItemContent>
                                    <ItemTitle>Set ranked guilds</ItemTitle>
                                    <ItemDescription>
                                        Rank guilds for consensus rewards.
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowMinScorers(true)}
                                    >
                                        Rank guilds
                                    </Button>
                                </ItemActions>
                            </Item>

                            <Item variant="outline">
                                <ItemContent>
                                    <ItemTitle>
                                        Set ranked guild slots
                                    </ItemTitle>
                                    <ItemDescription>
                                        Adjust how many guilds to pay consensus
                                        rewards.
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowMinScorers(true)}
                                    >
                                        Set ranked guild slots
                                    </Button>
                                </ItemActions>
                            </Item>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
