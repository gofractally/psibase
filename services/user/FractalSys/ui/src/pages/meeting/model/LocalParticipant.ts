import { v4 as uuid } from "uuid";

import { getDebugMessages, P2PComms } from "../helpers";
import { UserData } from "../types";

const videoConstraints = {
    width: {
        min: 256,
        max: 640,
    },
    height: {
        min: 144,
        max: 480,
    },
    facingMode: { ideal: "user" },
};

const [debugMessages, addDebugMessage] = getDebugMessages();

export class LocalParticipant {
    static localParticipant: LocalParticipant;
    static get(): LocalParticipant {
        if (!LocalParticipant.localParticipant) {
            addDebugMessage("instantiating LocalParticipant");
            LocalParticipant.localParticipant = new LocalParticipant();
        }
        return LocalParticipant.localParticipant;
    }

    participantId = uuid();
    localStream: MediaStream | undefined;
    peerUserData?: UserData;
    isLocal = true;
    pReady: Promise<any>;
    resolveReady;
    initializing: boolean = false;
    initialized: boolean = false;

    constructor() {
        this.pReady = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
        });
    }

    isInitializing() {
        return this.initializing;
    }
    isReady() {
        return this.initialized;
    }
    ready() {
        return this.pReady;
    }

    async init(user?: UserData) {
        this.initializing = true;
        this.peerUserData = user;
        if (!this.localStream) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints,
                    audio: true,
                });
                this.localStream = stream;
            } catch (err) {
                console.error("No local video stream available. err:");
                console.error(err);
            }
        }
        this.initialized = true;
        this.initializing = false;
        this.resolveReady();
        return Object.assign({}, this);
    }

    set userMetaData(newUserInfo: UserData | undefined) {
        if (!newUserInfo) return;
        if (!P2PComms.broadcastUserMetaData) {
            console.warn(
                "failed to broadcast user metadata because broadcast method not yet defined."
            );
            return;
        }
        this.peerUserData = {
            ...newUserInfo,
            participantId: LocalParticipant.get().participantId,
        };
        P2PComms.broadcastUserMetaData(newUserInfo);
    }

    get stream(): MediaStream {
        if (!this.initialized)
            console.warn(
                "stream being requested before LocalPeer has been initialized"
            );
        return this.localStream!;
    }
}

export default {
    LocalParticipant,
};
