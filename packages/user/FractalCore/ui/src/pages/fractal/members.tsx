import dayjs from "dayjs";
import { Users } from "lucide-react";

import { PageContainer } from "@/components/page-container";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembers } from "@/hooks/fractals/use-members";
import { COUNCIL_SEATS } from "@/lib/constants";
import { getMemberLabel } from "@/lib/getMemberLabel";

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
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export const Members = () => {
    const currentFractal = useFractalAccount();

    const { data: members } = useMembers(currentFractal);

    const sortedMembers = (members || []).sort(
        (a, b) =>
            new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf(),
    );

    return (
        <PageContainer>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>All Members</CardTitle>
                </CardHeader>
                <CardContent className="@container">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-end">
                                    Created At
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedMembers?.map((member, index) => (
                                <TableRow key={member.account}>
                                    <TableCell className="font-medium">
                                        <TableContact
                                            account={member.account}
                                        />
                                    </TableCell>
                                    <TableCell className="flex items-center gap-2">
                                        {index < COUNCIL_SEATS && (
                                            <Tooltip>
                                                <TooltipTrigger className="block">
                                                    <Users className="size-4" />
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    This member is on the
                                                    council
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                        <Badge variant="default">
                                            {getMemberLabel(
                                                member.memberStatus,
                                            )}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-end">
                                        {dayjs(member.createdAt).format(
                                            "MMMM D, YYYY",
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                        <TableCaption>
                            A list of all members in this fractal.
                        </TableCaption>
                    </Table>
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
