import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { useCompletedEvaluation } from "@/hooks/fractals/use-completed-evaluations";
import { useGuild } from "@/hooks/use-guild";

import { EmptyBlock } from "@shared/components/empty-block";
import { PageContainer } from "@shared/domains/fractal/components/page-container";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const Completed = () => {
    const { data: guild } = useGuild();
    const { data: evaluations } = useCompletedEvaluation(guild?.account);

    const navigate = useNavigate();
    return (
        <PageContainer>
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Completed</h1>
            </div>
            <div className="mt-3">
                {evaluations?.length == 0 ? (
                    <EmptyBlock title="No completed evaluations" />
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
                                    onClick={() => {
                                        navigate(`${evaluation.evaluationId}`);
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
                    </Table>
                )}
            </div>
        </PageContainer>
    );
};
