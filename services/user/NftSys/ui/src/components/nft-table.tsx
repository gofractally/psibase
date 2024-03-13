import { QueryResult } from "common/useGraphQLQuery.mjs";

import Button from "./button";
import Heading from "./heading";
import Loader from "./loader";
import Text from "./text";
import { Nft } from "../App";

const TransferHistoryTableHeader = () => (
    <div className="flex select-none border-b border-gray-900 py-1 font-bold">
        <div className="flex-1 px-2">
            <Text size="base" span>
                NFT ID
            </Text>
        </div>
        <div className="w-28 px-2 text-center">
            <Text size="base" span>
                Action
            </Text>
        </div>
    </div>
);

interface Props {
    nfts: Nft[];
    actionHandlers: {
        [key: string]: (nftId: number) => void;
    };
    queryResult?: QueryResult;
}

export const NftTable = ({
    nfts,
    actionHandlers: _actionHandlers,
    queryResult: result = { isLoading: false, isError: false },
}: Props) => {
    if (result.isLoading) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Loader size="4xl" />
            </section>
        );
    }

    if (result.isError) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Text className="font-medium text-red-600">
                    Error fetching NFTs. Refresh the page to try again.
                </Text>
            </section>
        );
    }

    // const { burnNft, uncreditNft, debitNft } = actionHandlers;
    return (
        <section className="mt-3 space-y-3">
            <Heading tag="h2" className="select-none font-medium text-gray-600">
                My NFTs
            </Heading>
            <div>
                <TransferHistoryTableHeader />
                {nfts?.map((nft: Nft) => {
                    return (
                        <div
                            className="flex items-center py-1 text-sm hover:bg-gray-100 xs:text-base"
                            key={nft.id}
                        >
                            <div className="flex-1 px-2 pl-6 font-mono font-semibold">
                                {nft.id}
                            </div>
                            <div className="w-52 px-2">
                                {nft.status === "pending-credit" ? (
                                    <Text span size="base">
                                        Incoming from{" "}
                                        <span className="font-mono font-semibold">
                                            {nft.counterParty}
                                        </span>
                                    </Text>
                                ) : nft.status === "pending-debit" ? (
                                    <Text span size="base">
                                        Outgoing to{" "}
                                        <span className="font-mono font-semibold">
                                            {nft.counterParty}
                                        </span>
                                    </Text>
                                ) : null}
                            </div>

                            <div className="w-28 px-2">
                                {nft.status === "owned" ? (
                                    <Button
                                        size="xs"
                                        fullWidth
                                        className="text-red-500"
                                        // onClick={() => burnNft(nft.id)}
                                    >
                                        Burn
                                    </Button>
                                ) : nft.status === "pending-credit" ? (
                                    <Button
                                        size="xs"
                                        fullWidth
                                        className="text-green-500"
                                        // onClick={() => debitNft(nft.id)}
                                    >
                                        Claim
                                    </Button>
                                ) : nft.status === "pending-debit" ? (
                                    <Button
                                        size="xs"
                                        fullWidth
                                        className="w-24"
                                        // onClick={() => uncreditNft(nft.id)}
                                    >
                                        Uncredit
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

export default NftTable;
