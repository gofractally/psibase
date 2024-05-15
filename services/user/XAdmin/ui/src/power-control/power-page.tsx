import { postJson } from "@psibase/common-lib";
import { Button } from "../components";
import { Divider } from "../components/divider";

export const PowerPage = () => {
    return (
        <>
            <h1>Shutdown</h1>
            <Button
                className="mt-4"
                onClick={() => postJson("/native/admin/shutdown", {})}
            >
                Shutdown
            </Button>
            <Divider />
            <h1>Restart</h1>
            <Button
                className="mt-4"
                onClick={() =>
                    postJson("/native/admin/shutdown", { restart: true })
                }
            >
                Restart
            </Button>
        </>
    );
};
