import { useState } from "react";
import { privateStringToKeyPair, publicKeyPairToString } from "common/keyConversions.mjs";
import Button from "./Button";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
}

interface Props {
    isLoading: boolean,
    errorMessage: string,
    onImport: (pair: AccountPair) => void,
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


export const ImportAccountForm = ({ onImport, isLoading, errorMessage }: Props) => {


    const [privateKey, setPrivateKey] = useState('');

    const { publicKey, error } = getPublicKey(privateKey);

    const isValidPrivateKey = !error
    const isDisabled = isLoading || !isValidPrivateKey || privateKey === ''

    return (
        <div>
            <h2>Import an account</h2>
            <div>Input your own private key to access an existing account.</div>
            <div className="w-full sm:w-96">
                <div className="flex w-full justify-between">
                    <span className="my-2">Private key</span>
                </div>
                <input
                    type="text"
                    className="w-full"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                ></input>
            </div>
            <div className="w-full sm:w-96">
                <div>Public Key</div>
                <input
                    type="text"
                    value={publicKey}
                    className="w-full"
                    disabled={true}
                ></input>
                {error && (
                    <div className="text-red-500 font-bold">{error}</div>
                )}
            </div>
            <div className="mt-4">
                <Button
                    type="primary"
                    disabled={isDisabled}
                    onClick={(e) => {
                        onImport({ privateKey, publicKey })
                        setPrivateKey('')
                    }
                    }
                >
                    {isLoading ? 'Loading..' : 'Import Account'}
                </Button>
            </div>
            <div className="mt-4 w-96 h-8 text-red-700">
                {errorMessage}
            </div>
        </div>
    );
};
