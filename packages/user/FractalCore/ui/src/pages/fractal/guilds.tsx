
import { cn } from "@shared/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useNavigate } from "react-router-dom";



export const Guilds = () => {

    const { data: fractal } = useFractal();

    console.log({ fractal, }, 'is the fractal guilds')

    const navigate = useNavigate();
    const guildsData = fractal?.guilds.nodes;

    const guilds = (guildsData || [])

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">All Guilds</h1>
            </div>
            <div className="mt-3">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Bio</TableHead>
                            <TableHead>Leadership</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {guilds?.map((guild, index) => (
                            <TableRow
                                key={guild.account}
                                className={cn({
                                    "bg-background/80": index < 6,
                                })}
                                onClick={() => {
                                    navigate(`/guild/${guild.account}/`)
                                }}
                            >
                                <TableCell className="font-medium">
                                    {guild.displayName}
                                </TableCell>
                                <TableCell>
                                    {guild.bio}
                                </TableCell>
                                <TableCell>
                                    {guild.rep?.member ? guild.rep.member : "Council"}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};
