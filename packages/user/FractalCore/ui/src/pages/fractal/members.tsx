import dayjs from "dayjs";

import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembers } from "@/hooks/fractals/use-members";
import { paths } from "@/lib/paths";

import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
import { ShowContactsButton } from "@shared/components/show-contacts-button";
import { TableContact } from "@shared/components/tables/table-contact";
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
                                <TableHead className="text-end">
                                    Created At
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedMembers.map((member) => (
                                <TableRow key={member.account}>
                                    <TableCell className="font-medium">
                                        <TableContact
                                            account={member.account}
                                        />
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
