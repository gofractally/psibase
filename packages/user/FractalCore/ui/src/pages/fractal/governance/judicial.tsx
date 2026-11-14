import { Gavel } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { AddLevyModal } from "@/components/modals/add-levy-modal";
import { ExileFractalMemberModal } from "@/components/modals/exile-fractal-member-modal";

import { useExile } from "@/hooks/fractals/use-exile";
import { useExiles } from "@/hooks/fractals/use-exiles";
import { useLevies } from "@/hooks/fractals/use-levies";
import { useRemoveLevy } from "@/hooks/fractals/use-levy";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useGuild } from "@/hooks/use-guild";

import { ErrorCard } from "@shared/components/error-card";
import { ppmToPercent } from "@shared/lib/percent-ppm";
import { formatRawAmount } from "@/lib/format-token";
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
import { useRoleGuild } from "@/hooks/use-role-guild";

export const Judicial = () => {
    const { data: fractal, error: fractalError } = useFractal();

    const roleId = fractal?.fractal?.judiciary.roleId;
    const { data: role, error: roleError } = useRoleGuild(roleId);

    const { data: guild, error: guildError } = useGuild(role?.guild);

    const [showExile, setShowExile] = useState(false);
    const [showLevy, setShowLevy] = useState(false);
    const fractalAccount = useFractalAccount();
    const {
        data: exiles,
        error: exilesError,
        isLoading: exilesLoading,
    } = useExiles(fractalAccount);
    const { mutateAsync: exileMember, isPending: isEnding } = useExile(true);
    const {
        data: levies,
        error: leviesError,
        isLoading: leviesLoading,
    } = useLevies(fractalAccount);
    const { mutateAsync: removeLevy, isPending: isRemoving } = useRemoveLevy();

    const { data: currentUser } = useCurrentUser();

    const isAdministrativeUser =
        currentUser == guild?.rep?.member ||
        (typeof currentUser == "string" &&
            guild?.council?.includes(currentUser));

    const error =
        fractalError || guildError || roleError || exilesError || leviesError;
    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <PageContainer className="space-y-6">
            <ExileFractalMemberModal
                openChange={setShowExile}
                show={showExile}
            />
            <AddLevyModal openChange={setShowLevy} show={showLevy} />
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
                            {guild?.account}
                        </span>{" "}
                        guild is selected to act as the judiciary led by{" "}
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
                                    onClick={() => setShowExile(true)}
                                >
                                    Exile member
                                </Button>
                            </ItemActions>
                        </Item>
                        <Item variant="muted">
                            <ItemContent>
                                <ItemTitle>Post a levy</ItemTitle>
                                <ItemDescription>
                                    Take a share of someone's claims. A debt of
                                    0 does not end.
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowLevy(true)}
                                >
                                    Post levy
                                </Button>
                            </ItemActions>
                        </Item>
                    </CardContent>
                </GlowingCard>
            )}

            <GlowingCard>
                <CardHeader>
                    <CardTitle>Levies</CardTitle>
                    <CardDescription>
                        Cuts taken from a claim before the rest is paid.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {leviesLoading ? null : levies?.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            No levies.
                        </p>
                    ) : (
                        (levies ?? []).map((levy) => (
                            <Item
                                key={`${levy.member}-${levy.id}`}
                                variant="muted"
                            >
                                <ItemContent>
                                    <ItemTitle>
                                        {levy.member} owes {levy.payee}
                                    </ItemTitle>
                                    <ItemDescription>
                                        {ppmToPercent(levy.ratePpm)}%.
                                        {levy.debt.value === "0"
                                            ? " Does not end."
                                            : ` Remaining ${formatRawAmount(levy.debt.value)}.`}
                                    </ItemDescription>
                                </ItemContent>
                                {isAdministrativeUser && (
                                    <ItemActions>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isRemoving}
                                            onClick={() =>
                                                removeLevy([
                                                    levy.member,
                                                    levy.id,
                                                ])
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </ItemActions>
                                )}
                            </Item>
                        ))
                    )}
                </CardContent>
            </GlowingCard>

            <GlowingCard>
                <CardHeader>
                    <CardTitle>Exiled</CardTitle>
                    <CardDescription>
                        Accounts the judiciary has banned from this fractal.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {exilesLoading ? null : exiles?.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            Nobody is exiled.
                        </p>
                    ) : (
                        (exiles ?? []).map((row) => (
                            <Item key={row.member} variant="muted">
                                <ItemContent>
                                    <ItemTitle>{row.member}</ItemTitle>
                                    <ItemDescription>
                                        Cannot be recruited until this is
                                        cleared.
                                    </ItemDescription>
                                </ItemContent>
                                {isAdministrativeUser && (
                                    <ItemActions>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isEnding}
                                            onClick={() =>
                                                exileMember([
                                                    row.member,
                                                    false,
                                                ])
                                            }
                                        >
                                            End exile
                                        </Button>
                                    </ItemActions>
                                )}
                            </Item>
                        ))
                    )}
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
