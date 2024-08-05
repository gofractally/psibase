import { Schema, UrlForm } from "../../components/forms/url";
import { useToast } from "../../components/ui/use-toast";
import { useConnect } from "../../hooks/useConnect";
import { queryClient } from "../../main";
import { queryKeys } from "@/lib/queryKeys";

interface Props {
    onConnection: (endpoint: string) => void;
}

export const SmartConnectForm = ({ onConnection }: Props) => {
    const { mutateAsync: connect } = useConnect();
    const { toast } = useToast();

    const onSubmit = async (data: Schema) => {
        const res = await connect(data);
        queryClient.invalidateQueries({ queryKey: queryKeys.config });
        queryClient.setQueryData(queryKeys.peers, () => res.peers);
        toast({
            title: "Success",
            description: `Connected to ${
                res.newPeer.url || res.newPeer.endpoint
            }.`,
        });
        onConnection(res.newPeer.endpoint);
    };

    return <UrlForm onSubmit={onSubmit} />;
};
