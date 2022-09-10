import { useState } from "react";

import { AppletId, getJson, operation } from "common/rpc.mjs";
import { genKeyPair, KeyType } from "common/keyConversions.mjs";

import refresh from "./assets/icons/refresh.svg";
import Button from "./Button";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
    account: string;
}

interface Props {
    isLoading: boolean,
    errorMessage: string,
    onCreateAccount: (pair: AccountPair) => void,
    name: string;
    pubKey: string;
    privKey: string;
    setName: (name: string) => void
    setPubKey: (publicKey: string) => void
    setPrivKey: (privateKey: string) => void
}

export const CreateAccountForm = ({ onCreateAccount, isLoading, errorMessage, setName, setPrivKey, setPubKey, name, pubKey, privKey }: Props) => {


    const generateKeyPair = () => {
        const kp = genKeyPair(KeyType.k1);
        setPubKey(kp.pub);
        setPrivKey(kp.priv);
    };

    const isValid = name !== ''

    const isDisabled = isLoading || !isValid

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
            <div className="mt-4">
                <Button
                    type="primary"
                    disabled={isDisabled}
                    onClick={(e) =>
                        onCreateAccount({ account: name, publicKey: pubKey, privateKey: privKey })
                    }
                >
                    {isLoading ? 'Loading..' : 'Create Account'}
                </Button>
            </div>
            <div className="mt-4 h-8 text-red-700">
                {errorMessage}
            </div>
        </div>
    );
};
