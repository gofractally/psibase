import { Scale } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { SetMinScorersModal } from "@/components/modals/set-min-scorers-modal";
import { SetRankedGuildSlots } from "@/components/modals/set-ranked-guild-slots-modal";
import { SetRankedGuilds } from "@/components/modals/set-ranked-guilds-modal";
import { PageContainer } from "@/components/page-container";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useGuild } from "@/hooks/use-guild";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardContent,
    CardDescription,
    CardFooter,
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
        <PageContainer className="space-y-6">
            <SetMinScorersModal
                openChange={setShowMinScorers}
                show={showMinScorersModal}
            />
            <SetRankedGuildSlots
                openChange={setShowRankedGuildsModal}
                show={showRankedGuildsModal}
            />
            <SetRankedGuilds
                openChange={setShowRankGuildsModal}
                show={showRankGuildsModal}
            />

            <GlowingCard>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Scale className="size-5" />
                        LEGISLATIVE
                    </CardTitle>
                    <CardDescription>
                        Architects of the Fractal&rsquo;s Future
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <h3 className="font-semibold">Powers</h3>
                    <ul className="ml-2 list-inside list-disc space-y-1">
                        <li>Guild ranking</li>
                        <li>Foreign guild subsidies</li>
                        <li>Immigration fees</li>
                        <li>Consensus reward intervals</li>
                        <li>All policy that shapes growth and incentives</li>
                    </ul>
                </CardContent>
                <CardFooter className="flex items-center gap-2">
                    <Scale className="size-4 shrink-0" />
                    <p className="text-muted-foreground text-sm">
                        The{" "}
                        <span className="text-primary font-medium">
                            {data?.account}
                        </span>{" "}
                        guild is selected to act as the legislature led by{" "}
                        {data?.rep ? (
                            <>
                                its representative{" "}
                                <span className="text-primary font-medium">
                                    {data.rep.member}
                                </span>
                                .
                            </>
                        ) : (
                            `its council.`
                        )}
                    </p>
                </CardFooter>
            </GlowingCard>

            <GuildOverviewCard guildAccount={data?.account} />

            {isAdministrativeUser && (
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>Control Panel</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {awaitingConsensusReward && (
                            <Item variant="muted">
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
                                <Item variant="muted">
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
                                            onClick={() =>
                                                setShowMinScorers(true)
                                            }
                                        >
                                            Rank guilds
                                        </Button>
                                    </ItemActions>
                                </Item>

                                <Item variant="muted">
                                    <ItemContent>
                                        <ItemTitle>
                                            Set ranked guild slots
                                        </ItemTitle>
                                        <ItemDescription>
                                            Adjust how many guilds to pay
                                            consensus rewards.
                                        </ItemDescription>
                                    </ItemContent>
                                    <ItemActions>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setShowMinScorers(true)
                                            }
                                        >
                                            Set ranked guild slots
                                        </Button>
                                    </ItemActions>
                                </Item>
                            </>
                        )}
                    </CardContent>
                </GlowingCard>
            )}
        </PageContainer>
    );
};
