import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { EmptyBlock } from "@/components/EmptyBlock";
import { CurrentEvaluationCard } from "@/components/current-evaluation-card";

import { useEvaluationInstance } from "@/hooks/fractals/useEvaluationInstance";
import { useFractal } from "@/hooks/fractals/useFractal";
import { useNextEvaluations } from "@/hooks/fractals/useNextEvaluations";

export const ActiveAndUpcoming = () => {
    const { data: fractal } = useFractal();

    const { evaluation, evaluationInstance } = useEvaluationInstance();

    const navigate = useNavigate();

    const nextSchedules = useNextEvaluations(
        evaluationInstance?.interval,
        evaluation?.registrationStarts,
    );

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <h1 className="mb-3 text-lg font-semibold">Active & upcoming</h1>
            {fractal && fractal.evaluations.length > 0 && (
                <CurrentEvaluationCard />
            )}
            {fractal?.evaluations.length == 0 ? (
                <EmptyBlock
                    title="No evaluations scheduled"
                    buttonLabel="Schedule evaluation"
                    onButtonClick={() => {
                        navigate("proposed?modal=true");
                    }}
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {nextSchedules?.map((date) => (
                            <TableRow key={date.getTime()}>
                                <TableCell>
                                    {dayjs(date).format("MMMM D, YYYY")}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
};
