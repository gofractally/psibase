import { Schema, UrlForm } from "../../components/forms/url";
import { useToast } from "../../components/ui/use-toast";
import { useConnect } from "../../hooks/use-connect";

interface Props {
    onConnection: () => void;
}

export const SmartConnectForm = ({ onConnection }: Props) => {
    const { mutateAsync: connect } = useConnect();
    const { toast } = useToast();

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        toast({
            title: "Success",
            description: `Connected to ${res.urls[0] || res.endpoint}.`,
        });
        onConnection();
    };

    return <UrlForm onSubmit={onSubmit} />;
};
