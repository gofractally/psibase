import React from "react";

import Icon from "../Icon";
import Button from "../Button";
import Card from "../Card";
import { Input } from "../Form";
import Banner from "../assets/profile-banner-1.svg";

export const AddUserName = () => {
    return (
        <div className="AddUserName h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="Container">
                    <div className="my-0 text-center">
                        <div className="mb-5">
                            <Banner />
                        </div>
                        <p className="mb-5 text-2xl font-bold">Username</p>
                        <p className="mb-5">
                            Add a username to your account. This name can be
                            changed at any time.
                        </p>
                        <div className="mb-5 text-left">
                            <Input id="username" label="Username" />
                            <label className="text-sm text-red-500">
                                Username not available
                            </label>
                        </div>
                        <p className="mb-5">
                            Name fee:{" "}
                            <span className="text-gray-300">
                                0.001 PRIME &nbsp;{" "}
                                <Icon
                                    type="info"
                                    size="sm"
                                    className="inline align-text-top text-gray-400"
                                />
                            </span>
                        </p>
                        <div className="mt-8 mb-4 flex gap-2">
                            <Button type="outline" fullWidth size="lg">
                                Cancel
                            </Button>
                            <Button type="secondary" fullWidth size="lg">
                                Continue
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default AddUserName;
