import { BootState } from "@/types";
import { Progress } from "./ui/progress";

const getStack = (trace: TransactionTrace) => {
    for (let atrace of trace.actionTraces) {
        let stack = getActionStack(atrace);
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

export const ProgressStatus = ({ state }: ProgressPageProps) => {
    if (state === undefined) {
        return <>Preparing to install</>;
    } else if (typeof state === "string") {
        return <>{state}</>;
    } else if ("actionTraces" in state) {
        return <>Boot failed: {getStack(state)}</>;
    } else if (state[0] == "fetch" || state[0] == "push") {
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
