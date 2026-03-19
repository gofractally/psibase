import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CreateFractalModal } from "@/components/create-fractal-modal";

import { useFractals } from "@/hooks/fractals/use-fractals";

import { EmptyBlock } from "@shared/components/empty-block";
import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/domains/fractal/components/page-container";
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
            {fractals?.length == 0 ? (
                <EmptyBlock
                    title="No fractals"
                    description="No fractals have been created yet"
                    buttonLabel="Create the first fractal"
                    onButtonClick={() => {
                        setShowModal(true);
                    }}
                />
            ) : (
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
                                                {fractal.name ||
                                                    fractal.account}
                                            </TableCell>
                                            <TableCell>
                                                {fractal.mission}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                <TableCaption>
                                    A list of all fractals.
                                </TableCaption>
                            </Table>
                        )}
                    </CardContent>
                </GlowingCard>
            )}
            <CreateFractalModal
                openChange={(e) => setShowModal(e)}
                show={showModal}
            />
        </PageContainer>
    );
};
