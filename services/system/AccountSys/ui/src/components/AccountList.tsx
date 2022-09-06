import { MsgProps } from "../helpers";
import logoutIcon from "./assets/icons/logout.svg";

export const AccountList = ({
    accounts,
    onSelectAccount,
    addMsg,
    clearMsg,
}: any) => {
    return (
        <>
            {accounts.map((account: any) => (
                <div
                    className="flex w-full flex-nowrap place-content-between"
                    key={account.accountNum}
                >
                    <div className="w-20 text-center">
                        <input
                            name="account"
                            type="radio"
                            id={account.accountNum}
                            onClick={onSelectAccount}
                        />
                    </div>
                    <div className="w-32">{account.accountNum}</div>
                    <div className="grow">fake pubKey</div>
                    <div className="w-20">
                        <span className="hidden sm:inline">Logout</span>
                        <img className="ml-2 inline-block" src={logoutIcon} />
                    </div>
                </div>
            ))}
        </>
    );
};
