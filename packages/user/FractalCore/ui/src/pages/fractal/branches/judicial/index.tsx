import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Gavel } from "lucide-react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { ErrorCard } from "@/components/error-card";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useGuild } from "@/hooks/use-guild";
import { Button } from '@shared/shadcn/ui/button'
import { ExileFractalMemberModal } from "@/components/modals/exile-fractal-member-modal";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";



export const Judicial = () => {
    const { data: fractal, error: fractalError } = useFractal();

    const { data, error: guildError } = useGuild(fractal?.fractal?.judiciary.account)

    const [showModal, setShowModal] = useState(false);

    const { data: currentUser } = useCurrentUser();

    const isAdministrativeUser = currentUser == data?.rep?.member || (typeof currentUser == 'string' && data?.council?.includes(currentUser));

    const error = fractalError || guildError;
    if (error) {
        return <ErrorCard error={error} />
    }

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6 space-y-8">
            <ExileFractalMemberModal openChange={(show) => { setShowModal(show) }} show={showModal} />
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Gavel className="h-5 w-5" />
                        JUDICIARY
                    </CardTitle>
                    <CardDescription>Guardians of Integrity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div>
                        Powers
                    </div>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Exile members who violate the Fractal constition or bylaws.</li>
                        <li>Administer the arbitration system</li>
                        <li>Resolve disputes with finality</li>
                    </ul>
                    <p className="mt-3 text-muted-foreground">
                        <Gavel className="inline h-4 w-4 mr-1" />
                        The <span className="font-medium text-primary">{data?.account}</span> guild is selected to act as the judiciary lead by {data?.rep ? `its representative ${data.rep.member}.` : `its council.`}
                    </p>
                </CardContent>
            </Card>


            <GuildOverviewCard guildAccount={data?.account} />

            {isAdministrativeUser && <div className="border rounded-xl p-6">
                <div className="text-lg py-2">
                    Control Panel
                </div>
                <div>
                    <Button onClick={() => { setShowModal(true) }}>Exile member</Button>
                </div>
            </div>}
        </div>
    );
};