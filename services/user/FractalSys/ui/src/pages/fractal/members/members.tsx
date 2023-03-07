import { useParams } from "react-router-dom";

import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";

import { Avatar, Button } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useFractal } from "hooks/useParticipatingFractals";

dayjs.extend(relativeTime);
dayjs.extend(duration);

export const Members = () => {
    const { fractalID } = useParams();
    const { data } = useFractal(fractalID);

    const timeNow = dayjs();

    const parsedMembers =
        data?.members.map((member) => {
            const secondsPassed = timeNow.unix() - Number(member.join_date);
            const memberDuration = dayjs
                .duration(secondsPassed, "seconds")
                .humanize();
            return { ...member, memberDuration };
        }) || [];

    return (
        <Con title="Members">
            <div className="space-y-2">
                <div className="space-x-4">
                    <Button size="xs" href="../join" type="primary">
                        Temp Join Link
                    </Button>
                    <Button size="xs" href="invite" type="primary">
                        Invite
                    </Button>
                </div>
                {parsedMembers.map((member) => (
                    <div
                        key={member.username}
                        className="flex w-full justify-between rounded-lg bg-gray-200 p-2"
                    >
                        <div className="flex ">
                            <Avatar
                                avatarUrl={member.avatar}
                                name={member.display_name}
                            />
                            <div className="flex flex-col justify-center font-black">
                                {member.display_name}
                            </div>
                        </div>
                        <div className="flex gap-10">
                            <div>{member.memberDuration}</div>
                            <div>{member.rank}</div>
                        </div>
                    </div>
                ))}
            </div>
        </Con>
    );
};
