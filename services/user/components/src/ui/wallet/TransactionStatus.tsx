import React from "react";
import { Card } from "../Card";
import Button from "../Button";
import Glyph from "../Glyph";

type TransactionStatusType = "success" | "failed";

export interface TransactionStatusProps {
    type: TransactionStatusType;
    children: React.ReactNode;
    onCloseClick: () => void;
}

const TransactionStatus = ({
    type,
    children,
    onCloseClick,
}: TransactionStatusProps) => {
    const success = type === "success";
    return (
        <div className="h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="my-0 mx-2 text-center">
                    <div className="my-4">
                        {success ? (
                            <Glyph
                                color="text-white"
                                bgColor="bg-green-500"
                                hex
                                size="xl"
                                icon="check"
                                isStatic
                            />
                        ) : (
                            <Glyph
                                color="text-white"
                                bgColor="bg-red-500"
                                hex
                                size="xl"
                                icon="x"
                                isStatic
                            />
                        )}
                    </div>
                    <p className="mb-0 font-bold">
                        {success ? "Success" : "Failed"}
                    </p>
                    <p className="text-sm text-gray-400">
                        08 March 2022 / 11:11:04 UTC
                    </p>
                    <div className="mt-2 mb-4">
                        <Glyph
                            color="text-black"
                            bgColor="bg-gray-200"
                            hex
                            size="lg"
                            icon="send"
                            isStatic
                        />
                    </div>
                    {children}
                    <div className="my-6">
                        <Button
                            type="primary"
                            fullWidth
                            size="lg"
                            onClick={() => onCloseClick()}
                        >
                            Close
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default TransactionStatus;
