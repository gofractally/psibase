import { useNavigate } from "react-router-dom";

import { useToast } from "@/components/ui/use-toast";

import { Schema, UrlForm } from "@/components/forms/url";

import { useConnect } from "../hooks/useConnect";
import { SetupWrapper } from "./setup-wrapper";

export const JoinPage = () => {
    const { mutateAsync: connect } = useConnect();

    const navigate = useNavigate();
    const { toast } = useToast();

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        toast({
            title: "Success",
            description: `Connected to ${
                res.newPeer.url || res.newPeer.endpoint
            }.`,
        });
        navigate("/");
    };

    return (
        <SetupWrapper>
            <div className="mx-auto h-full w-full  max-w-screen-lg  flex-col gap-3">
                <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
                    Join
                </h1>{" "}
                <p className="text-muted-foreground mt-3 leading-7">
                    Connect to a psibase compatible node to join a network.
                </p>
                <div>
                    <UrlForm onSubmit={onSubmit} />
                </div>
            </div>
        </SetupWrapper>
    );
};
