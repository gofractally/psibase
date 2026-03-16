import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CreateFractalModal } from "@/components/create-fractal-modal";
import { EmptyBlock } from "@/components/empty-block";
import { PageContainer } from "@/components/page-container";

import { useFractals } from "@/hooks/fractals/use-fractals";

import { GlowingCard } from "@shared/components/glowing-card";
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

export const Browse = () => {
    const { data: fractals } = useFractals();

    const navigate = useNavigate();

    const [showModal, setShowModal] = useState(false);

    return (
        <PageContainer>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Fractals</CardTitle>
                </CardHeader>
                <CardContent className="@container">
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
                                            navigate(
                                                `/fractal/${fractal.account}`,
                                            );
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
                            <TableCaption>A list of all fractals.</TableCaption>
                        </Table>
                    )}
                </CardContent>
            </GlowingCard>
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
        </PageContainer>
    );
};
