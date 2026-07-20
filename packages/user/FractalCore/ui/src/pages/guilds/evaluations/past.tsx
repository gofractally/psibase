import dayjs from "dayjs";
import { useNavigate, useParams } from "react-router-dom";

import { useCompletedEvaluation } from "@/hooks/fractals/use-completed-evaluations";
import { useGuild } from "@/hooks/use-guild";

import { EmptyBlock } from "@shared/components/empty-block";
import { GlowingCard } from "@shared/components/glowing-card";
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

export function PastEvaluations() {
    const { data: guild } = useGuild();
    const { data: evaluations, isPending } = useCompletedEvaluation(
        guild?.account,
    );
    const navigate = useNavigate();
    const { guildAccount } = useParams<{ guildAccount: string }>();

    const goToEvaluation = (evaluationId: number) => {
        if (!guildAccount) return;
        navigate(`/guild/${guildAccount}/evaluations/past/${evaluationId}`);
    };

    const isLoading = isPending && evaluations === undefined;
    const isEmpty = !isPending && (evaluations?.length ?? 0) === 0;

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Past evaluations</CardTitle>
            </CardHeader>
            <CardContent className="@container">
                {isLoading || isEmpty ? (
                    <EmptyBlock
                        title="No past evaluations"
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
                            A list of past evaluations for this guild. Select a
                            row to view results.
                        </TableCaption>
                    </Table>
                )}
            </CardContent>
        </GlowingCard>
    );
}
