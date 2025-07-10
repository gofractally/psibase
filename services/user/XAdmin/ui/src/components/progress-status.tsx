import { Progress } from "@shared/shadcn/ui/progress";

import { type TransactionTrace, getActionStack } from "../lib/actionStack";
import { BootState, RequestUpdate, RequestUpdateSchema } from "../types";

const getStack = (trace: TransactionTrace) => {
    for (const atrace of trace.actionTraces) {
        const stack = getActionStack(atrace);
        if (stack) {
            return (
                <p>
                    {stack.map((act) => (
                        <>
                            {" "}
                            {`${act.sender} => ${act.service}::${act.method}`}{" "}
                            <br />
                        </>
                    ))}
                    {trace.error}
                </p>
            );
        }
    }
};

interface ProgressPageProps {
    state: BootState;
}

const isRequestingUpdate = (data: unknown): data is RequestUpdate =>
    RequestUpdateSchema.safeParse(data).success;

export const ProgressStatus = ({ state }: ProgressPageProps) => {
    if (state === undefined) {
        return <>Preparing to install</>;
    } else if (typeof state === "string") {
        return <>{state}</>;
    } else if ("actionTraces" in state) {
        return <>Boot failed: {getStack(state)}</>;
    } else if (isRequestingUpdate(state)) {
        const percent = Math.floor((state[1] / state[2]) * 100);
        return (
            <div>
                <Progress value={percent} />
                <div>
                    {state[0] == "fetch"
                        ? "Fetching packages"
                        : "Pushing transactions"}{" "}
                </div>
            </div>
        );
    } else {
        console.error(state);
        return <p>Unexpected boot state</p>;
    }
};
