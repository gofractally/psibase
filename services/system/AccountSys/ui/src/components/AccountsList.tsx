import { ViewAccount } from "../App"
import closedIcon from "./assets/icons/lock-closed.svg";
import openIcon from "./assets/icons/lock-open.svg";


function classNames(...classes: string[]) {
    return classes.filter(Boolean).join(' ')
}

export function AccountsList({ accounts, onSelectAccount, selectedAccount }: { accounts: ViewAccount[], onSelectAccount: (account: string) => void, selectedAccount: string }) {
    return (
        <div className="px-4 sm:px-6 lg:px-8">
            <div className="sm:flex sm:items-center">
                <div className="sm:flex-auto">
                    <h1 className="text-xl font-semibold text-gray-900">Available Accounts</h1>
                    <p className="mt-2 text-sm text-gray-700">
                        Choose and account below to make it active.
                    </p>
                </div>
                <div className="mt-4 border text-black sm:mt-0 sm:ml-16 sm:flex-none">
                    <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto text-black"
                    >
                        Update credit card
                    </button>
                </div>
            </div>
            <div className="-mx-4 mt-10 ring-1 ring-gray-300 sm:-mx-6 md:mx-0 md:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                    <thead>
                        <tr>
                            <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                                Account
                            </th>
                            <th
                                scope="col"
                                className="hidden px-3 py-3.5 text-left text-sm font-semibold text-gray-900 lg:table-cell"
                            >
                                Security
                            </th>
                            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                <span className="sr-only">Select</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((account, planIdx) => (
                            <tr key={account.accountNum}>
                                <td
                                    className={classNames(
                                        planIdx === 0 ? '' : 'border-t border-transparent',
                                        'relative py-4 pl-4 sm:pl-6 pr-3 text-sm'
                                    )}
                                >
                                    <div className="font-medium text-gray-900">
                                        {account.accountNum}
                                    </div>
                                    <div className="mt-1 flex flex-col text-gray-500 sm:block lg:hidden">
                                        fwjeio
                                    </div>
                                    {planIdx !== 0 ? <div className="absolute right-0 left-6 -top-px h-px bg-gray-200" /> : null}
                                </td>
                                <td
                                    className={classNames(
                                        planIdx === 0 ? '' : 'border-t border-gray-200',
                                        'hidden px-3 py-3.5 text-sm text-gray-500 lg:table-cell'
                                    )}
                                >
                                    <div className="w-6 flex justify-center">

                                        <img src={account.isSecure ? closedIcon : openIcon} alt="" />
                                    </div>

                                </td>
                                <td
                                    className={classNames(
                                        planIdx === 0 ? '' : 'border-t border-transparent',
                                        'relative py-3.5 pl-3 pr-4 sm:pr-6 text-right text-sm font-medium'
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSelectAccount(account.accountNum)}
                                        className="inline-flex w-20 items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium leading-4 text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                        <div className={`w-full ${selectedAccount === account.accountNum ? 'font-black' : ''}`}>
                                            {selectedAccount === account.accountNum ? 'Logout' : 'Login'}
                                        </div>
                                    </button>
                                    {planIdx !== 0 ? <div className="absolute right-6 left-0 -top-px h-px bg-gray-200" /> : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
