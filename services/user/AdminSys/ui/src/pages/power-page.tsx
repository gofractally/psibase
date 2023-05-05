import { postJson } from "common/rpc.mjs";
import { Button } from "../components";

export const PowerPage = () => {
    return (
        <>
            <Button onClick={() => postJson("/native/admin/shutdown", {})}>
                Shutdown
            </Button>
            <Button
                onClick={() =>
                    postJson("/native/admin/shutdown", { restart: true })
                }
            >
                Restart
            </Button>
        </>
    );
};
