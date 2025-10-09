import dayjs from "dayjs";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembers } from "@/hooks/fractals/use-members";
import { getMemberLabel } from "@/lib/getMemberLabel";

import { cn } from "@shared/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const AllMembers = () => {
    const currentFractal = useFractalAccount();

    const { data: members } = useMembers(currentFractal);

    const sortedMembers = (members || []).sort(
        (a, b) =>
            new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf(),
    );

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">All members</h1>
            </div>
            <div className="mt-3">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created At</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedMembers?.map((member, index) => (
                            <TableRow
                                key={member.account}
                                className={cn({
                                    "bg-background/80": index < 6,
                                })}
                            >
                                <TableCell className="font-medium">
                                    {member.account}
                                </TableCell>
                                <TableCell>
                                    {getMemberLabel(member.memberStatus)}
                                </TableCell>
                                <TableCell>
                                    {dayjs(member.createdAt).format(
                                        "MMMM D, YYYY",
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
