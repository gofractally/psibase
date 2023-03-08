import React from "react";
import { Card } from "../index";
import Button from "../Button";

import Icon from "../Icon";
import EmptyProfilePic from "../assets/empty-profile-pic.svg";
import "../../styles/wallet.css";

export interface AccountProps {
    username: string;
    publicKey: string;
}

export const Account = ({ username, publicKey }: AccountProps) => {
    return (
        <div className="Account h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="Container">
                    <div className="my-0 mx-2 text-center">
                        <p className="mb-6 font-semibold text-gray-400">
                            My accounts
                        </p>
                        <div className="mb-6">
                            <EmptyProfilePic />
                            <Icon
                                type="edit"
                                size="sm"
                                className="Icon EditIconAvatar"
                            />
                        </div>
                        <p className="mb-6">
                            <b>Username:</b> {username}{" "}
                            <Icon type="edit" size="sm" className="Icon" />
                        </p>
                        <p className="mb-6">
                            <b>Profile:</b>{" "}
                            <span className="text-gray-400">(empty)</span>
                            <Icon type="edit" size="sm" className="Icon" />
                        </p>
                        <div className="mb-6">
                            <p className="mb-1">
                                <b>Account:</b>
                            </p>
                            <p className="mb-1 break-all text-sm">
                                {publicKey}
                            </p>
                            <p>
                                <Icon
                                    type="copy"
                                    size="base"
                                    className="Icon"
                                />
                            </p>
                        </div>
                        <div>
                            <Button type="secondary" fullWidth size="lg">
                                Done
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default Account;
