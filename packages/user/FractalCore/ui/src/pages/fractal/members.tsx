import dayjs from "dayjs";
import { Users } from "lucide-react";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembers } from "@/hooks/fractals/use-members";
import { paths } from "@/lib/paths";

import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
import { ShowContactsButton } from "@shared/components/show-contacts-button";
import { TableContact } from "@shared/components/tables/table-contact";
import { COUNCIL_SEATS } from "@shared/domains/fractal/lib/constants";
import { formatThousands } from "@shared/lib/format-number";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
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

function formatEarned(amount: string) {
    const fraction = amount.split(".")[1]?.length ?? 0;
    const value = Number(amount);
    if (!Number.isFinite(value)) return amount;
    return formatThousands(value, fraction, true);
}

export const Members = () => {
    const currentFractal = useFractalAccount();

    const { data: members } = useMembers(currentFractal);

    const sortedMembers = [...(members ?? [])].sort(
        (a, b) =>
            new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf(),
    );

    return (
        <PageContainer>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>All Members</CardTitle>
                    <CardAction>
                        <ShowContactsButton
                            returnPath={paths.fractal.members()}
                        />
                    </CardAction>
                </CardHeader>
                <CardContent className="@container">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-end">
                                    Total earned
                                </TableHead>
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
                                            Member
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-end tabular-nums">
                                        {formatEarned(member.totalEarned)}
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
