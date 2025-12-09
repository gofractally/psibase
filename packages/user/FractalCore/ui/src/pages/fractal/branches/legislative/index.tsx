import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Scale } from "lucide-react";

import { GuildOverviewCard } from "@/components/guild-overview-card";
import { ErrorCard } from "@/components/error-card";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useGuild } from "@/hooks/use-guild";

export const Legislative = () => {
    const { data: fractal, error } = useFractal();

    const { data } = useGuild(fractal?.fractal?.legislature.account)

    if (error) {
        return <ErrorCard error={error} />
    }

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Scale className="h-5 w-5" />
                        LEGISLATIVE
                    </CardTitle>
                    <CardDescription>Architects of the Fractal’s Future</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div>
                        Powers
                    </div>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Guild ranking</li>
                        <li>Foreign guild subsidies</li>
                        <li>Immigration fees</li>
                        <li>Consensus reward intervals</li>
                        <li>All policy that shapes growth and incentives</li>
                    </ul>
                    <p className="mt-3 text-muted-foreground">
                        <Scale className="inline h-4 w-4 mr-1" />
                        The <span className="font-medium text-primary">{data?.account}</span> guild is selected to act as the legislature lead by {data?.rep ? `its representative ${data.rep.member}.` : `its council.`}
                    </p>
                </CardContent>
            </Card>


            <GuildOverviewCard guildAccount={data?.account} />
        </div>
    );
};