import dayjs from "dayjs";

import { useMembers } from "@/hooks/fractals/use-members";
import { useScores } from "@/hooks/fractals/use-scores";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { getMemberLabel } from "@/lib/getMemberLabel";
import { EvalType } from "@/lib/zod/EvaluationType";

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

export const AllMembers = () => {
    const currentFractal = useCurrentFractal();

    const { data: members } = useMembers(currentFractal);
    const { data: scores } = useScores();

    const sortedMembers = (members || [])
        .map((member) => {
            const score = scores?.find(
                (score) =>
                    score.account == member.account &&
                    score.evalType == EvalType.Reputation,
            );
            return {
                ...member,
                score: score ? score.value : 0,
            };
        })
        .sort((a, b) => b.score - a.score);

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
                            <TableHead>Reputation</TableHead>
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
                                    {formatScore(member.score)}
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
