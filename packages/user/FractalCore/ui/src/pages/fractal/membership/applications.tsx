
import {
    Table,
    TableBody,
    // TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";


// guild
// member
// app
// createdAt
//
// guild
// member
// attestee
// comment
// endorses


export const Applications = () => {


    // const applications = []


    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
        <div className="flex h-9 items-center">
            <h1 className="text-lg font-semibold">Applications</h1>
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
                    {/* {scores?.map((member, index) => (
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
                    ))} */}
                </TableBody>
            </Table>
        </div>
    </div>
}