import { connect, Socket } from "socket.io-client";

import {
    getDebugMessages,
    isType,
    MessagePayload,
    P2PComms,
    RankUpdate,
    TrackUpdate,
    UPDATE_PEER_DATA,
    UPDATE_RANKS,
    UPDATE_TRACKS,
} from "../helpers";
import {
    AllUsersPayload,
    JoinRoomPayload,
    ParticipantID,
    ParticipantType,
    UserData,
} from "../types";
import { config } from "config";
import { LocalParticipant, RemoteParticipants } from ".";

// TODO: wrap this in a control class to encapsulate and manage access
export let socket: Socket;

export let coordinationServer: CoordinationServer;
let iceServerInfo: RTCIceServer[];
let pendingPeers = {};

const messagingServerURL = config.messagingServerURL;
const [debugMessages, addDebugMessage] = getDebugMessages();

interface CoordinationServerHandlers {
    handleRemoveVoter?: (participantId: string) => void;
    handleSocketConnect?: () => void;
    handleReceiveUpdatedUserData?: () => void;
    handlerReceiveUpdateTrackStatus?: (
        from: string,
        trackStatus: TrackUpdate
    ) => void;
    handleReceiveUpdatedRank?: (from: string, newRanks: RankUpdate) => void;
    handleParticipantDisconnect?: () => void;
    handleParticipantAdded?: () => void;
    handleReceiveUsersInRoomList?: () => void;
    handleReceiveRemoteStream?: () => void;
    handleParticipantDisconnected?: () => void;
}

export class CoordinationServer {
    static coordinationServer: CoordinationServer;
    static get(): CoordinationServer {
        if (!CoordinationServer.coordinationServer) {
            console.warn("coordinationServer instance not yet ready.");
        }
        return CoordinationServer.coordinationServer;
    }
    roomID: string;
    user: UserData;
    handlers: {
        handleRemoveVoter?: (participantId: string) => void;
        handleSocketConnect?: () => void;
        handleReceiveUpdatedUserData?: (
            from: string,
            peerUserData: UserData
        ) => void;
        handlerReceiveUpdateTrackStatus?: (
            from: string,
            trackStatus: TrackUpdate
        ) => void;
        handleReceiveUpdatedRank?: (from: string, newRanks: RankUpdate) => void;
        handleParticipantDisconnect?: (socketId: string) => void;
        handleParticipantAdded?: (peerID: string, peer: any) => void;
        handleReceiveUsersInRoomList?: (socketId: string, peer: any) => void;
        handleReceiveRemoteStream?: (
            callerID: string,
            peerStream: MediaStream
        ) => void;
        handleParticipantDisconnected?: (peerID: string) => void;
    } = {};

    constructor(_roomID: string, _user: UserData) {
        this.roomID = _roomID;
        this.user = _user;
        CoordinationServer.coordinationServer = this;
    }
    init() {
        if (!socket) {
            addDebugMessage(`Initing socket and joining room ${this.roomID}`);

            if (!messagingServerURL) {
                console.error(
                    "Missing .env-MESSAGING_SERVER=",
                    messagingServerURL
                );
            }

            socket = connect(messagingServerURL);

            socket.on("connect", () => this.onSocketConnect());

            socket.on("disconnect", () => this.onSocketDisconnect());

            socket.on("room full", () => alert("Room is full"));

            socket.on("connect_error", (err) => {
                console.error(`connect_error due to ${err.message}`);
            });

            socket.on("onicecandidate", (payload) => {
                console.info("socket.onicecandidate.payload:", payload);
            });

            socket.on("message from user", (payload: any) =>
                this.onMsgFromPeer(payload)
            );

            socket.on("all users", (payload: AllUsersPayload) =>
                this.onReceiveUserList(payload)
            );

            // TODO: Fix this type
            socket.on("user joined", (payload: any) =>
                this.onUserJoined(payload)
            );

            socket.on(
                "receiving returned signal",
                this.onReceiveReturnedSignal
            );

            socket.on("user left", (socketId: string) =>
                this.onUserLeft(socketId)
            );

            // TODO: figure out what to do with this. It was the useEffect cleanup function before this class got broken out.
            // return () => {
            //     console.count("Room.useEffect() !!! removing listeners");
            //     // TODO: Continue replacing these statements as refactor continues
            //     socket.removeAllListeners();
            //     // vvv replaced so far in class
            //     // socket.disconnect();
            //     // setSocket(undefined);
            //     // roomView.destroy();
            //     socket?.disconnect();
            // };
        } else {
            // TODO: what to do about reconnecting?
            // socket.connect();
        }
    }

    setHandlers(handlers: CoordinationServerHandlers) {
        this.handlers = {
            ...this.handlers,
            ...handlers,
        };
    }

    reportSocketError(prefix: string) {
        return (error: any) => {
            console.warn(prefix + ": " + JSON.stringify(error, null, 3));
            error.code === "ERR_DATA_CHANNEL" ??
                console.warn("It appears creating peer connection failed.");
        };
    }

    // TODO: Make this message handling P2P eventually, instead of using the signaling server for it
    onNewMessage(
        from: string,
        json: { type: string; payload: MessagePayload }
    ) {
        addDebugMessage(`onNewMessage(from[${from}], type[${json.type}])`);
        if (isType<UserData>(UPDATE_PEER_DATA, json)) {
            const peerUserData = json.payload;
            const participantBeingUpdated =
                RemoteParticipants.get().getParticipant(from);
            const remoteParticipants = RemoteParticipants.get();
            // do we already have someone with this uuid?
            const existingParticipantWithSameId = remoteParticipants
                .asArray()
                .find((p) => p.participantId === json.payload.participantId);
            // If there are two peers with the same participantId but different socketIds, kill the older of the two (the one with the non-matching socketId)
            if (
                existingParticipantWithSameId &&
                participantBeingUpdated &&
                existingParticipantWithSameId.socketId !==
                    participantBeingUpdated.socketId
            ) {
                console.warn(
                    "Multiple peers with same uuid; killing stale peer."
                );
                // TODO: remove after confirmation
                alert(
                    "Pls tell Mike: Multiple peers with same uuid just happened; killed stale peer."
                );
                remoteParticipants.removeParticipant(
                    existingParticipantWithSameId.socketId
                );
            }

            RemoteParticipants.get().updateParticipant(from, {
                ...participantBeingUpdated!,
                participantId: peerUserData.participantId,
                socketId: from,
                peerUserData,
            });
            if (this.handlers.handleReceiveUpdatedUserData)
                this.handlers.handleReceiveUpdatedUserData(from, peerUserData);
        } else if (isType<RankUpdate>(UPDATE_RANKS, json)) {
            this.onRankUpdate({ from, newRanks: json.payload });
        } else if (isType<TrackUpdate>(UPDATE_TRACKS, json)) {
            console.info("TRACK_UPDATE.json:", json);
            if (this.handlers.handlerReceiveUpdateTrackStatus)
                this.handlers.handlerReceiveUpdateTrackStatus(
                    from,
                    json.payload as TrackUpdate
                );
        } else {
            throw new Error(
                `Unrecognised event type ${json.type} with payload ${json.payload} received.`
            );
        }
    }
    onPeerConnect(peer) {
        console.log("EVT|connect peer:", peer);
        // peer is only defined here for person newly joining a meeting, not for existing user
        if (peer) {
            // Stash peer purely for signaling (which happens before remotePeer gets into globalStore)
            pendingPeers[peer.id] = peer;
        } else {
            console.info("onPeerConnect().peer === undefined; not storing.");
        }
    }
    onPeerClosed(calledLocation: string, peerID: any) {
        return () => {
            addDebugMessage(
                `onPeerClosed(${calledLocation}).peerID: ${peerID}`
            );
            if (this.handlers.handleParticipantDisconnected)
                this.handlers.handleParticipantDisconnected(peerID);
            RemoteParticipants.get().removeParticipant(peerID);
            addDebugMessage(
                `EVT|close in ${calledLocation}; peerID[${peerID}] destroyed`
            );
        };
    }
    onMsgFromPeer(payload) {
        addDebugMessage("sckt|EVT|message from user:");
        addDebugMessage(payload);
        this.onNewMessage(payload.from, JSON.parse(payload.message));
    }
    onUserLeft(socketId) {
        addDebugMessage("sckt|EVT|user left");
        // TODO: Why is there a slew of "user left" messages in the console *before* peers get connected?
        this.disconnectRemotePeer(socketId);
        this.onUserDisconnect(socketId);
    }
    onReceiveUserList(payload: AllUsersPayload) {
        addDebugMessage(`sckt|EVT|all users| payload: `);
        addDebugMessage(JSON.stringify(payload));
        const { usersInRoom: existingParticipants, iceServers } = payload;
        iceServerInfo = iceServers;
        if (existingParticipants.length)
            addDebugMessage("Dialing everyone because we're in p2p mode");
        existingParticipants.forEach(async (userInRoom) => {
            await LocalParticipant.get().ready();

            // stash peer for signaling
            pendingPeers[userInRoom.socketId] = this.initiatePeerConnection(
                socket,
                userInRoom.socketId,
                socket.id,
                LocalParticipant.get().stream
            );
            RemoteParticipants.get().addParticipant(
                userInRoom.socketId,
                pendingPeers[userInRoom.socketId]
            );
            // TODO: move this back to the hook and have the hook pass this method a handler for this event
            if (this.handlers.handleReceiveUsersInRoomList)
                this.handlers.handleReceiveUsersInRoomList(
                    userInRoom.socketId,
                    pendingPeers[userInRoom.socketId]
                );
        });
    }

    async onUserJoined(payload) {
        addDebugMessage("sckt|EVT|user joined");
        addDebugMessage(payload);
        const peerID = payload.callerID;

        // @ts-ignore
        await LocalParticipant.get().ready();
        const stream = LocalParticipant.get().stream;
        addDebugMessage(`New user joined ${peerID}`);
        const peer = this.respondToAndCreatePeerConnection(
            socket,
            payload,
            stream
        );
        RemoteParticipants.get().addParticipant(peerID, peer);
        addDebugMessage(`Ready to accept a call from ${peerID}`);
        if (this.handlers.handleParticipantAdded)
            this.handlers.handleParticipantAdded(peerID, peer);
    }

    onReceiveReturnedSignal(payload) {
        addDebugMessage(
            `sckt|EVT|receiving returned signal| received peer connection green light towards.payload:`
        );
        addDebugMessage(payload);
        pendingPeers[payload.id].signal(payload.signal);
    }

    async onSocketConnect() {
        addDebugMessage("onSocketConnect().top");
        if (!this.roomID || !socket?.id) return;

        const joinRoom = (payload: JoinRoomPayload) => {
            addDebugMessage("EMIT|join room| payload:");
            addDebugMessage(JSON.stringify(payload));
            socket.emit("join room", payload);
            if (this.handlers.handleSocketConnect)
                this.handlers.handleSocketConnect();
        };
        joinRoom({ roomID: this.roomID });
    }
    onSocketDisconnect() {
        // TODO: anything to do here?
    }
    disconnectRemotePeer(socketId: string) {
        addDebugMessage(`disconnectRemotePeer(${socketId}).top`);

        const relevantPeer =
            RemoteParticipants.get().getParticipant(socketId)?.peer;

        if (relevantPeer) {
            addDebugMessage(`found peer object for ${socketId}`);

            // TODO: make this work (and refactor to share this code with TODO above that does the same thing when all clients disconnect)
            // const relevantStream = streams.find((stream) => stream.peerID === socketId);
            // if (relevantStream) {
            //     relevantStream.stream?.getTracks().forEach((track) => track.stop());
            //     streams = streams.filter(isNotThisPeer(socketId));
            //     setStreams(streams);
            // }

            try {
                relevantPeer.destroy();
            } catch (e) {
                console.warn("threw in peer.destroy", e);
                // TODO: cleanup to be done here?
                // setPeers((peers) => peers.filter(isNotThisPeer(socketId)));
                // delete peers[socketId];
            }
            RemoteParticipants.get().removeParticipant(socketId);
            if (this.handlers.handleParticipantDisconnect)
                this.handlers.handleParticipantDisconnect(socketId);
        } else {
            addDebugMessage(
                `user ${socketId} left but failed to find them in the peers ref array`
            );
        }
    }
    onUserDisconnect(socketId: string) {
        addDebugMessage("EVT|onUserDisconnect");
        if (this.handlers.handleRemoveVoter)
            this.handlers.handleRemoveVoter(socketId);
    }
    onRankUpdate({ from, newRanks }: { from: string; newRanks: RankUpdate }) {
        if (this.handlers.handleReceiveUpdatedRank)
            this.handlers.handleReceiveUpdatedRank(from, newRanks);
    }
    initiatePeerConnection(
        skt: Socket,
        userToSignal: ParticipantID,
        callerID: ParticipantID,
        localStream: any
    ): ParticipantType {
        const peer = new window.Peer({
            initiator: true,
            trickle: false,
            stream: localStream,
            config: { iceServers: iceServerInfo },
        });
        peer.on("error", this.reportSocketError("initiatePeerConnection"));
        // @ts-ignore
        peer.on("signal", (signal) => {
            addDebugMessage(
                `EVT|signal onSignal().callerID[${callerID}], userToSignal[${userToSignal}]`
            );
            // Initiator Step 2: signal peer
            const signalPayload = {
                userToSignal,
                callerID,
                signal,
                iceServers: iceServerInfo,
            };
            peer.id = userToSignal;
            addDebugMessage(`EMIT|sending signal}`);
            skt.emit("sending signal", signalPayload);
        });
        peer.on("onicecandidate", (payload) => {
            addDebugMessage("EVT|onicecandidate");
        });
        peer.on("connect", () => {
            this.onPeerConnect(peer);
        });

        peer.on("stream", this.wireUpNewIncomingStream(userToSignal));

        peer.on(
            "close",
            this.onPeerClosed("initiatePeerConnection()", userToSignal)
        );
        return peer;
    }
    respondToAndCreatePeerConnection(
        skt: Socket,
        payload: any,
        myStream: MediaStream
    ): any {
        const { callerID, signal: incomingSignal } = payload;
        const peer = new window.Peer({
            initiator: false,
            trickle: false,
            stream: myStream,
            config: { iceServers: iceServerInfo },
        });

        // setup to listen to peer
        peer.on(
            "error",
            this.reportSocketError("respondToAndCreatePeerConnection")
        );
        peer.on("connect", this.onPeerConnect);
        peer.on("stream", this.wireUpNewIncomingStream(callerID));
        peer.on(
            "close",
            this.onPeerClosed("respondToAndCreatePeerConnection()", callerID)
        );
        peer.on("onicecandidate", (payload) => {
            addDebugMessage("EVT|onicecandidate");
        });

        peer.on("signal", (signal: any) => {
            addDebugMessage(
                `EVT|signal Received a call from ${callerID} and returning signal.`
            );
            // Respond to new joiner Step 2: respond to call
            addDebugMessage(
                `EMIT|returning signal| payload: ${JSON.stringify({
                    signal,
                    callerID,
                })}`
            );
            skt.emit("returning signal", { signal, callerID });
        });
        peer.signal(incomingSignal);
        return peer;
    }
    wireUpNewIncomingStream(callerID: string) {
        return async (peerStream: MediaStream) => {
            addDebugMessage(
                `EVT | stream incoming from ${callerID} ${new Date()}`
            );
            RemoteParticipants.get().updateParticipant(callerID, {
                stream: peerStream,
            } as ParticipantType);

            if (this.handlers.handleReceiveRemoteStream)
                this.handlers.handleReceiveRemoteStream(callerID, peerStream);

            // Clear stashed peer now that we're connected
            delete pendingPeers[callerID];

            const localParticipant = LocalParticipant.get();
            await localParticipant.ready();
            if (localParticipant.peerUserData) {
                P2PComms.sendMessage(callerID, {
                    type: UPDATE_PEER_DATA,
                    payload: localParticipant.peerUserData,
                });
            } else {
                console.info(
                    "local Peer user data was not found, therefore failed to send."
                );
            }
        };
    }
}

export default {
    CoordinationServer,
};
