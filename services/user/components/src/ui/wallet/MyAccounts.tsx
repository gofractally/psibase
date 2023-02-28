import React from "react";
import { Avatar, Button, Card, Icon } from "..";

import "../../styles/wallet.css";

export const MyAccounts = () => {
    return (
        <div className="Account h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="mx-auto w-96 text-center">
                    <div className="mb-6 font-semibold text-gray-400">
                        My accounts
                    </div>
                    <div className="flex justify-center">
                        <Avatar />
                    </div>
                    <div className="mb-4 font-semibold">gold</div>
                    <div className="mb-4">
                        <Button type="outline" size="sm">
                            Manage account
                        </Button>
                    </div>
                    <div className="mb-4 cursor-pointer text-sm">
                        <div className="flex flex-row items-center justify-between border-b border-gray-100 px-6 pt-3 pb-2 hover:bg-gray-50">
                            <div className="flex flex-row items-center gap-4">
                                <Avatar size="sm" shape="hex" />
                                <div className="font-bold">gold</div>
                            </div>
                            <div className="flex space-x-6">
                                <Icon type="signOut" size="sm" />
                                <Icon type="trash" size="sm" />
                            </div>
                        </div>
                        <div className="flex flex-row items-center justify-between border-b border-gray-100 px-6 pt-3 pb-2 hover:bg-gray-50">
                            <div className="flex flex-row items-center gap-4">
                                <Avatar size="sm" shape="hex" />
                                <div>FRA7HR8ZCTnE...YEUjUNstUPz1</div>
                            </div>
                            <div className="flex space-x-6">
                                <Icon type="signOut" size="sm" />
                                <Icon type="trash" size="sm" />
                            </div>
                        </div>
                        <div className="flex flex-row items-center justify-between border-b border-gray-100 px-6 pt-3 pb-2 hover:bg-gray-50">
                            <div className="flex flex-row items-center gap-4">
                                <Avatar size="sm" shape="hex" />
                                <div>hexabite7</div>
                            </div>
                            <div className="flex space-x-6">
                                <Icon type="signOut" size="sm" />
                                <Icon type="trash" size="sm" />
                            </div>
                        </div>
                    </div>
                    <div className="mx-6 mt-8 flex gap-2">
                        <Button type="outline" fullWidth size="sm">
                            Create account
                        </Button>
                        <Button type="secondary" fullWidth size="sm">
                            Add account
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default MyAccounts;
