
import { useGuildApplications } from "@/hooks/fractals/use-guild-applications";
import { useGuild } from "@/hooks/use-guild";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";



export const Applications = () => {

    const { data: guild } = useGuild();
    const { data: applications } = useGuildApplications(guild?.id);

    const navigate = useNavigate();

    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
        <div className="flex h-9 items-center">
            <h1 className="text-lg font-semibold">Applications</h1>
        </div>
        <div className="mt-3">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Attestations</TableHead>
                        <TableHead>Application created</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {applications?.map((member) => (
                        <TableRow
                            key={member.member}
                            onClick={() => {
                                navigate(member.member)
                            }}
                        >
                            <TableCell className="font-medium">
                                {member.member}
                            </TableCell>
                            <TableCell>
                                {member.attestations.length}
                            </TableCell>
                            <TableCell>
                                {dayjs(member.createdAt).format('ddd MMM D, HH:mm')}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    </div>
}