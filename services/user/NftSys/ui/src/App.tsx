import { useEffect, useState } from "react";

import { Supervisor } from "@psibase/common-lib/messaging";
import { Heading } from "@psibase/components";

import WalletIcon from "./assets/icon-wallet.svg?react";
import { NftTable, SendMintNft } from "./components";

export type Nft = {
    id: string;
    status: "owned" | "burned" | "pending-debit" | "pending-credit";
    counterParty?: string;
};

const nfts: Nft[] = [
    {
        id: "1",
        status: "owned",
    },
    {
        id: "2",
        status: "pending-debit",
        counterParty: "brandon",
    },
    {
        id: "3",
        status: "pending-credit",
        counterParty: "james",
    },
];

function App() {
    const [resMint, setResMint] = useState("Empty");

    const init = async () => {
        const supervisor = new Supervisor();
        await supervisor.onLoaded();
        supervisor.preLoadServices(["nft-sys"]);
    };

    useEffect(() => {
        init();
        console.info("nft-sys connected to Supervisor");
    }, []);

    const supervisor = new Supervisor();
    const mintNft = async () => {
        if (!supervisor.onLoaded()) return;

        console.log("calling nft-sys.callintoplugin");
        const res = await supervisor.functionCall({
            service: "nft-sys",
            method: "mint",
            params: [],
        });
        setResMint(res as string);
    };

    const burnNft = async (nftId: number) => {
        if (!supervisor.onLoaded()) return;

        console.log("calling nft-sys.callintoplugin");
        const res = await supervisor.functionCall({
            service: "nft-sys",
            method: "burn",
            params: [nftId],
        });
        setResMint(res as string);
    };

    const uncreditNft = async (nftId: number) => {
        if (!supervisor.onLoaded()) return;

        console.log("calling nft-sys.callintoplugin");
        const res = await supervisor.functionCall({
            service: "nft-sys",
            method: "uncredit",
            params: [nftId],
        });
        setResMint(res as string);
    };

    const debitNft = async (nftId: number) => {
        if (!supervisor.onLoaded()) return;

        console.log("calling nft-sys.callintoplugin");
        const res = await supervisor.functionCall({
            service: "nft-sys",
            method: "debit",
            params: [nftId],
        });
        setResMint(res as string);
    };

    const actionHandlers = { burnNft, uncreditNft, debitNft };

    return (
        <>
            <div className="mx-auto max-w-screen-xl space-y-6 p-2 sm:px-8">
                <div className="flex items-center gap-2">
                    <WalletIcon />
                    <Heading tag="h1" className="select-none text-gray-600">
                        NFT
                    </Heading>
                </div>
                <NftTable nfts={nfts} actionHandlers={actionHandlers} />
                <SendMintNft nfts={nfts} mintNft={mintNft} resMint={resMint} />
            </div>
        </>
    );
}

export default App;
