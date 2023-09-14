import { getJson, postJson, postArrayBuffer, postArrayBufferGetJson } from "common/rpc.mjs";
import { Button } from "../components";
import { Divider } from "../components/divider";
import React, { useState, useEffect } from 'react';
import * as wasm from 'wasm-psibase';

interface PowerPageProps {
    producer?: string;
}

export const PowerPage = ({producer} : PowerPageProps) => {

    const [bootResult, setBootResult] = useState<string>();
    const [booting, setBooting] = useState<boolean>(false);
    const [booted, setBooted] = useState(false);

    function onBoot(producer: string): (event: React.FormEvent) => void {
        return async (e : React.FormEvent) => {
            e.preventDefault();
            setBooting(true);

            try
            {
                // Something is wrong with the Vite proxy configuration that causes boot to intermittently (but often) fail
                // in a dev environment.
                let [boot_transactions, transactions] = wasm.js_create_boot_transactions(producer);
                await postArrayBuffer("/native/push_boot", Uint8Array.from(boot_transactions).buffer);
                let i = 0;
                for (const t of transactions) {
                    console.log(`Pushing transaction number: ${i}`);
                    await postArrayBufferGetJson("/native/push_transaction", Uint8Array.from(t).buffer);
                    i++;
                }

                setBootResult("Boot successful.");
            }
            catch(e)
            {
                setBooting(false);
                setBootResult("Boot failed.")
                console.error(e);
            }

        };
      }

      useEffect(() => {
        const fetchBootStatus = async () => {
            // Currently this method of detecting a booted chain does not distinguish from shutdown and unbooted.
            // Todo: add a `booted` flag to native/admin/status
            let config = await getJson("/native/admin/config");
            let {port, protocol} = window.location;
            let url = `${protocol}//${config.host}:${port}/common/rootdomain`;
            const isBooted : boolean = await getJson(url).then(()=>{return true}).catch(e => {
              return false;
            });
            setBooted(isBooted);
          };

          fetchBootStatus();

      }, []);

    return (
        <>
            <h1>First Boot</h1>
            <p>This is only used if you're booting a new network.<br />If you're joining an existing network, simply peer to others using the <a href="#Peers">Peers</a> page.</p>
            {!producer ? (
                <p>No producer name configured</p>
            ) : (

                <form onSubmit={onBoot(producer)}>
                    <h6>{`Producer name: ${producer}`}</h6>
                    <Button disabled={!producer || booting === true || booted === true} className="mt-4" isSubmit>
                        Boot
                    </Button>
                    {bootResult && <div>{bootResult}</div>}
                </form>
            )}
            <Divider />
            <h1>Shutdown</h1>
            <Button className="mt-4" onClick={() => postJson("/native/admin/shutdown", {})}>
                Shutdown
            </Button>
            <Divider />
            <h1>Restart</h1>
            <Button className="mt-4"
                onClick={() =>
                    postJson("/native/admin/shutdown", { restart: true })
                }
            >
                Restart
            </Button>
        </>
    );
};
