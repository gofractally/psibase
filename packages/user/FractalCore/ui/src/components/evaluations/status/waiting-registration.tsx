import dayjs from "dayjs";

import { useFormatRelative } from "@/hooks/use-format-relative";
import { WaitingRegistration as WaitingRegistrationPhase } from "@/lib/get-status";

export const WaitingRegistration = ({
    status,
}: {
    status: WaitingRegistrationPhase;
}) => {
    const { label } = useFormatRelative(status.registrationStart);
    const date = dayjs
        .unix(status.registrationStart)
        .format("MMMM D [at] h:mm A z");

    return (
        <div>
            ⏳ Registration for the next evaluation opens {date} (in {label})
        </div>
    );
};
