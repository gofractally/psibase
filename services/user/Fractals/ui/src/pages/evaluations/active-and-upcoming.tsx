import { useFractal } from "@/hooks/useFractal";

export const ActiveAndUpcoming = () => {
    const { data: fractal, isLoading } = useFractal();
    console.log({ fractal });

    if (isLoading) return null;

    return (
        <div className="w-full max-w-screen-xl p-4">
            <h1 className="text-lg font-semibold">Active & upcoming</h1>
            {fractal?.evaluationInterval == null ? (
                <div>Fractal has not set an evaluation schedule.</div>
            ) : (
                <div> Display the evaluation data</div>
            )}
        </div>
    );
};
