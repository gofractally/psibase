import { requestSignup } from "./portal-api";
import { generateSigningKey } from "./signing-key";

export interface SignupRequest {
    name: string;
    signupId: string;
    privateKeyPem: string;
}

/**
 * Generates the account's key in this browser and requests `name` with its
 * public key. Throws `PortalError` when the node refuses.
 */
export const startSignup = async (name: string): Promise<SignupRequest> => {
    const key = await generateSigningKey();
    const signupId = await requestSignup(name, key.publicKeyPem);
    return { name, signupId, privateKeyPem: key.privateKeyPem };
};
