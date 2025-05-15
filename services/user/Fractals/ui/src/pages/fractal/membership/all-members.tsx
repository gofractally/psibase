import dayjs from "dayjs";

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { useMembers } from "@/hooks/fractals/useMembers";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { getMemberLabel } from "@/lib/getMemberLabel";
import { cn } from "@/lib/utils";

export const AllMembers = () => {
    const { data: members, error } = useMembers(useCurrentFractal());

    const sortedMembers = members?.slice();
    // .sort((a, b) => b.reputation - a.reputation);

    console.log({ members, error });
    return (
        <div className="w-full max-w-screen-xl p-4">
            <Table>
                <TableCaption>All Members</TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Reputation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created At</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedMembers?.map((member, index) => (
                        <TableRow
                            key={member.account}
                            className={cn({ "bg-background/80": index < 6 })}
                        >
                            <TableCell className="font-medium">
                                {member.account}
                            </TableCell>
                            <TableCell>{`member.reputation`}</TableCell>
                            <TableCell>
                                {getMemberLabel(member.memberStatus)}
                            </TableCell>
                            <TableCell>
                                {dayjs(member.createdAt).format("MMMM D, YYYY")}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};
