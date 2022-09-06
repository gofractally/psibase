import { getJson, operation } from "common/rpc.mjs";

let setAuth = async () => {
    const thisApplet = await getJson("/common/thiscontract");
    operation(thisApplet, "setKey", {
        name: "alice",
        pubKey: "PUB_K1_53cz2oXcYTqy76vfCTsknKHS2NauiRyUwe8pAgDe2j9YHsmZqg",
    });
};

export const SetAuth = () => {
    return (
        <div className="rounded-lg my-4 py-2 shadow-md">
            <h2>Dev buttons</h2>
            <button className="p-4 bg-green-500 rounded-lg" onClick={(e) => setAuth()}>Set auth Alice on chain</button>
        </div>
    );
};
