import dayjs from "dayjs";

import { CurrentEvaluationCard } from "@/components/current-evaluation-card";
import { EmptyBlock } from "@/components/empty-block";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useNextEvaluations } from "@/hooks/fractals/use-next-evaluations";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const ActiveAndUpcoming = () => {
    const { data: guild, isPending: isGuildPending } = useGuild();

    const { data: currentUser } = useCurrentUser();

    const isUpcomingEvaluation = !!guild?.evalInstance;

    const isAuthority = !!(
        guild &&
        currentUser &&
        (guild.rep?.member == currentUser ||
            guild.council.includes(currentUser))
    );
    console.log({ isAuthority });

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center justify-between">
                <h1 className="text-lg font-semibold">Active & upcoming</h1>
            </div>
            <div className="mt-3">
                {isUpcomingEvaluation && <CurrentEvaluationCard />}

                {isUpcomingEvaluation ? (
                    <EvaluationsTable />
                ) : (
                    <EmptyBlock
                        title="No scheduled evaluations"
                        isLoading={isGuildPending}
                    />
                )}
            </div>
        </div>
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
        </Table>
    );
};
