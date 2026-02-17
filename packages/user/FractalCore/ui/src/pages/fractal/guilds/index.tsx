import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { FractalGuildIdentifier } from "@/components/fractal-guild-header-identifier";

import { useFractal } from "@/hooks/fractals/use-fractal";

import { GlowingCard } from "@shared/components/glowing-card";
import { TableContact } from "@shared/components/tables/table-contact";
import { Button } from "@shared/shadcn/ui/button";
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

import { ModalCreateGuild } from "./components/modal-create-guild";

export const Guilds = () => {
    const [showModal, setShowModal] = useState(false);

    const { data: fractal } = useFractal();

    const navigate = useNavigate();
    const guildsData = fractal?.guilds.nodes;

    const guilds = guildsData || [];

    return (
        <>
            <ModalCreateGuild openChange={setShowModal} show={showModal} />
            <div className="mx-auto w-full max-w-5xl space-y-4">
                <div className="flex justify-end">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowModal(true)}
                    >
                        <Plus />
                        <span className="hidden lg:inline">New Guild</span>
                    </Button>
                </div>
                <GlowingCard>
                    <CardHeader>
                        <CardTitle>All Guilds</CardTitle>
                    </CardHeader>
                    <CardContent className="@container">
                        <Table className="select-none">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-48">
                                        Guild
                                    </TableHead>
                                    <TableHead className="w-32 text-end">
                                        Leadership
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {guilds?.map((guild) => (
                                    <TableRow
                                        key={guild.account}
                                        onClick={() => {
                                            navigate(`/guild/${guild.account}`);
                                        }}
                                    >
                                        <TableCell className="font-medium">
                                            <FractalGuildIdentifier
                                                name={guild.displayName}
                                                account={guild.account}
                                                size="sm"
                                            />
                                        </TableCell>
                                        <TableCell className="justify-items-end">
                                            {guild.rep?.member ? (
                                                <TableContact
                                                    account={guild.rep.member}
                                                />
                                            ) : (
                                                "Council"
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableCaption>
                                A list of all guilds in this fractal.
                            </TableCaption>
                        </Table>
                    </CardContent>
                </GlowingCard>
            </div>
        </>
    );
};
