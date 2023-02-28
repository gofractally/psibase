import { Link } from "react-router-dom";

import { Layout } from "components";
import { useState } from "react";
import {
    postJsonGetArrayBuffer,
    pushedSignedTransaction,
    setBaseUrl,
    uint8ArrayToHex,
} from "@toolbox/psi-rpc";

setBaseUrl("http://account-sys.psibase.127.0.0.1.sslip.io:8080");

export const Test = () => {
    const [newAccountName, setNewAccountName] = useState("bob");
    const [actionJSON, setActionJSON] = useState("");

    const buildTransaction = async (newAccountName: string) => {
        console.info("building Trx...");
        const arrayBufferPayload = await postJsonGetArrayBuffer(
            "/pack_action/newAccount",
            {
                name: newAccountName,
                authContract: "auth-fake-sys",
                requireNew: true,
            }
        );
        console.info("arrayBufferPayload:", arrayBufferPayload);
        const hexPayload = new Uint8Array(arrayBufferPayload);
        console.info("hexPayload:", hexPayload);
        const action = {
            sender: "account-sys",
            contract: "account-sys",
            method: "newAccount",
            rawData: uint8ArrayToHex(hexPayload),
        };
        setActionJSON(JSON.stringify(action, null, 4));

        console.info("Pushing transaction...");
        const signedTrx = {
            // TODO: TAPOS
            // TODO: Sign
            transaction: {
                tapos: {
                    expiration: new Date(Date.now() + 10_000),
                },
                actions: [action],
            },
        };
        const trace = await pushedSignedTransaction(signedTrx);

        console.info(JSON.stringify(trace, null, 4));
    };

    return (
        <Layout>
            <div className="flex h-full items-center justify-center text-2xl text-gray-800">
                <Link to="/">&larr; go back home &larr;</Link>
            </div>
            <div>This page tests RPC interaction with the chain</div>
            <div>
                New Account Name:
                <input
                    value={newAccountName}
                    style={{ height: "2rem", border: "2px solid white" }}
                    onChange={(e) => {
                        e.preventDefault();
                        console.info("newName:", e.currentTarget.value);
                        setNewAccountName(e.currentTarget.value);
                        buildTransaction(e.currentTarget.value);
                    }}
                />
            </div>
            <div>
                <textarea
                    readOnly
                    style={{ height: "20rem", width: "100%" }}
                    value={actionJSON}
                />
            </div>
        </Layout>
    );
};

export default Test;
