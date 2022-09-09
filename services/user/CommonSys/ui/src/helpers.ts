import { AppletId, getTaposForHeadBlock } from "common/rpc.mjs";

import { appletPrefix } from "./config";

export const getIframeId = (appletId: AppletId) => {
    // Do more than one iFrame of the same appletStr/subPath ever need to be opened simultaneously?
    //    If so, this method needs to change to add a refCount to the ID or something, to ensure the IDs
    //    are unique.
    return "applet_" + appletId.name + "_" + appletId.subPath;
};

export const constructTransaction = async (actions: any) => {
    let tenMinutes = 10 * 60 * 1000;
    var trans = JSON.parse(
        JSON.stringify(
            {
                tapos: {
                    ...(await getTaposForHeadBlock()),
                    expiration: new Date(Date.now() + tenMinutes),
                },
                actions,
            },
            null,
            4
        )
    );

    return trans;
};

export function getAppletInURL() {
    const pathname = window.location.pathname;
    var fullPath = pathname.substring(appletPrefix.length);
    return AppletId.fromFullPath(fullPath);
}

export function makeAction(
    application: string,
    actionName: string,
    params: any,
    sender: any
) {
    return { service: application, method: actionName, data: params, sender };
}

export const injectSender = (transaction: any[], sender: any) => {
    transaction.forEach((action) => {
        if (action.sender === null) {
            action.sender = sender;
        }
    });
    return transaction;
};

export class ClientOps {
    static currentOps: AppletId[] = [];

    static add(receiver: AppletId) {
        this.currentOps = this.currentOps.concat([receiver]);
    }

    static allCompleted() {
        // TODO this should search the data structure to see if any are awaiting return
        return this.currentOps.length === 0;
    }

    static opReturned(sender: AppletId) {
        let idx = this.currentOps.findIndex((op) => op.equals(sender));

        if (idx !== -1) {
            this.currentOps.splice(idx, 1);
        } else {
            throw "Applet tried to stop an operation it never started";
        }
    }
}
