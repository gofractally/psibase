import LogoutIcon from "./assets/icons/logout.svg";
import { AccountWithAuth } from "../App";
import ClosedIcon from "./assets/icons/lock-closed.svg";
import OpenIcon from "./assets/icons/lock-open.svg";

export const AccountList = ({
    accounts,
    onSelectAccount,
    onLogout,
    selectedAccount,
}: {
    selectedAccount: string;
    accounts: AccountWithAuth[];
    onSelectAccount: (account: string) => void;
    onLogout: (account: string) => void;
}) => {
    const isAccountsAvailable = accounts.length > 0;

    return (
        <div>
            <h2 className="pt-6">Available accounts</h2>
            <div>
                {isAccountsAvailable
                    ? `Choose an account below to make it active.`
                    : "No accounts available."}
            </div>

            {isAccountsAvailable && (
                <table className="min-w-full table-fixed">
                    <thead className="text-slate-900">
                        <tr>
                            <th
                                scope="col"
                                className="w-32 py-3.5 text-left text-sm font-semibold text-gray-900"
                            >
                                Active
                            </th>
                            <th
                                scope="col"
                                className="w-32 py-3.5 text-left text-sm font-semibold text-gray-900"
                            >
                                Account
                            </th>
                            <th
                                scope="col"
                                className="py-3.5 text-left text-sm font-semibold text-gray-900"
                            >
                                Security
                            </th>
                            <th
                                scope="col"
                                className="py-3.5 text-right text-sm font-semibold text-gray-900"
                            >
                                Action
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((account) => (
                            <tr key={account.accountNum} className="w-8">
                                <td>
                                    <div className="w-20">
                                        <input
                                            name="account"
                                            type="radio"
                                            onChange={(e) => {
                                                onSelectAccount(e.target.id);
                                            }}
                                            checked={
                                                selectedAccount ==
                                                account.accountNum
                                            }
                                            id={account.accountNum}
                                        />
                                    </div>
                                </td>
                                <td>
                                    <div className="w-32 text-lg">
                                        {account.accountNum}
                                    </div>
                                </td>
                                <td className="">
                                    <div className="h-10 w-8">
                                        {account.authService ==
                                        "auth-any-sys" ? (
                                            <OpenIcon />
                                        ) : (
                                            <ClosedIcon />
                                        )}
                                    </div>
                                </td>
                                <td className="flex flex-row-reverse">
                                    <button
                                        className="ml-auto flex items-center gap-2"
                                        onClick={() =>
                                            onLogout(account.accountNum)
                                        }
                                    >
                                        <span className="hidden underline sm:inline">
                                            Logout
                                        </span>
                                        <LogoutIcon />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};
