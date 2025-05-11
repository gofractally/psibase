import { EmptyBlock } from "@/components/EmptyBlock";

export const Completed = () => {
    return (
        <div className="mx-auto w-full max-w-screen-lg p-4">
            <h1 className="text-lg font-semibold">Completed</h1>
            <EmptyBlock title="No completed evaluations" />
        </div>
    );
};
