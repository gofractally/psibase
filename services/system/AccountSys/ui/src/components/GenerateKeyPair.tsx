import { useState } from "react";

import { genKeyPair, KeyType } from "@psibase/common-lib";

export const GenerateKeyPair = () => {
    const [pub, setPub] = useState("");
    const [priv, setPriv] = useState("");

    const generateKeyPair = () => {
        const kp = genKeyPair(KeyType.k1);
        setPub(kp.pub);
        setPriv(kp.priv);
    };

    return (
        <div>
            <h2>Generate Key Pair</h2>
            <table>
                <tbody>
                    <tr>
                        <td></td>
                        <td>
                            <button onClick={generateKeyPair}>Generate</button>
                        </td>
                    </tr>
                    <tr>
                        <td>Public key</td>
                        <td>
                            <input type="text" disabled value={pub}></input>
                        </td>
                    </tr>
                    <tr>
                        <td>Private key</td>
                        <td>
                            <input type="text" disabled value={priv}></input>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};
