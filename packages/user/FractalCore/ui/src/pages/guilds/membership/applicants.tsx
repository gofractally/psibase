import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApplyGuildModal } from "@/components/modals/apply-guild-modal";

import { useGuildApplications } from "@/hooks/fractals/use-guild-applications";
import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { EmptyBlock } from "@shared/components/empty-block";
import { GlowingCard } from "@shared/components/glowing-card";
import { TableContact } from "@shared/components/tables/table-contact";
import { useCurrentUser } from "@shared/hooks/use-current-user";
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

export const GuildApplicants = () => {
    const [showGuildModal, setShowGuildModal] = useState(false);

    const navigate = useNavigate();

    const { data: currentUser } = useCurrentUser();
    const { data: guild } = useGuild();
    const { data: applications } = useGuildApplications(guild?.account);
    const guildAccount = useGuildAccount();
    const { data: memberships, isPending } =
        useGuildMembershipsOfUser(currentUser);

    const isGuildMember = memberships?.some(
        (membership) => membership.guild.account == guildAccount,
    );

    return (
        <>
            <ApplyGuildModal
                openChange={(e) => setShowGuildModal(e)}
                show={showGuildModal}
            />
            {applications && applications.length > 0 ? (
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>Guild applicants</CardTitle>
                    </CardHeader>
                    <CardContent className="@container">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Account</TableHead>
                                    <TableHead>Attestations</TableHead>
                                    <TableHead className="text-end">
                                        Application created
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {applications.map((application) => (
                                    <TableRow
                                        key={application.applicant}
                                        onClick={() => {
                                            navigate(
                                                `/guild/${guild?.account}/applications/${application.applicant}`,
                                            );
                                        }}
                                    >
                                        <TableCell className="font-medium">
                                            <TableContact
                                                account={application.applicant}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {
                                                application.attestations.nodes
                                                    .length
                                            }
                                        </TableCell>
                                        <TableCell className="text-end">
                                            {dayjs(
                                                application.createdAt,
                                            ).format("llll")}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableCaption>
                                A list of all applicants wishing to join this
                                guild.
                            </TableCaption>
                        </Table>
                    </CardContent>
                </GlowingCard>
            ) : (
                <EmptyBlock
                    title="No applications"
                    description="There are no applicants awaiting to join this guild."
                    buttonLabel="Apply"
                    onButtonClick={
                        isGuildMember || isPending
                            ? undefined
                            : () => {
                                  setShowGuildModal(true);
                              }
                    }
                />
            )}
        </>
    );
};
