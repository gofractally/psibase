import { psiboardApplet } from "service";

export const appletAddress = async(name?: string) => {
    const appletName = await psiboardApplet.getAppletName()
    const removedSubdomain = window.location.host.split('.').filter(text => text !== appletName).join('.');
    const result = `${window.location.protocol}//${removedSubdomain}/applet/${name || appletName}`
    return result;
}