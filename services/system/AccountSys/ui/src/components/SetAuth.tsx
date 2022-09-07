import { AppletId, getJson, operation } from "common/rpc.mjs";

let setAuth = async () => {
    const thisApplet = await getJson("/common/thiscontract");
    operation(new AppletId(thisApplet, ""), "setKey", {
        name: "alice",
        pubKey: "PUB_K1_53cz2oXcYTqy76vfCTsknKHS2NauiRyUwe8pAgDe2j9YHsmZqg",
    });
};

export const SetAuth = () => {
    return (
        <div className="my-4 rounded-lg py-2 shadow-md">
            <h2>Dev buttons</h2>
            <button
                className="rounded-lg bg-green-500 p-4"
                onClick={(e) => setAuth()}
            >
                Set auth Alice on chain
            </button>
        </div>
    );
};
