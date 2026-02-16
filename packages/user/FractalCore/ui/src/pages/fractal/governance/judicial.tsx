import { Gavel } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { ExileFractalMemberModal } from "@/components/modals/exile-fractal-member-modal";

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

export const Judicial = () => {
    const { data: fractal, error: fractalError } = useFractal();

    const { data, error: guildError } = useGuild(
        fractal?.fractal?.judiciary.account,
    );

    const [showModal, setShowModal] = useState(false);

    const { data: currentUser } = useCurrentUser();

    const isAdministrativeUser =
        currentUser == data?.rep?.member ||
        (typeof currentUser == "string" &&
            data?.council?.includes(currentUser));

    const error = fractalError || guildError;
    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-4 px-6">
            <ExileFractalMemberModal
                openChange={setShowModal}
                show={showModal}
            />
            <GlowingCard>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Gavel className="size-5" />
                        JUDICIARY
                    </CardTitle>
                    <CardDescription>Guardians of Integrity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <h3 className="font-semibold">Powers</h3>
                    <ul className="ml-2 list-inside list-disc space-y-1">
                        <li>
                            Exile members who violate the Fractal constitution
                            or bylaws.
                        </li>
                        <li>Administer the arbitration system</li>
                        <li>Resolve disputes with finality</li>
                    </ul>
                </CardContent>
                <CardFooter className="flex items-center gap-2">
                    <Gavel className="size-4 shrink-0" />
                    <p className="text-muted-foreground text-sm">
                        The{" "}
                        <span className="text-primary font-medium">
                            {data?.account}
                        </span>{" "}
                        guild is selected to act as the judiciary led by{" "}
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
                        <Item variant="muted">
                            <ItemContent>
                                <ItemTitle>Exile member</ItemTitle>
                                <ItemDescription>
                                    Exile a member from the Fractal.
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowModal(true)}
                                >
                                    Exile member
                                </Button>
                            </ItemActions>
                        </Item>
                    </CardContent>
                </GlowingCard>
            )}
        </div>
    );
};
