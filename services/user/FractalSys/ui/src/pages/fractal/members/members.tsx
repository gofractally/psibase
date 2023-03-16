import { Avatar, Button } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import { useFractal } from "hooks/useParticipatingFractals";
import { useParams } from "react-router-dom";

dayjs.extend(relativeTime);
dayjs.extend(duration);

export const Members = () => {
  const { fractalID } = useParams();
  const { data } = useFractal(fractalID);

  const timeNow = dayjs();

  const generateInitialMember = () => {
    const secondsPassed = timeNow.unix() - dayjs(data.creationTime).unix();
    const memberDuration = dayjs.duration(secondsPassed, "seconds").humanize();
    return { username: data.founder, memberDuration, rank: "Founder" };
  };

  const parsedMembers = [generateInitialMember()];

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
        <div className="border-red-500 border-2 text-center italic">
          Members page doesn't actually work, this is just fetching the founder
          of a fractal and pretending its a "members of fractal" fetch
          request....
        </div>
        {parsedMembers.map((member) => (
          <div
            key={member.username}
            className="flex w-full justify-between rounded-lg bg-gray-200 p-2"
          >
            <div className="flex">
              {/* <Avatar
                                avatarUrl={member.avatar}
                                name={member.display_name}
                            /> */}
              <div className="flex flex-col justify-center font-black">
                {member.username}
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
