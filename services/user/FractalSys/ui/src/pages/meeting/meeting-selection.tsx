import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import { Container } from "@toolbox/components/ui";
import { NavBar } from "components";
import { useMeetings, useUser } from "hooks";

import "./meeting.css";

dayjs.extend(relativeTime);

export const MeetingSelection = () => {
    const { user } = useUser();

    const { data, isLoading } = useMeetings(user && user.participantId);

    const meetings =
        data
            ?.map((meeting) => ({
                ...meeting,
                hasStarted: dayjs.unix(meeting.startTime).isBefore(dayjs()),
                hasEnded: dayjs.unix(meeting.endTime).isBefore(dayjs()),
                formattedStart: dayjs.unix(meeting.startTime).fromNow(),
            }))
            .map((meeting) => ({
                ...meeting,
                focusedGroupId:
                    meeting.roundOne.find((round) =>
                        round.members.includes(user?.participantId || "")
                    )?.id || "",
                isActive: meeting.hasStarted && !meeting.hasEnded,
            })) || [];
    console.log(data, "is the data..", meetings);

    const joinElection = (roomId: string) => {
        console.log("i should join room", roomId);
    };

    return (
        <>
            <NavBar title="Meeting" />
            <Container className="mx-auto space-y-4 bg-gray-100 md:max-w-md">
                <p className="text-base font-light italic">
                    {isLoading ? "Loading meetings.." : "Upcoming meetings.."}
                </p>
                <div>
                    {meetings.map((meeting) => (
                        <div
                            key={meeting.id}
                            className="flex justify-between my-4"
                        >
                            <div>{meeting.fractalName}</div>
                            <div>
                                {meeting.isActive ? (
                                    <button
                                        onClick={() =>
                                            joinElection(meeting.focusedGroupId)
                                        }
                                        className="bg-blue-500 p-3 hover:bg-blue-600 text-white rounded-lg"
                                    >
                                        Join Election
                                    </button>
                                ) : (
                                    <span>{meeting.formattedStart}</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </Container>
        </>
    );
};
