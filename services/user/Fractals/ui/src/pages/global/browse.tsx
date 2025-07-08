import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { CreateFractalModal } from "@/components/create-fractal-modal";
import { EmptyBlock } from "@/components/empty-block";

import { useFractals } from "@/hooks/fractals/use-fractals";

export const Browse = () => {
    const { data: fractals } = useFractals();

    const navigate = useNavigate();

    const [showModal, setShowModal] = useState(false);

    return (
        <div className="w-full max-w-screen-xl p-4">
            <div className="text-lg">Fractals</div>
            {fractals && fractals.length > 0 && (
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
                                            navigate(
                                                `/fractal/${fractal.account}`,
                                            );
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
            )}
            {fractals?.length == 0 && (
                <EmptyBlock
                    title="No fractals"
                    description="No fractals have been created yet"
                    buttonLabel="Create the first fractal"
                    onButtonClick={() => {
                        setShowModal(true);
                    }}
                />
            )}
            <CreateFractalModal
                openChange={(e) => setShowModal(e)}
                show={showModal}
            />
        </div>
    );
};
