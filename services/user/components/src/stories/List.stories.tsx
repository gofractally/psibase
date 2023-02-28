import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { List, ListItem, ListItemAvatar, ListItemText } from "../ui/List";
import { Text } from "../ui";

export default {
    component: List,
} as ComponentMeta<typeof List>;

const TemplateWithGrayBg: ComponentStory<typeof List> = (args) => (
    <div className="w-96 bg-gray-100 p-8">
        <Text>The styles for this component need to be updated.</Text>
        <List>{args.children}</List>
    </div>
);

const TemplateWithWhiteBg: ComponentStory<typeof List> = (args) => (
    <div className="w-96 bg-white p-8">
        <Text>The styles for this component need to be updated.</Text>
        <List>{args.children}</List>
    </div>
);

const members = [
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1780&q=80",
        name: "Hal McGovern",
        isOnline: true,
    },
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80",
        name: "Brenda Law",
    },
];

export const MembersList = TemplateWithGrayBg.bind({});
MembersList.args = {
    children: members.map((member, index) => (
        <ListItem key={index}>
            <ListItemAvatar
                avatarUrl={member.avatarUrl}
                statusBadge={member.isOnline ? "green" : undefined}
            />
            <ListItemText isBold>{member.name}</ListItemText>
        </ListItem>
    )),
};

const tokens = [
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1625029010191-66ba0c5f2cbb?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1772&q=80",
        name: "PRIME",
        quantity: 2800,
        btcValue: 0.1034011,
    },
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1515858393611-608ec6e72bcb?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1931&q=80",
        name: "EOS",
        quantity: 9134,
        btcValue: 0.5123456,
    },
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1504674900247-0877df9cc836?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80",
        name: "FOOD",
        quantity: 123,
        btcValue: 0.00012345,
    },
    {
        avatarUrl:
            "https://images.unsplash.com/photo-1556112353-ad4fb98d81e7?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1921&q=80",
        name: "UNO",
        quantity: 1,
        btcValue: 23.76543,
    },
];

export const TokensList = TemplateWithWhiteBg.bind({});
TokensList.args = {
    children: tokens.map((token, index) => (
        <ListItem key={index}>
            <ListItemAvatar avatarUrl={token.avatarUrl} />
            <ListItemText>
                <div className="text-sm">
                    <p className="font-bold">{token.name}</p>
                    <p className="font-semibold">
                        Total: {token.quantity.toLocaleString()} / ₿{" "}
                        {token.btcValue.toLocaleString(undefined, {
                            maximumFractionDigits: 8,
                        })}
                    </p>
                </div>
            </ListItemText>
        </ListItem>
    )),
};
