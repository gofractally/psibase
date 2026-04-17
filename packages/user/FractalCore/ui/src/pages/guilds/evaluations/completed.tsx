import dayjs from "dayjs";
import { useLocation, useNavigate } from "react-router-dom";

import { useCompletedEvaluation } from "@/hooks/fractals/use-completed-evaluations";
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
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

type CompletedEvaluationsCardProps = {
    cardTitle?: string;
};

export function CompletedEvaluationsCard({
    cardTitle = "Completed evaluations",
}: CompletedEvaluationsCardProps) {
    const { data: guild } = useGuild();
    const { data: evaluations, isPending } = useCompletedEvaluation(
        guild?.account,
    );
    const navigate = useNavigate();
    const location = useLocation();

    const goToEvaluation = (evaluationId: number) => {
        const id = String(evaluationId);
        const path = location.pathname.replace(/\/$/, "");
        if (path.endsWith("/evaluations/completed")) {
            navigate(id);
        } else {
            navigate(`completed/${id}`);
        }
    };

    const isLoading = isPending && evaluations === undefined;
    const isEmpty = !isPending && (evaluations?.length ?? 0) === 0;

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>{cardTitle}</CardTitle>
            </CardHeader>
            <CardContent className="@container">
                {isLoading || isEmpty ? (
                    <EmptyBlock
                        title="No completed evaluations"
                        isLoading={isLoading}
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    Deliberation Date &amp; Time
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {evaluations?.map((evaluation) => (
                                <TableRow
                                    key={evaluation.evaluationId}
                                    onClick={() => {
                                        goToEvaluation(evaluation.evaluationId);
                                    }}
                                    className="cursor-pointer"
                                >
                                    <TableCell>
                                        {dayjs(evaluation.deliberation).format(
                                            "MMMM D, YYYY [at] h:mm A z",
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                        <TableFooter>
                            <TableRow>
                                <TableCell>
                                    {evaluations?.length ?? 0}{" "}
                                    {evaluations?.length === 1
                                        ? "evaluation"
                                        : "evaluations"}
                                </TableCell>
                            </TableRow>
                        </TableFooter>
                        <TableCaption>
                            A list of completed evaluations for this guild.
                            Select a row to view results.
                        </TableCaption>
                    </Table>
                )}
            </CardContent>
        </GlowingCard>
    );
}

export const Completed = () => {
    return (
        <PageContainer>
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Completed</h1>
            </div>
            <div className="mt-3">
                <CompletedEvaluationsCard />
            </div>
        </PageContainer>
    );
};
