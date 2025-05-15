import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { useFractals } from "@/hooks/fractals/useFractals";

export const Browse = () => {
    const { data: fractals } = useFractals();

    const navigate = useNavigate();

    return (
        <div className="w-full max-w-screen-xl p-4">
            <div className="text-lg">Fractals</div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Fractal</TableHead>
                        <TableHead>Mission</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {fractals?.map((fractal) => (
                        <TableRow key={fractal.account}>
                            <TableCell className="font-medium">
                                <Button
                                    onClick={() => {
                                        navigate(`/fractal/${fractal.account}`);
                                    }}
                                    size="sm"
                                    variant="link"
                                >
                                    {fractal.name || fractal.account}
                                </Button>
                            </TableCell>
                            <TableCell>{fractal.mission}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};
