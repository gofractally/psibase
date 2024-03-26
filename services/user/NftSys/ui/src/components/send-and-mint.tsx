import { useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";

import { Nft } from "../App";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";

type TransferInputs = {
    nftId: string;
    to: string;
};

interface Props {
    nfts: Nft[];
    mintNft: () => Promise<void>;
    resMint: string;
}

export const SendMintNft = ({ nfts, mintNft, resMint }: Props) => {
    const [_transferError, setTransferError] = useState("");
    const [_formSubmitted, setFormSubmitted] = useState(false);
    // const [manualDebitMode, setManualDebitMode] = useState(false);

    // const [transferHistoryResult, invalidateTransferHistoryQuery] =
    //     useTransferHistory(userName);
    // const [debitModeResult, invalidateDebitModeQuery] =
    //     useUserDebitModeConf(userName);
    // const [balancesResult, invalidateBalancesQuery] = useUserBalances(userName);
    // const [sharedBalancesResult, invalidateSharedBalancesQuery] =
    //     useSharedBalances();

    // const refetchData = async () => {
    //     await wait(2000);
    //     invalidateTransferHistoryQuery();
    //     invalidateBalancesQuery();
    //     invalidateSharedBalancesQuery();
    // };

    const form = useForm<TransferInputs>({
        defaultValues: {
            nftId: "",
            to: "",
        },
    });

    const onSubmit: SubmitHandler<TransferInputs> = async (
        data: TransferInputs,
    ) => {
        setTransferError("");
        setFormSubmitted(true);
        try {
            // await transfer(data);
            console.log(data);
            alert("transfer mocked success");
            form.reset();
        } catch (e) {
            if (
                Array.isArray(e) &&
                typeof e[0] === "string" &&
                e[0].includes("Invalid account")
            ) {
                form.setError("to", { message: "Invalid account" });
            } else {
                console.error("TRANSFER ERROR", e);
                setTransferError(`${e}`);
            }
        }
        // await refetchData();
        setFormSubmitted(false);
    };

    const liquidNfts = nfts.filter((nft) => nft.status === "owned");

    return (
        <Tabs defaultValue="send" className="w-[400px]">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="send">Send</TabsTrigger>
                <TabsTrigger value="mint">Mint</TabsTrigger>
            </TabsList>
            <TabsContent value="send">
                <Card>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)}>
                            <CardHeader>
                                <CardTitle>Send an NFT</CardTitle>
                                <CardDescription>
                                    Send one of your NFTs to another account.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <FormField
                                    control={form.control}
                                    name="nftId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>NFT ID</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {liquidNfts.map((nft) => (
                                                        <SelectItem
                                                            value={nft.id.toString()}
                                                            key={`option-${nft.id}`}
                                                        >
                                                            {nft.id}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage>
                                                {
                                                    form.formState.errors.nftId
                                                        ?.message
                                                }
                                            </FormMessage>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="to"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>To</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormDescription>
                                                Account to send the NFT to
                                            </FormDescription>
                                            <FormMessage>
                                                {
                                                    form.formState.errors.to
                                                        ?.message
                                                }
                                            </FormMessage>
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                            <CardFooter>
                                <Button type="submit">Send</Button>
                            </CardFooter>
                        </form>
                    </Form>
                </Card>
            </TabsContent>
            <TabsContent value="mint">
                <Card>
                    <CardHeader>
                        <CardTitle>Mint a new NFT</CardTitle>
                        <CardDescription>
                            Create a new NFT on the Psibase blockchain.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {resMint ? (
                            <pre>{JSON.stringify(resMint, null, 2)}</pre>
                        ) : null}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={mintNft}>
                            Mintnpx shadcn-ui@latest add form
                        </Button>
                    </CardFooter>
                </Card>
            </TabsContent>
        </Tabs>
    );
};

export default SendMintNft;
