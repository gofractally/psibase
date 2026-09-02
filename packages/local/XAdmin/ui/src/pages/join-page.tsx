import { useNavigate } from "react-router-dom";

import { useToast } from "@/components/ui/use-toast";

import { Schema, UrlForm } from "@/components/forms/url";

import { useConnect } from "../hooks/use-connect";
import { SetupWrapper } from "./setup-wrapper";

export const JoinPage = () => {
    const { mutateAsync: connect } = useConnect();

    const navigate = useNavigate();
    const { toast } = useToast();

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        toast({
            title: "Success",
            description: `Connected to ${res.urls[0] || res.endpoint}.`,
        });
        navigate("/");
    };

    return (
        <SetupWrapper>
            <div className="mx-auto w-full max-w-xl px-4">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Join a network
                </h1>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    Connect to a psibase compatible node to join a network.
                </p>
                <div className="mt-6">
                    <UrlForm
                        onSubmit={onSubmit}
                        onBack={() => navigate("/setup")}
                    />
                </div>
            </div>
        </SetupWrapper>
    );
};
