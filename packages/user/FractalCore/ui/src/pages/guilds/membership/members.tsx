import type { Guild } from "@/lib/graphql/fractals/getGuild";
import type { Score } from "@/lib/graphql/fractals/getScores";

import dayjs from "dayjs";

import { useScores } from "@/hooks/fractals/use-scores";
import { useGuild } from "@/hooks/use-guild";

import { GlowingCard } from "@shared/components/glowing-card";
import { TableContact } from "@shared/components/tables/table-contact";
import { Badge } from "@shared/shadcn/ui/badge";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

function getGuildMemberRoleLabel(
    memberAccount: string,
    guild: Guild | null | undefined,
): "Representative" | "Councilor" | "Candidate" | null {
    if (!guild) return null;
    if (guild.rep?.member === memberAccount) return "Representative";
    if (guild.council?.includes(memberAccount)) return "Councilor";
    return null;
}

export const Members = () => {
    const { data: guild } = useGuild();
    const { data: scores } = useScores(guild?.account);

    const sortedScores = (scores || []).sort(
        (a, b) =>
            new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf(),
    );

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Guild members</CardTitle>
            </CardHeader>
            <CardContent className="@container">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead>Reputation</TableHead>
                            <TableHead className="text-end">
                                Member since
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedScores?.map((member: Score) => {
                            const roleLabel = getGuildMemberRoleLabel(
                                member.member,
                                guild,
                            );
                            return (
                                <TableRow key={member.member}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-row gap-2">
                                            <TableContact
                                                account={member.member}
                                            />
                                            {roleLabel != null && (
                                                <Badge variant="default">
                                                    {roleLabel}
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>{member.score}</TableCell>
                                    <TableCell className="text-end">
                                        {dayjs(member.createdAt).format(
                                            "MMMM D, YYYY",
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                    <TableCaption>
                        A list of all members in this guild.
                    </TableCaption>
                </Table>
            </CardContent>
        </GlowingCard>
    );
};
