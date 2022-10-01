import LogoutIcon from "./assets/icons/logout.svg";
import { AccountWithAuth } from "../App";
import Heading from "./Heading";
import Text from "./Text";

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
        <section>
            <Heading tag="h2" className="font-medium text-gray-600">
                Available accounts
            </Heading>
            <Text className="font-medium">
                {isAccountsAvailable
                    ? "Choose an account below to make it active."
                    : "No accounts available."}
            </Text>

            {isAccountsAvailable && (
                <table className="min-w-full table-fixed">
                    <thead className="text-slate-900 border-b border-gray-900 text-base font-bold text-gray-900">
                        <tr>
                            <th scope="col" className="w-32 text-left">
                                Active
                            </th>
                            <th scope="col" className="w-32 text-left">
                                Account
                            </th>
                            <th scope="col" className="pr-2.5 text-right">
                                Action
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((account) => (
                            <tr key={account.accountNum}>
                                <td>
                                    <div className="flex h-[60px] w-14 items-center justify-center">
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
                                            className="text-gray-700 focus-within:text-gray-900 focus-within:outline-gray-900"
                                        />
                                    </div>
                                </td>
                                <td className="w-32 text-lg">
                                    <div className="flex h-[60px] items-center">
                                        {account.accountNum}
                                    </div>
                                </td>
                                <td>
                                    <div className="flex h-[60px] items-center justify-end">
                                        <button
                                            className="flex items-center gap-1 p-2 hover:text-gray-600"
                                            onClick={() =>
                                                onLogout(account.accountNum)
                                            }
                                        >
                                            <span className="hidden text-xs font-semibold underline sm:inline">
                                                Logout
                                            </span>
                                            <LogoutIcon />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
};
