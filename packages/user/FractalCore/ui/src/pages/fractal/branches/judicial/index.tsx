import { Gavel } from "lucide-react";
import { useState } from "react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { ExileFractalMemberModal } from "@/components/modals/exile-fractal-member-modal";

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
                openChange={(show) => {
                    setShowModal(show);
                }}
                show={showModal}
            />
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Gavel className="h-5 w-5" />
                        JUDICIARY
                    </CardTitle>
                    <CardDescription>Guardians of Integrity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div>Powers</div>
                    <ul className="ml-2 list-inside list-disc space-y-1">
                        <li>
                            Exile members who violate the Fractal constitution
                            or bylaws.
                        </li>
                        <li>Administer the arbitration system</li>
                        <li>Resolve disputes with finality</li>
                    </ul>
                    <p className="text-muted-foreground mt-3">
                        <Gavel className="mr-1 inline h-4 w-4" />
                        The{" "}
                        <span className="text-primary font-medium">
                            {data?.account}
                        </span>{" "}
                        guild is selected to act as the judiciary led by{" "}
                        {data?.rep
                            ? `its representative ${data.rep.member}.`
                            : `its council.`}
                    </p>
                </CardContent>
            </Card>

            <GuildOverviewCard guildAccount={data?.account} />

            {isAdministrativeUser && (
                <div className="rounded-xl border p-6">
                    <div className="py-2 text-lg">Control Panel</div>
                    <div>
                        <Button
                            onClick={() => {
                                setShowModal(true);
                            }}
                        >
                            Exile member
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
