import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { CurrentEvaluationCard } from "@/components/current-evaluation-card";
import { EmptyBlock } from "@/components/empty-block";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { useNextEvaluations } from "@/hooks/fractals/use-next-evaluations";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { useCurrentUser } from "@/hooks/use-current-user";
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

export const ActiveAndUpcoming = () => {
    const currentFractal = useCurrentFractal();
    const { data: currentUser } = useCurrentUser();
    const { data: fractal, isPending: isFractalPending } = useFractal();
    const { data: membership, isPending: isMembershipPending } = useMembership(
        currentFractal,
        currentUser,
    );

    const isCitizen = membership?.memberStatus === MemberStatus.Citizen;
    const hasEvaluations = fractal && fractal?.evaluations.length > 0;

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Active & upcoming</h1>
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
                        isCitizen={isCitizen}
                        isPending={isFractalPending || isMembershipPending}
                    />
                )}
            </div>
        </div>
    );
};

const EmptyState = ({
    isCitizen,
    isPending,
}: {
    isCitizen: boolean;
    isPending: boolean;
}) => {
    const navigate = useNavigate();

    if (isPending) {
        return <Skeleton className="h-[450px] w-full rounded-md" />;
    }

    if (isCitizen) {
        return (
            <EmptyBlock
                title="No evaluations scheduled"
                buttonLabel="Schedule evaluation"
                onButtonClick={() => {
                    navigate("proposed?modal=true");
                }}
            />
        );
    }

    return <EmptyBlock title="No evaluations scheduled" />;
};

const EvaluationsTable = () => {
    const { evaluation, evaluationInstance } = useEvaluationInstance();

    console.log("evaluation");
    console.log(evaluation);
    console.log("evaluationInstance");
    console.log(evaluationInstance);

    const nextSchedules = useNextEvaluations(
        evaluationInstance?.interval,
        evaluation?.registrationStarts,
    );

    console.log("nextSchedules");
    console.log(nextSchedules);

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
