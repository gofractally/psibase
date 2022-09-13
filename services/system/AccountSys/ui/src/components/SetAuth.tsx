import { AppletId, getJson, operation } from "common/rpc.mjs";

let setAuth = async () => {
    const thisApplet = await getJson("/common/thisservice");
    operation(new AppletId(thisApplet, ""), "setKey", {
        name: "alice",
        pubKey: "PUB_K1_53cz2oXcYTqy76vfCTsknKHS2NauiRyUwe8pAgDe2j9YHsmZqg",
    });
};

export const SetAuth = () => {
    return (
        <>
            <h2>Set Alice on Chain</h2>
            <button onClick={(e) => setAuth()}>Set Auth</button>
        </>
    );
};
