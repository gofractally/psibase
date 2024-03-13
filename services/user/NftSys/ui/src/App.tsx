import { useEffect, useState } from "react";

import { Supervisor } from "@psibase/common-lib/messaging";
import { Heading } from "@psibase/components";

import WalletIcon from "./assets/icon-wallet.svg?react";
import { NftTable, SendNftSection } from "./components";

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
    const [res, setRes] = useState("Empty");

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
        setRes(res as string);
    };

    return (
        <>
            <div className="mx-auto max-w-screen-xl space-y-6 p-2 sm:px-8">
                <div className="flex items-center gap-2">
                    <WalletIcon />
                    <Heading tag="h1" className="select-none text-gray-600">
                        NFT
                    </Heading>
                </div>
                <NftTable nfts={nfts} />
                <SendNftSection nfts={nfts} />
                <button
                    onClick={mintNft}
                    className="rounded-md border-2 border-blue-500 bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-600"
                >
                    mint
                </button>
                <pre>{JSON.stringify(res, null, 2)}</pre>
            </div>
        </>
    );
}

export default App;
