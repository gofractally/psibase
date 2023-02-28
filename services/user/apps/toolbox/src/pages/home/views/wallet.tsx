import { Tab } from "@headlessui/react";
import {
    ActionButton,
    Card,
    List,
    ListItem,
    Hexicon,
    HexiconIcon,
    Icon,
    Tab as StyledTab,
    Text,
    Container,
} from "@toolbox/components/ui";
import { useAlertBanner } from "hooks";

export const Wallet = () => {
    return (
        <div className="h-full space-y-3">
            <WalletHeader />
            <Tab.Group as={"section"}>
                <Tab.List as={Card}>
                    <Container className="flex flex-wrap gap-2">
                        <StyledTab>My tokens</StyledTab>
                        <StyledTab>All tokens</StyledTab>
                        <StyledTab>History</StyledTab>
                    </Container>
                </Tab.List>
                <Tab.Panel>
                    <TokenListHeader />
                    <Card>
                        <List className="divide-y divide-gray-100 text-sm">
                            {TOKENS.map((token) => (
                                <TokenListItem
                                    token={token}
                                    key={`my-tokens-${token.tokenName}`}
                                />
                            ))}
                        </List>
                    </Card>
                </Tab.Panel>
                <Tab.Panel as={Card}>
                    <Container>Coming soon!</Container>
                </Tab.Panel>
                <Tab.Panel>
                    <Card>
                        <TokenListHeader />
                        <List className="divide-y divide-gray-100 text-sm">
                            {TOKENS.map((token) => (
                                <TokenListItem
                                    token={token}
                                    key={`all-tokens-${token.tokenName}`}
                                />
                            ))}
                        </List>
                    </Card>
                </Tab.Panel>
            </Tab.Group>
        </div>
    );
};

export default Wallet;

const WalletHeader = () => {
    const { show, dismiss, isOpen } = useAlertBanner({
        name: "set-up-profile",
    });

    return (
        <Card>
            <Container className="xs:flex-row flex flex-col items-center gap-6 py-7">
                <div className="flex items-center gap-4">
                    <Hexicon
                        size="xl"
                        bgColorClass="bg-gray-300"
                        iconType="f"
                        iconShade="dark"
                    />
                    <div>
                        <Text
                            size="sm"
                            type="secondary"
                            className="mb-0 select-none font-medium"
                        >
                            Total
                        </Text>
                        <Text
                            span
                            size="inherit"
                            className="text-3xl font-semibold"
                        >
                            12.850000
                        </Text>
                    </div>
                </div>
                <div className="flex flex-1 justify-end">
                    <div className="px-3">
                        <ActionButton
                            label="Send"
                            icon="send"
                            onClick={() => alert("send")}
                        />
                    </div>
                    <div className="px-3">
                        <ActionButton
                            label="Swap"
                            icon="swap"
                            onClick={isOpen ? dismiss : show}
                        />
                    </div>
                </div>
            </Container>
        </Card>
    );
};

const TokenListHeader = () => {
    return (
        <Card>
            <Container className="flex select-none flex-row py-2 text-xs font-semibold">
                <div className="basis-20"></div>
                <div className="basis-2/5">
                    <Text span type="secondary" size="xs">
                        Token
                    </Text>
                </div>
                <div className="basis-2/5 text-center">
                    <Text span type="secondary" size="xs">
                        24h
                    </Text>
                </div>
                <div className="basis-1/5 text-right">
                    <Text span type="secondary" size="xs">
                        Balance
                    </Text>
                </div>
            </Container>
        </Card>
    );
};

interface Token {
    tokenName: string;
    icon: HexiconIcon;
}

const TOKENS: Token[] = [
    {
        tokenName: "Bitcoin",
        icon: {
            iconType: "btc",
            bgColorClass: "bg-[#FF9900]",
        },
    },
    {
        tokenName: "EOS",
        icon: {
            iconType: "eos",
            bgColorClass: "bg-gray-800",
            iconStyle: "solid",
        },
    },
    {
        tokenName: "DISK",
        icon: {
            iconType: "server",
            bgColorClass: "bg-[#3ed545]",
        },
    },
    {
        tokenName: "FIRE",
        icon: {
            iconType: "fire",
            bgColorClass: "bg-[#AF5CFF]",
        },
    },
];

const TokenListItem = ({ token }: { token: Token }) => {
    return (
        <ListItem
            key={token.tokenName}
            className="hover:bg-gray-50 active:bg-gray-50"
            onItemClick={() => alert(token.tokenName)}
        >
            <div className="flex basis-20 items-center">
                <Hexicon size="xl" {...token.icon} />
            </div>
            <div className="basis-2/5">
                <Text span size="base" className="font-bold">
                    {token.tokenName}
                </Text>
                <div className="flex items-center">
                    <Icon type="f" size="xs" className="text-gray-500" />
                    <Text
                        span
                        size="sm"
                        type="secondary"
                        className="font-semibold"
                    >
                        0.02097
                    </Text>
                </div>
            </div>
            <div className="basis m-auto basis-2/5 text-center text-green-500">
                <Text span size="base" className="font-semibold">
                    +2.4%
                </Text>
            </div>
            <div className="flex basis-1/5 flex-col items-end">
                <div>
                    <Text size="sm" span className="font-semibold">
                        0.087200
                    </Text>
                </div>
                <div className="flex items-center">
                    <Icon type="f" size="xs" className="text-gray-500" />
                    <Text
                        span
                        size="sm"
                        type="secondary"
                        className="font-semibold"
                    >
                        295.050
                    </Text>
                </div>
            </div>
        </ListItem>
    );
};
