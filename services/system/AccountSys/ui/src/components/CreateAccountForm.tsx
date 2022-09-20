import { forwardRef, useImperativeHandle, useState } from "react";

import { AppletId, getJson, operation } from "common/rpc.mjs";
import { genKeyPair, KeyType, privateStringToKeyPair, publicKeyPairToString } from "common/keyConversions.mjs";

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
}


const getPublicKey = (key: string): { error: string, publicKey: string } => {
    if (key == '') return {
        error: '',
        publicKey: ''
    };
    try {
        const publicKey = publicKeyPairToString(privateStringToKeyPair(key))
        return { error: '', publicKey }
    } catch (e) {
        return { error: `${e}`, publicKey: '' }
    }
}


export const CreateAccountForm = forwardRef(({ onCreateAccount, isLoading, errorMessage }: Props, ref) => {

    const [name, setName] = useState("");
    const [pubKey, setPubKey] = useState("");
    const [privKey, setPrivKey] = useState("");

    useImperativeHandle(ref, () => ({
        resetForm() {
            console.log('child function 1 called');
            setName('')
            setPubKey('')
            setPrivKey('')
        },
    }));

    const generateKeyPair = () => {
        const kp = genKeyPair(KeyType.k1);
        setPubKey(kp.pub);
        setPrivKey(kp.priv);
    };

    const updatePrivateKey = (key: string) => {
        setPrivKey(key)
        const { publicKey, error } = getPublicKey(key)
        if (!error && publicKey) {
            setPubKey(publicKey)
        }
    }

    const isValid = name !== ''

    const isDisabled = isLoading || !isValid

    return (
        <div>
            <h2>Create an account</h2>
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
                    onChange={(e) => updatePrivateKey(e.target.value)}
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
})
