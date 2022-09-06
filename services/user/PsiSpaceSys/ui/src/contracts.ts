import { action, AppletId, getJson, siblingUrl } from "common/rpc.mjs";

class Contract {
    protected cachedApplet?: string;

    constructor() {
        this.applet();
    }

    protected async applet(): Promise<string> {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson<string>("/common/thiscontract");
        this.cachedApplet = appletName;
        return appletName;
    }

    public async getAppletName(): Promise<string> {
        return this.applet();
    }

    public async getAppletId(): Promise<AppletId> {
        const appletName = await this.getAppletName();
        return new AppletId(appletName);
    }
}

export type UploadFileParam = {
    name: string;
    type: string;
    contentHex: string;
};

export class PsiSpaceContract extends Contract {
    public async actionUpload(path = "/", files: UploadFileParam[]) {
        // Todo: Maybe convert to Promise.all?
        for (const f of files) {
            await action("psispace-sys", "storeSys", {
                path: path + f.name,
                contentType: f.type,
                content: f.contentHex,
            });
        }
    }
}

export const psiSpaceContract = new PsiSpaceContract();
