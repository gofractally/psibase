import { ViewAccount } from "../App";
import { MsgProps } from "../helpers";
import logoutIcon from "./assets/icons/logout.svg";
import closedIcon from "./assets/icons/lock-closed.svg";
import openIcon from "./assets/icons/lock-open.svg";

export const AccountList = ({
    accounts,
    onSelectAccount,
    addMsg,
    clearMsg,
}: any) => {


    const isSelectable = !!onSelectAccount

    return (
        <>
            {accounts.map((account: ViewAccount) => (
                <div
                    className="flex w-full border flex-nowrap place-content-between"
                    key={account.accountNum}
                >
                    {isSelectable && <div className="w-20 text-center">
                        <input
                            name="account"
                            type="radio"
                            id={account.accountNum}
                            onClick={onSelectAccount}
                        />
                    </div>}
                    <div className="w-32">{account.accountNum}</div>
                    <div className="w-6">
                        <img src={account.isSecure ? closedIcon : openIcon} alt="" />
                    </div>
                    {isSelectable && <div className="w-20">
                        <span className="hidden sm:inline">Logout</span>
                        <img className="ml-2 inline-block" src={logoutIcon} />
                    </div>}
                </div>
            ))}
        </>
    );
};
