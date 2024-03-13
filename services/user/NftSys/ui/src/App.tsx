import { useEffect, useState } from "react";
import "./App.css";
import { Supervisor } from "@psibase/common-lib/messaging";

function App() {
    const [count, setCount] = useState(0);
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
            <h1>Vite + React</h1>
            <div className="card">
                <button onClick={() => setCount((count) => count + 1)}>
                    count is {count}
                </button>
                <p>
                    Edit <code>src/App.tsx</code> and save to test HMR
                </p>
                <button onClick={mintNft}>mint</button>
                <pre>{JSON.stringify(res, null, 2)}</pre>
            </div>
        </>
    );
}

export default App;
