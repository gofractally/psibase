import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/empty-block";

import { useCompletedEvaluation } from "@/hooks/fractals/use-completed-evaluations";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import { useGuildBySlug } from "@/hooks/use-guild-slug-status";
import { useGuildSlug } from "@/hooks/use-guild-id";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

export const Completed = () => {
    const guildSlug = useGuildSlug();
    const fractalAccount = useFractalAccount();
    const { data: guild } = useGuildBySlug(fractalAccount, guildSlug);
    const { data: evaluations } = useCompletedEvaluation(guild?.id);

    const navigate = useNavigate();
    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
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
        </div>
    );
};
