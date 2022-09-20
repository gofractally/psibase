import logoutIcon from "./assets/icons/logout.svg";
import { AccountWithAuth } from "../App";
import closedIcon from "./assets/icons/lock-closed.svg";
import openIcon from "./assets/icons/lock-open.svg";

export const AccountList = ({
    accounts,
    onSelectAccount,
    onLogout,
    selectedAccount
}: { selectedAccount: string, accounts: AccountWithAuth[], onSelectAccount: (account: string) => void, onLogout: (account: string) => void }) => {

    const isAccountsAvailable = accounts.length > 0

    return (
        <div>
            <h2 className="pt-6">My accounts</h2>
            <div>{isAccountsAvailable ? `Select an account below to make it active.` : 'Not logged in.'}</div>

            {isAccountsAvailable && <table className="min-w-full table-fixed">
                <thead className="text-slate-900">
                    <tr>
                        <th scope="col" className="py-3.5 w-32 text-left text-sm font-semibold text-gray-900">
                            Active
                        </th>
                        <th scope="col" className="py-3.5 w-32 text-left text-sm font-semibold text-gray-900">
                            Account
                        </th>
                        <th scope="col" className="py-3.5 text-left text-sm font-semibold text-gray-900">
                            Security
                        </th>
                        <th scope="col" className="py-3.5 text-right text-sm font-semibold text-gray-900">
                            Action
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map(account => (
                        <tr key={account.accountNum} className="w-8">
                            <td>
                                <div className="w-20">
                                    <input
                                        name="account"
                                        type="radio"
                                        onChange={(e) => {
                                            onSelectAccount(e.target.id)
                                        }}
                                        checked={selectedAccount == account.accountNum}
                                        id={account.accountNum}
                                    />
                                </div>
                            </td>
                            <td>
                                <div className="w-32 text-lg">{account.accountNum}</div>

                            </td>
                            <td className="">
                                <div className="w-8 h-10">
                                    <img src={account.authService == 'auth-any-sys' ? openIcon : closedIcon} alt={account.authService} />
                                </div>
                            </td>
                            <td className="flex flex-row-reverse">
                                <button className=" ml-auto" onClick={() => onLogout(account.accountNum)}>
                                    <span className="hidden sm:inline underline">Logout</span>
                                    <img className="ml-2 inline-block" src={logoutIcon} />
                                </button>
                            </td>
                        </tr>
                    ))}

                </tbody>

            </table>}


        </div>
    );
};
