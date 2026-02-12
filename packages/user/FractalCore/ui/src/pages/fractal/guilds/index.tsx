import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { COUNCIL_SEATS } from "@/lib/constants";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
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
            <div className="mx-auto w-full max-w-5xl p-4 px-6">
                <div className="flex h-9 items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold">All Guilds</h1>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowModal(true)}
                    >
                        <Plus />
                        <span className="hidden lg:inline">New Guild</span>
                    </Button>
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
                                        "bg-background/80":
                                            index < COUNCIL_SEATS,
                                    })}
                                    onClick={() => {
                                        navigate(`/guild/${guild.account}/`);
                                    }}
                                >
                                    <TableCell className="font-medium">
                                        {guild.displayName}
                                    </TableCell>
                                    <TableCell>{guild.bio}</TableCell>
                                    <TableCell>
                                        {guild.rep?.member
                                            ? guild.rep.member
                                            : "Council"}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </>
    );
};
