import React from "react";
import { Button, Container, Heading, Icon } from "@toolbox/components/ui";

import { useNavDrawer } from "hooks";

import "../../styles/nav.css";

interface Props {
    title: string;
    children?: React.ReactNode | React.ReactNode[];
}

export const NavBar = ({ title, children }: Props) => {
    const { toggle } = useNavDrawer();
    return (
        <Container className="flex flex-col select-none justify-between border-b border-b-gray-700 bg-gray-800 p-2 text-white md:py-2 ">
            <div className="flex justify-start gap-1.5">
                <Button type="icon" onClick={toggle} className="md:hidden text-white">
                    <Icon type="menu" size="sm" />
                </Button>
                <Heading tag="h1" styledAs="h6">
                    {title}
                </Heading>
            </div>
            {children}
        </Container>
    );
};

export default NavBar;
