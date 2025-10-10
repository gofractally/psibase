import dayjs from "dayjs";

import { useScores } from "@/hooks/fractals/use-scores";
import { useGuild } from "@/hooks/use-guild";

import { cn } from "@shared/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

const formatScore = (num: number): string => {
    // Would it be neat to make the score a flat integer out of 100?
    return Math.floor((num / 6) * 100).toString();
};

export const AllGuildMembers = () => {
    const { data: guild } = useGuild();
    const { data: scores } = useScores(guild?.account);

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Guild members</h1>
            </div>
            <div className="mt-3">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead>Reputation</TableHead>
                            <TableHead>Member since</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {scores?.map((member, index) => (
                            <TableRow
                                key={member.member}
                                className={cn({
                                    "bg-background/80": index < 6,
                                })}
                            >
                                <TableCell className="font-medium">
                                    {member.member}
                                </TableCell>
                                <TableCell>
                                    {formatScore(member.score)}
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
