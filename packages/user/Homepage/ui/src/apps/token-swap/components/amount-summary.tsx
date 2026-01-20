

import { Avatar } from "@shared/components/avatar";


export const AmountSummary = ({ avatarSeed, label, title, amount }: { avatarSeed: string, label: string, title: string, amount: string }) => <div className="flex justify-between items-center  rounded-xl border border-gray-300 bg-gray-100/70 p-4 dark:border-gray-800 dark:bg-gray-900/50">
    <div className='flex items-center gap-4'>
        <div className="shrink-0">
            <Avatar
                account={avatarSeed}
                type='glass'
                className="h-12 w-12"
                alt="From account"
            />
        </div>
        <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {label}
            </p>
            <div className="wrap-break-word text-lg font-semibold text-slate-900 dark:text-slate-100">
                {title}
            </div>
        </div>
    </div>
    <div className="text-2xl font-mono items-center">
        {amount}
    </div>
</div>