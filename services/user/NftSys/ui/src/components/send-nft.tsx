import { useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { Text } from "@psibase/components";

import Button from "./button";
import Form from "./form";
import { Nft } from "../App";

type TransferInputs = {
    nftId: string;
    to: string;
};

export const SendNftSection = ({ nfts }: { nfts: Nft[] }) => {
    const [transferError, setTransferError] = useState("");
    const [formSubmitted, setFormSubmitted] = useState(false);
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

    const {
        register,
        handleSubmit,
        formState: { errors },
        setError,
        reset,
    } = useForm<TransferInputs>({
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
            alert("transfer mocked success");
            reset();
        } catch (e) {
            if (
                Array.isArray(e) &&
                typeof e[0] === "string" &&
                e[0].includes("Invalid account")
            ) {
                setError("to", { message: "Invalid account" });
            } else {
                console.error("TRANSFER ERROR", e);
                setTransferError(`${e}`);
            }
        }
        // await refetchData();
        setFormSubmitted(false);
    };

    const liquidNfts = nfts.filter((nft) => nft.status === "owned");

    const nftOptions =
        liquidNfts.length > 0 ? (
            liquidNfts.map((nft) => (
                <option value={nft.id} key={nft.id}>
                    {nft.id}
                </option>
            ))
        ) : (
            <option key="no-nfts" disabled>
                No available NFTs
            </option>
        );

    return (
        <form className="bg-gray-100 p-3" onSubmit={handleSubmit(onSubmit)}>
            <div className="mb-4 flex h-10 w-24 select-none items-center justify-center gap-1.5 border-b border-gray-500">
                {/* <Icon type="arrow-up" size="xs" /> */}
                <Text span className="font-semibold" size="base">
                    Send
                </Text>
            </div>
            <div className="flex w-full flex-col gap-3 lg:flex-row">
                <div className="flex-1">
                    <Form.Select
                        label="NFT ID"
                        {...register("nftId", {
                            required: "This field is required",
                        })}
                        errorText={errors.nftId?.message}
                    >
                        {nftOptions}
                    </Form.Select>
                </div>
                <div className="flex-1">
                    <Form.Input
                        label="To"
                        placeholder="Recipient account"
                        {...register("to", {
                            required: "This field is required",
                        })}
                        errorText={errors.to?.message}
                    />
                </div>
            </div>
            <div className="mt-7">
                {transferError ? (
                    <Text className="font-medium text-red-600">
                        There was an error. Your transfer may not have been
                        successful. Refresh the page to check your NFT list and
                        try again if necessary.
                    </Text>
                ) : (
                    <Button
                        type="outline"
                        size="lg"
                        isSubmit
                        isLoading={formSubmitted}
                        disabled={formSubmitted}
                        className="w-48"
                    >
                        Send
                    </Button>
                )}
            </div>
        </form>
    );
};

export default SendNftSection;
