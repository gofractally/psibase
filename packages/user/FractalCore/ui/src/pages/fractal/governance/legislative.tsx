import { Scale } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { SetRankedGuilds } from "@/components/modals/set-ranked-guilds-modal";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useGuild } from "@/hooks/use-guild";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
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
import { InitTokenModal } from "@/components/modals/init-token-modal";

export const Legislative = () => {
    const { data: fractal, error: fractalError } = useFractal();

    const awaitingConsensusReward = !fractal?.fractal?.stream;

    const legislatureRoleAccount = fractal?.fractal?.legislature.account;
    const { data: guild, error: guildError } = useGuild(legislatureRoleAccount);

    const [showRankGuildsModal, setShowRankGuildsModal] = useState(false);
    const [showTokenModal, setShowTokenModal] = useState(false);

    const error = fractalError || guildError;

    const { data: currentUser } = useCurrentUser();

    console.log({ guild })

    const isAdministrativeUser =
        currentUser == guild?.rep?.member ||
        (typeof currentUser == "string" &&
            guild?.council?.includes(currentUser));


    console.log({ isAdministrativeUser, focusedGuild: legislatureRoleAccount, fractal })

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <PageContainer className="space-y-6">


            <SetRankedGuilds
                openChange={setShowRankGuildsModal}
                show={showRankGuildsModal}
            />
            <InitTokenModal
                openChange={setShowTokenModal}
                show={showTokenModal}
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
                            {guild?.account}
                        </span>{" "}
                        guild is selected to act as the legislature led by{" "}
                        {guild?.rep ? (
                            <>
                                its representative{" "}
                                <span className="text-primary font-medium">
                                    {guild.rep.member}
                                </span>
                                .
                            </>
                        ) : (
                            `its council.`
                        )}
                    </p>
                </CardFooter>
            </GlowingCard>

            <GuildOverviewCard guildAccount={guild?.account} />

            {isAdministrativeUser && (
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>Control Panel</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {awaitingConsensusReward && (
                            <Item variant="muted">
                                <ItemContent>
                                    <ItemTitle>Init token</ItemTitle>
                                    <ItemDescription>
                                        Mint the tokens supply and send to the fractal stream.
                                    </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowTokenModal(true)}
                                    >
                                        Initialise token
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
                                                setShowRankGuildsModal(true)
                                            }
                                        >
                                            Rank guilds
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
