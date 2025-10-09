import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/empty-block";
import { ApplyGuildModal } from "@/components/modals/apply-guild-modal";

import { useGuildApplications } from "@/hooks/fractals/use-guild-applications";
import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-id";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const Applications = () => {
    const { data: guild } = useGuild();
    const { data: applications } = useGuildApplications(guild?.account);

    const navigate = useNavigate();
    const [showGuildModal, setShowGuildModal] = useState(false);

    const guildAccount = useGuildAccount();
    const { data: currentUser } = useCurrentUser();
    const { data: memberships, isPending } =
        useGuildMembershipsOfUser(currentUser);
    const isGuildMember = memberships?.some(
        (membership) => membership.guild.account == guildAccount,
    );

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Applications</h1>
            </div>
            <ApplyGuildModal
                openChange={(e) => setShowGuildModal(e)}
                show={showGuildModal}
            />
            <div className="mt-3">
                {applications && applications.length > 0 ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead>Attestations</TableHead>
                                <TableHead>Application created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {applications.map((member) => (
                                <TableRow
                                    key={member.member}
                                    onClick={() => {
                                        navigate(member.member);
                                    }}
                                >
                                    <TableCell className="font-medium">
                                        {member.member}
                                    </TableCell>
                                    <TableCell>
                                        {member.attestations.length}
                                    </TableCell>
                                    <TableCell>
                                        {dayjs(member.createdAt).format(
                                            "ddd MMM D, HH:mm",
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
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
            </div>
        </div>
    );
};
