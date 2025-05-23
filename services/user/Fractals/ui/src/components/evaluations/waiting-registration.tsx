import dayjs from "dayjs";

import { useFormatRelative } from "@/hooks/use-format-relative";
import { WaitingRegistration as WaitingRegistrationPhase } from "@/lib/getStatus";

export const WaitingRegistration = ({
    status,
}: {
    status: WaitingRegistrationPhase;
}) => {
    const { label } = useFormatRelative(status.registrationStart);
    const date = dayjs.unix(status.registrationStart).format("MMMM D HH:mm");

    return (
        <div>
            Next evaluation registration starts at {date} ({label}) ⏳
        </div>
    );
};
