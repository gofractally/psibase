import { postJson } from "@psibase/common-lib";
import { useState } from "react";
import { SubmitHandler, useForm, Controller } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { PsinodeConfig } from "../configuration/interfaces";
import { putJson } from "../helpers";
import {
    AddConnectionInputs,
    ConnectInputs,
    isConfigured,
    isConnected,
    Peer,
    PeerSpec,
    PeerState,
} from "./interfaces";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfig } from "../hooks/useConfig";
import { usePeers } from "../hooks/usePeers";

export const PeersPage = () => {
    const {
        data: peers,
        error: peersError,
        refetch: refetchPeers,
    } = usePeers();

    const { data: config, refetch: refetchConfig } = useConfig();

    const [configPeersError, setConfigPeersError] = useState<string>();

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        control,
    } = useForm<AddConnectionInputs>({
        defaultValues: {
            url: "",
            state: "transient",
        },
    });

    const onDisconnect = async (id: number) => {
        try {
            await postJson("/native/admin/disconnect", { id: id });
            refetchPeers();
        } catch (e) {
            console.error("DISCONNECT ERROR", e);
        }
    };

    const onConnect: SubmitHandler<ConnectInputs> = async (
        endpoint: ConnectInputs
    ) => {
        try {
            console.log(endpoint, "is the endpoint");
            await postJson("/native/admin/connect", endpoint);
            reset();
            refetchPeers();
        } catch (e) {
            console.error("CONNECT ERROR", e);
        }
    };

    const setConfigPeers = async (input: PsinodeConfig) => {
        try {
            setConfigPeersError(undefined);
            const result = await putJson("/native/admin/config", input);
            if (result.ok) {
                // TODO: revisit
                // configForm.resetField("peers", { defaultValue: input.peers });
                refetchConfig();
            } else {
                setConfigPeersError(await result.text());
            }
        } catch (e) {
            setConfigPeersError("Failed to write /native/admin/config");
        }
    };

    const modifyPeer = (
        id: number,
        url: string,
        oldState: PeerState,
        state: PeerState
    ) => {
        if (!config) {
            setConfigPeersError("Unable to load config");
            return;
        }
        if (!isConfigured(oldState) && isConfigured(state)) {
            // TODO: revisit
            // const oldConfig = configForm.formState
            //     .defaultValues as PsinodeConfig;
            // setConfigPeers({ ...oldConfig, peers: [...config.peers, url] });
            setConfigPeers({ ...config, peers: [...config.peers, url] });
        } else if (isConfigured(oldState) && !isConfigured(state)) {
            // TODO: revisit
            // const oldConfig = configForm.formState
            //     .defaultValues as PsinodeConfig;
            // setConfigPeers({
            //     ...oldConfig,
            //     peers: oldConfig.peers.filter((p) => p != url),
            // });
            setConfigPeers({
                ...config,
                peers: config.peers.filter((p) => p != url),
            });
        }

        if (!isConnected(oldState) && isConnected(state)) {
            onConnect({ url: url });
        } else if (isConnected(oldState) && !isConnected(state)) {
            onDisconnect(id);
        }
    };

    const onAddConnection = (input: AddConnectionInputs) => {
        modifyPeer(0, input.url, "disabled", input.state);
    };

    const peerControl = (id: number, url: string, state: PeerState) => {
        //const update = (e: any)=>modifyPeer(id, url, state, e.target.value);
        const setState = (newState: PeerState) =>
            modifyPeer(id, url, state, newState);
        if (state == "persistent") {
            return (
                <>
                    <Button onClick={() => setState("backup")}>
                        Disconnect
                    </Button>
                    <Button onClick={() => setState("transient")}>
                        Disable auto-connect
                    </Button>
                    <Button onClick={() => setState("disabled")}>Remove</Button>
                </>
            );
            /*
            return (<select onChange={update}>
                <option selected value="persistent">Connected+</option>
                <option value="backup">Disconnect</option>
                <option value="transient">Disable auto-connect</option>
                <option value="disabled">Remove</option>
                </select>); */
        } else if (state == "transient") {
            return (
                <>
                    <Button onClick={() => setState("disabled")}>
                        Disconnect
                    </Button>
                    <Button onClick={() => setState("persistent")}>
                        Enable auto-connect
                    </Button>
                </>
            );
            /*
            return (<select onChange={update}>
                <option selected value="transient">Connected</option>
                <option value="disabled">Disconnect</option>
                <option value="persistent" disabled={!url}>Enable auto-connect</option>
                </select>); */
        } else if (state == "backup") {
            return (
                <>
                    <Button onClick={() => setState("persistent")}>
                        Connect
                    </Button>
                    <Button onClick={() => setState("disabled")}>Remove</Button>
                </>
            );
            /*
            return (<select onChange={update}>
                <option selected value="backup">Not Connected</option>
                <option value="persistent">Connect</option>
                <option value="disabled">Remove</option>
                </select>); */
        }
    };

    const combinedPeers = combinePeers(config?.peers || [], peers || []);

    return (
        <>
            <h1>Peers</h1>
            <table>
                <thead>
                    <tr>
                        <th>URL</th>
                        <th>Address</th>
                    </tr>
                </thead>
                <tbody>
                    {combinedPeers.map((peer) => (
                        <tr key={peer.id}>
                            <td>{peer.url}</td>
                            <td>{peer.endpoint}</td>
                            <td>
                                {peerControl(peer.id, peer.url, peer.state)}
                            </td>
                        </tr>
                    ))}
                    <tr>
                        <td>
                            <form
                                onSubmit={handleSubmit(onAddConnection)}
                                id="new-connection"
                            >
                                <Input
                                    autoComplete="url"
                                    {...register("url", {
                                        required: "This field is required",
                                    })}
                                />
                                {errors.url?.message && (
                                    <Label>{errors.url?.message}</Label>
                                )}
                            </form>
                        </td>
                        <td>
                            <Controller
                                name="state"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value}
                                    >
                                        <SelectTrigger className="w-[280px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="transient">
                                                Connect now
                                            </SelectItem>
                                            <SelectItem value="persistent">
                                                Remember this connection
                                            </SelectItem>
                                            <SelectItem value="backup">
                                                Connect automatically
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </td>
                        <td>
                            <Button type="submit" form="new-connection">
                                Add Connection
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
            {configPeersError && <div>{configPeersError}</div>}
        </>
    );
};

const combinePeers = (configured: string[], connected: Peer[]): PeerSpec[] => {
    let configMap: { [index: string]: boolean } = {};
    for (const url of configured) {
        configMap[url] = true;
    }
    let connectMap: { [index: string]: Peer } = {};
    for (const peer of connected) {
        if (peer.url) {
            connectMap[peer.url] = peer;
        }
    }
    let result1 = configured.map((url) => {
        if (url in connectMap) {
            return {
                state: "persistent" as PeerState,
                url: url,
                ...connectMap[url],
            };
        } else {
            return {
                state: "backup" as PeerState,
                url: url,
                endpoint: "",
                id: 0,
            };
        }
    });
    let result2 = connected
        .filter((peer) => !peer.url || !(peer.url in configMap))
        .map((peer) => ({ state: "transient" as PeerState, url: "", ...peer }));
    return [...result1, ...result2];
};
