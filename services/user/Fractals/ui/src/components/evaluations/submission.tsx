import dayjs from "dayjs";

import { useFormatRelative } from "@/hooks/use-format-relative";
import { SubmissionPhase } from "@/lib/getStatus";

export const Submission = ({ status }: { status: SubmissionPhase }) => {
    const { label } = useFormatRelative(status.submissionDeadline);
    const date = dayjs.unix(status.submissionDeadline).format("MMMM D HH:mm");

    return (
        <div>
            Evaluation closes at {date} ({label}) ⏳
        </div>
    );
};
