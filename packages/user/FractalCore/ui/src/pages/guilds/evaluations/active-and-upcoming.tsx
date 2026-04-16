import dayjs from "dayjs";

import { CurrentEvaluationCard } from "@/components/current-evaluation-card";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useNextEvaluations } from "@/hooks/fractals/use-next-evaluations";
import { useGuild } from "@/hooks/use-guild";

import { EmptyBlock } from "@shared/components/empty-block";
import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const ActiveAndUpcoming = () => {
    const { data: guild, isPending: isGuildPending } = useGuild();

    const isUpcomingEvaluation = !!guild?.evalInstance;

    return (
        <PageContainer className="space-y-6">
            {isUpcomingEvaluation && <CurrentEvaluationCard />}

            {isUpcomingEvaluation ? (
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>Active &amp; upcoming evaluations</CardTitle>
                    </CardHeader>
                    <CardContent className="@container">
                        <EvaluationsTable />
                    </CardContent>
                </GlowingCard>
            ) : (
                <EmptyBlock
                    title="No scheduled evaluations"
                    isLoading={isGuildPending}
                />
            )}
        </PageContainer>
    );
};

const EvaluationsTable = () => {
    const { evaluation, guild } = useEvaluationInstance();

    const nextSchedules = useNextEvaluations(
        guild?.evalInstance?.interval,
        evaluation?.registrationStarts,
    );

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Registration Opens</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {nextSchedules?.map((date) => (
                    <TableRow key={date.getTime()}>
                        <TableCell>
                            {dayjs(date).format("MMMM D, YYYY")}
                        </TableCell>
                        <TableCell>{dayjs(date).format("h:mm A z")}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableCaption>
                A list of all active and upcoming evaluations for this guild.
            </TableCaption>
        </Table>
    );
};
