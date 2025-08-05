import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CreateFractalModal } from "@/components/create-fractal-modal";
import { EmptyBlock } from "@/components/empty-block";

import { useFractals } from "@/hooks/fractals/use-fractals";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const Browse = () => {
    const { data: fractals } = useFractals();

    const navigate = useNavigate();

    const [showModal, setShowModal] = useState(false);

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">Fractals</h1>
            </div>
            <div className="mt-3">
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
                                <TableRow
                                    key={fractal.account}
                                    onClick={() => {
                                        navigate(`/fractal/${fractal.account}`);
                                    }}
                                    className="cursor-pointer"
                                >
                                    <TableCell className="font-medium">
                                        {fractal.name || fractal.account}
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
        </div>
    );
};
