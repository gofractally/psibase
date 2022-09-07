import { useState } from "react";

import { AppletId, getJson, operation } from "common/rpc.mjs";
import { genKeyPair, KeyType } from "common/keyConversions.mjs";

import refresh from "./assets/icons/refresh.svg";
import { MsgProps } from "../helpers";
import Button from "./Button";

const onCreateAccount = async (
    name: any,
    pubKey: any,
    addMsg: any,
    clearMsg: any
) => {
    const thisApplet = await getJson("/common/thiscontract");
    try {
        clearMsg();
        addMsg("Pushing transaction...");
        await operation(new AppletId(thisApplet, ""), "newAcc", {
            name,
            pubKey,
        });
    } catch (e: any) {
        console.error(e);
        addMsg(e.message);
        if (!e.trace) return;
        addMsg("trace: " + JSON.stringify(e.trace, null, 4));
    }
};
export const CreateAccountForm = ({ addMsg, clearMsg }: MsgProps) => {
    const [name, setName] = useState("");
    const [pubKey, setPubKey] = useState("");
    const [privKey, setPrivKey] = useState("");

    const generateKeyPair = () => {
        const kp = genKeyPair(KeyType.k1);
        setPubKey(kp.pub);
        setPrivKey(kp.priv);
    };

    return (
        <div>
            <h2>Add an account</h2>
            <div>Input your own private key, or generate a new one.</div>
            <div>
                <div>Name</div>
                <input
                    type="text"
                    value={name}
                    className="w-full xs:w-64"
                    onChange={(e) => setName(e.target.value)}
                ></input>
            </div>
            <div className="w-full sm:w-96">
                <div className="flex w-full justify-between">
                    <span className="my-2">Private key</span>
                    <button
                        onClick={generateKeyPair}
                        className="m-1 flex cursor-pointer justify-between  bg-gray-200 py-1 px-3 text-center text-gray-700 no-underline ring-gray-100 hover:bg-gray-300 focus:ring-4"
                    >
                        <img src={refresh} className="inline-block" />
                        Generate new key
                    </button>
                </div>
                <input
                    type="text"
                    className="w-full"
                    value={privKey}
                    onChange={(e) => setPrivKey(e.target.value)}
                ></input>
            </div>
            <div className="w-full sm:w-96">
                <div>Public Key</div>
                <input
                    type="text"
                    value={pubKey}
                    className="w-full"
                    disabled={true}
                    onChange={(e) => setPubKey(e.target.value)}
                ></input>
            </div>
            <div>
                <Button
                    type="primary"
                    onClick={(e) =>
                        onCreateAccount(name, pubKey, addMsg, clearMsg)
                    }
                >
                    Create Account
                </Button>
            </div>
        </div>
    );
};
