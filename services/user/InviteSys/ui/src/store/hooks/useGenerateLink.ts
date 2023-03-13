import { useMutation } from "@tanstack/react-query";
import { genKeyPair, KeyType } from "common/keyConversions.mjs";
import { psiboardApplet } from "service";

const appletAddress = async(name?: string) => {
    const appletName = await psiboardApplet.getAppletName()
    const removedSubdomain = window.location.host.split('.').filter(text => text !== appletName).join('.');
    const result = `${window.location.protocol}//${removedSubdomain}/applet/${name || appletName}`
    return result;
}

export const useGenerateLink = () => {
    return useMutation({
        mutationFn: async () => {
            const { pub: publicKey, priv } = genKeyPair(KeyType.k1);
    
            await psiboardApplet.makeInvite({
                publicKey
            });
    
            const address = await appletAddress()
            const url = new URL(address);
            url.searchParams.append('token', priv);
            return url.toString()
        }
    });
}