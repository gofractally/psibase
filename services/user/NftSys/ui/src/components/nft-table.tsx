import { Flame, HandCoins, X } from "lucide-react";

// import { QueryResult } from "common/useGraphQLQuery.mjs";

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";

import type { Nft } from "../App";

interface Props {
    nfts: Nft[];
    actionHandlers: {
        [key: string]: (nftId: number) => void;
    };
    // queryResult?: QueryResult;
}

export const NftTable = ({
    nfts,
    actionHandlers,
    // queryResult = { isLoading: false, isError: false },
}: Props) => {
    const { burnNft, uncreditNft, debitNft } = actionHandlers;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Your NFTs</CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>A list of your NFTs.</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-20">NFT ID</TableHead>
                            <TableHead></TableHead>
                            <TableHead className="w-20 text-right">
                                Action
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {nfts?.map((nft: Nft) => {
                            return (
                                <TableRow key={nft.id}>
                                    <TableCell className="text-center font-medium">
                                        {nft.id}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {nft.status === "pending-credit" ? (
                                            <>
                                                Incoming from{" "}
                                                <span className="font-mono">
                                                    {nft.counterParty}
                                                </span>
                                            </>
                                        ) : nft.status === "pending-debit" ? (
                                            <>
                                                Outgoing to{" "}
                                                <span className="font-mono">
                                                    {nft.counterParty}
                                                </span>
                                            </>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {nft.status === "owned" ? (
                                            <Tooltip delayDuration={400}>
                                                <TooltipContent side="left">
                                                    <p>Burn NFT</p>
                                                </TooltipContent>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="hover:text-red-400"
                                                        onClick={() =>
                                                            burnNft(nft.id)
                                                        }
                                                    >
                                                        <Flame />
                                                    </Button>
                                                </TooltipTrigger>
                                            </Tooltip>
                                        ) : nft.status === "pending-credit" ? (
                                            <Tooltip delayDuration={400}>
                                                <TooltipContent side="left">
                                                    <p>Claim NFT</p>
                                                </TooltipContent>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="hover:text-green-600"
                                                        onClick={() =>
                                                            debitNft(nft.id)
                                                        }
                                                    >
                                                        <HandCoins />
                                                    </Button>
                                                </TooltipTrigger>
                                            </Tooltip>
                                        ) : nft.status === "pending-debit" ? (
                                            <Tooltip delayDuration={400}>
                                                <TooltipContent side="left">
                                                    <p>Cancel Transfer</p>
                                                </TooltipContent>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="hover:text-red-700"
                                                        onClick={() =>
                                                            uncreditNft(nft.id)
                                                        }
                                                    >
                                                        <X />
                                                    </Button>
                                                </TooltipTrigger>
                                            </Tooltip>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};

export default NftTable;
