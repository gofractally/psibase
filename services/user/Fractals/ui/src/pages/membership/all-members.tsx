import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useMembers } from "@/hooks/useMembers";

export const AllMembers = () => {
    const { data: members, error } = useMembers(useCurrentFractal());

    console.log({ members, error });
    return (
        <div className="w-full max-w-screen-xl p-4">
            <h1 className="text-lg font-semibold">All Members</h1>
            <div className="border border-sm">
                {members?.map((member) => (
                    <div className="flex w-full justify-between" key={member.account}>
                        <div>{member.account}</div>
                        <div>{member.reputation}</div>
                        <div>{member.memberStatus}</div>
                        <div>{member.createdAt}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};
