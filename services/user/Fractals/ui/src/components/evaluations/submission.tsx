import dayjs from "dayjs";

import { useCloseEvaluation } from "@/hooks/fractals/use-close-evaluation";
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFormatRelative } from "@/hooks/use-format-relative";
import { SubmissionPhase } from "@/lib/getStatus";

import { Button } from "@shared/shadcn/ui/button";

export const Submission = ({ status }: { status: SubmissionPhase }) => {
    const { label } = useFormatRelative(status.submissionDeadline);
    const date = dayjs.unix(status.submissionDeadline).format("MMMM D HH:mm");

    const { evaluationInstance } = useEvaluationInstance();

    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    if (status.canCloseEarly) {
        return (
            <div>
                All groups have deliberated.{" "}
                <Button
                    onClick={() => {
                        closeEvaluation({
                            evaluationId: evaluationInstance!.evaluationId,
                        });
                    }}
                >
                    Close
                </Button>
            </div>
        );
    } else {
        return (
            <div>
                Evaluation closes at {date} ({label}) ⏳
            </div>
        );
    }
};
