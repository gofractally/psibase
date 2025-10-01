import dayjs from "dayjs";
import { useState } from "react";

import { CurrentEvaluationCard } from "@/components/current-evaluation-card";
import { EmptyBlock } from "@/components/empty-block";
import { ScheduleDialog } from "@/components/schedule-dialog";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { useNextEvaluations } from "@/hooks/fractals/use-next-evaluations";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/use-now-unix";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import { useGuildSlug } from "@/hooks/use-guild-id";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

export const ActiveAndUpcoming = () => {
    const currentFractal = useFractalAccount();
    const guildId = useGuildSlug();

    const { data: currentUser } = useCurrentUser();
    const { data, isPending: isFractalPending } = useFractal();
    const { data: membership, isPending: isMembershipPending } = useMembership(
        currentFractal,
        currentUser,
    );

    const now = useNowUnix();
    const status = useEvaluationStatus(now, guildId);

    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const isCitizen = membership?.memberStatus === MemberStatus.Citizen;
    const hasEvaluations = data && data?.guilds.nodes.length > 0;
    const isCouncilMember = Boolean(
        data?.fractal?.council.includes(currentUser ?? ""),
    );

    console.log({ isCouncilMember })

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center justify-between">
                <h1 className="text-lg font-semibold">Active & upcoming</h1>
                {isCouncilMember && (
                    <ScheduleDialog
                        isOpen={isScheduleDialogOpen}
                        setIsOpen={setIsScheduleDialogOpen}
                        disabled={
                            status?.type &&
                            status?.type !== "waitingRegistration"
                        }
                    />
                )}
            </div>
            <div className="mt-3">
                {isFractalPending ||
                    (isMembershipPending && (
                        <Skeleton className="mb-4 h-16 w-full rounded-md" />
                    ))}
                {hasEvaluations && isCitizen && <CurrentEvaluationCard />}
                {hasEvaluations ? (
                    <EvaluationsTable />
                ) : (
                    <EmptyState
                        canSchedule={isCouncilMember}
                        isPending={isFractalPending || isMembershipPending}
                        onScheduleClick={() => {
                            setIsScheduleDialogOpen(true);
                        }}
                    />
                )}
            </div>
        </div>
    );
};

const EmptyState = ({
    canSchedule,
    isPending,
    onScheduleClick,
}: {
    canSchedule: boolean;
    isPending: boolean;
    onScheduleClick: () => void;
}) => {
    if (isPending) {
        return <Skeleton className="h-[450px] w-full rounded-md" />;
    }

    if (canSchedule) {
        return (
            <EmptyBlock
                title="No evaluations scheduled"
                buttonLabel="Schedule evaluation"
                onButtonClick={onScheduleClick}
            />
        );
    }

    return <EmptyBlock title="No evaluations scheduled" />;
};

const EvaluationsTable = () => {
    const { evaluation, guild } = useEvaluationInstance(useGuildSlug());

    const nextSchedules = useNextEvaluations(
        guild?.evalInstance?.evaluationId,
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
