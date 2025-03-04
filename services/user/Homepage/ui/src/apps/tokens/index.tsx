import { Account } from "@/lib/zod/Account"
import { Coins } from "lucide-react"
import { TokensPage } from "./page"
import { AppConfigType } from "@/configuredApps"


export const tokensConfig: AppConfigType = {
    service: Account.parse('tokens'),
    name: 'Tokens',
    description: "Create, burn and send tokens.",
    icon: <Coins className="h-6 w-6" />,
    isMore: false,
    children: [
        {
            path: '',
            element: <TokensPage />,
            name: 'Home'
        },
        {
            path: 'transfer',
            element: <div>Transfer page!!!!!!!!!!!!!</div>,
            name: 'Transfer'
        },
        {
            path: 'history',
            element: <div>History page</div>,
            name: 'History'
        }
    ]
}