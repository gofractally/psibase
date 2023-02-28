import React, { useState } from "react";
import { Card } from "../Card";
import { Avatar } from "../Avatar";
import Button from "../Button";
import TransactionStatus from "./TransactionStatus";
import { Modal } from "../Modal";

interface SDFieldProps {
    children: React.ReactNode[];
    avatar?: {
        url?: string;
        name?: string;
    };
}

const ConfirmSendDialogField = ({ children, avatar }: SDFieldProps) => {
    return (
        <div className="mb-4 flex gap-1 bg-gray-50 px-2 py-1">
            {avatar && (
                <div className="m-1 flex-none">
                    <Avatar
                        avatarUrl={avatar.url}
                        name="Rey"
                        size="lg"
                        shape="hex"
                    />
                </div>
            )}
            <div className="mx-1 my-auto flex-auto content-center">
                <div className={`contentLen-${children.length} text-sm`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export interface SendDialogProps {
    onBackClick: () => void;
}

const ConfirmSendDialog = ({ onBackClick }: SendDialogProps) => {
    const [isSendSuccessModalOpen, setSendSuccessModalOpen] = useState(false);
    const avatarFrom = {};
    const avatarTo = {
        url: "https://randomuser.me/api/portraits/women/44.jpg",
    };
    return (
        <div className="h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="my-0 mx-2">
                    <h3 className="mx-auto mb-6 text-center font-bold">
                        Confirm send
                    </h3>
                    <ConfirmSendDialogField avatar={avatarFrom}>
                        <label className="text-gray-400">Send</label>
                        <div className="font-bold">
                            230.5 PRIME / {"\u20BF"} 230.5
                        </div>
                        <br />
                        <label className="text-gray-400">Trx fee</label>
                        <div>.001 PRIME / 0.000011</div>
                    </ConfirmSendDialogField>
                    <ConfirmSendDialogField avatar={avatarTo}>
                        <label className="text-gray-400">To</label>
                        <div>Hal McGovern</div>
                        <br />
                        <label className="text-gray-400">Memo</label>
                        <div>For your perfectly roasted coffee.</div>
                    </ConfirmSendDialogField>
                    <div className="mt-8 flex gap-2">
                        <Button
                            type="outline"
                            fullWidth
                            size="lg"
                            onClick={() => onBackClick()}
                        >
                            Back
                        </Button>
                        <Button
                            type="secondary"
                            fullWidth
                            size="lg"
                            onClick={() => setSendSuccessModalOpen(true)}
                        >
                            Approve
                        </Button>
                    </div>
                </div>
            </Card>
            <Modal
                shouldCloseOnEsc
                shouldCloseOnOverlayClick
                ariaHideApp={false}
                isOpen={isSendSuccessModalOpen}
                onRequestClose={() => setSendSuccessModalOpen(false)}
                title=""
            >
                <TransactionStatus
                    type="success"
                    onCloseClick={() => setSendSuccessModalOpen(false)}
                >
                    <div className="bg-gray-50 py-2">
                        <label className="text-sm text-gray-400">Sent</label>
                        <p>
                            230.50 PRIME /{" "}
                            <span className="">{"\u20BF"}230.50</span>
                        </p>
                        <label className="text-sm text-gray-400">To</label>
                        <p>245798572349857</p>
                        <label className="text-sm text-gray-400">Memo</label>
                        <p>For your perfectly roasted coffee.</p>
                        <label className="text-sm text-gray-400">Trx fee</label>
                        <p>.001 PRIME / {"\u20BF"}0.000011</p>
                    </div>
                </TransactionStatus>
            </Modal>
        </div>
    );
};

export default ConfirmSendDialog;
