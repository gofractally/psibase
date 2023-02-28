import React, { useState } from "react";
import { NavBar } from "components/navigation";
import { Avatar, Button, Card, Container, Input } from "@toolbox/components/ui";

import { useUser } from "hooks";

export const Account = () => {
    const { user } = useUser();
    const [username, setUsername] = useState(user?.name);
    const [usernameEditMode, setUsernameEditMode] = useState(false);
    const [profile, setProfile] = useState(
        "I’m a ƒractally contributor and community leader"
    );
    const [profileEditMode, setProfileEditMode] = useState(false);

    const save = () => {
        setUsernameEditMode(false);
        setProfileEditMode(false);
    };

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setUsername(e.target.value);
    };

    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfile(e.target.value);
    };

    return (
        <>
            <NavBar title="Account" />
            <Card>
                <Container className="flex gap-4">
                    <Avatar
                        size="4xl"
                        avatarUrl={user?.photo}
                        name={user?.name}
                    />
                    <Button type="outline" className="my-auto">
                        Change Image
                    </Button>
                </Container>
            </Card>
            <Card>
                <Container className="mb-4 space-y-4">
                    <Input
                        label="Username"
                        readOnly
                        rightIcon="copy"
                        value={user?.participantId}
                    />
                    <Input
                        label="Full Name"
                        readOnly={!usernameEditMode}
                        rightIcon={usernameEditMode ? "x" : "edit"}
                        onClickRightIcon={() =>
                            setUsernameEditMode(!usernameEditMode)
                        }
                        value={username}
                        onChange={handleUsernameChange}
                    />
                    <Input
                        label="Profile"
                        readOnly={!profileEditMode}
                        rightIcon={profileEditMode ? "x" : "edit"}
                        onClickRightIcon={() =>
                            setProfileEditMode(!profileEditMode)
                        }
                        value={profile}
                        onChange={handleProfileChange}
                    />
                </Container>
            </Card>
            <Card>
                <Container className="flex gap-4">
                    <Button type="secondary">Cancel</Button>
                    <Button type="primary" onClick={() => save()}>
                        Save
                    </Button>
                </Container>
            </Card>
        </>
    );
};

export default Account;
