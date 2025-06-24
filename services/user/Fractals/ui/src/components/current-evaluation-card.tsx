import { useWatchAttest } from "@/hooks/fractals/use-watch-attest";
import { useWatchClose } from "@/hooks/fractals/use-watch-close";
import { useWatchStart } from "@/hooks/fractals/use-watch-start";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/use-now-unix";

import { Deliberation } from "./evaluations/deliberation";
import { Failed } from "./evaluations/failed";
import { Register } from "./evaluations/register";
import { Start } from "./evaluations/start";
import { Submission } from "./evaluations/submission";
import { WaitingRegistration } from "./evaluations/waiting-registration";

export const CurrentEvaluationCard = () => {
    const now = useNowUnix();
    const status = useEvaluationStatus(now);

    useWatchStart(status);
    useWatchAttest(status);
    useWatchClose(status);

    return (
        <div className="w-full rounded-sm border p-4">
            {status?.type == "waitingRegistration" && (
                <WaitingRegistration status={status} />
            )}
            {status?.type == "failed" && <Failed />}
            {status?.type == "registration" && (
                <div>
                    ✍️
                    <Register status={status} />
                </div>
            )}
            {status?.type == "waitingStart" && (
                <div>
                    🕒
                    <Start status={status} />
                </div>
            )}
            {status?.type == "deliberation" && (
                <div>
                    📤
                    <Deliberation status={status} />
                </div>
            )}
            {status?.type == "submission" && <Submission status={status} />}
            {status?.type == "finished" && (
                <div>Evaluation finished! ✅ Awaiting to be closed</div>
            )}
        </div>
    );
};
