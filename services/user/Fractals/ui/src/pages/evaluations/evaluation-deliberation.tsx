import { useParams } from "react-router-dom";

// import { useFractal } from "@/hooks/fractals/useFractal";
import { useGroupUsers } from "@/hooks/fractals/useGroupUsers";

export const EvaluationDeliberation = () => {
    // const { data: fractal } = useFractal();

    const { evaluationId, fractalName, groupNumber } = useParams<{
        groupNumber: string;
        evaluationId: string;
        fractalName: string;
    }>();

    console.log({ evaluationId, fractalName, groupNumber });

    const { data: groupUsers, error } = useGroupUsers(
        Number(evaluationId),
        Number(groupNumber),
    );

    console.log({ groupUsers, error });
    return (
        <div>
            EvaluationDeliberation page here... {JSON.stringify(groupUsers)}
        </div>
    );
};
