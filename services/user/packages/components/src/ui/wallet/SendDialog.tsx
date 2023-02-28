import React, { useState } from "react";
import { Card } from "../Card";
import Button from "../Button";
import { Modal } from "../Modal";
import SendDialogField from "./SendDialogField";
import ConfirmSendDialog from "./ConfirmSendDialog";

import "../../styles/send-dialog.css";

const SendDialog = () => {
    const [isFromModalOpen, setFromModalOpen] = useState(false);
    const [isToModalOpen, setToModalOpen] = useState(false);
    const [isConfirmModalOpen, setConfirmModalOpen] = useState(false);
    const avatarFrom = {};
    const avatarTo = {
        url: "https://randomuser.me/api/portraits/women/44.jpg",
    };
    return (
        <div className="h-full w-full space-y-4 bg-gray-100 p-4">
            <Card>
                <div className="my-0 mx-2">
                    <h3 className="mx-auto mb-6 text-center font-bold">Send</h3>
                    <SendDialogField
                        avatar={avatarFrom}
                        onClick={() => setFromModalOpen(true)}
                    >
                        <label className="text-gray-800">From</label>
                        <div className="font-bold">PRIME</div>
                        <div>Total: 2,800 / {"\u20BF"}0.1034011</div>
                    </SendDialogField>
                    <SendDialogField>
                        <label htmlFor="input_amount" className="text-gray-800">
                            Amount
                        </label>
                        <input
                            className="block border-none p-0"
                            type="number"
                            id="input_amount"
                            placeholder="0"
                        />
                    </SendDialogField>
                    <SendDialogField>
                        <label htmlFor="input_to" className="text-gray-800">
                            To
                        </label>
                        <input
                            className="block w-full border-none p-0"
                            type="text"
                            id="input_to"
                            placeholder="Account name or number"
                        />
                    </SendDialogField>
                    <SendDialogField>
                        <input
                            className="block w-full border-none p-0"
                            type="text"
                            id="input_memo"
                            placeholder="Memo"
                        />
                    </SendDialogField>
                    <div className="mt-8 flex gap-2">
                        <Button type="outline" fullWidth size="lg">
                            Cancel
                        </Button>
                        <Button
                            type="secondary"
                            fullWidth
                            size="lg"
                            onClick={() => setConfirmModalOpen(true)}
                        >
                            Submit
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Modal Dialogs Examples */}
            <Modal
                shouldCloseOnEsc
                shouldCloseOnOverlayClick
                ariaHideApp={false}
                isOpen={isFromModalOpen}
                onRequestClose={() => setFromModalOpen(false)}
                title="Select your fractal and currency"
            >
                <div className="space-y-3">
                    <div>
                        Lorem ipsum dolor sit amet consectetur adipisicing elit.
                        Ab consectetur debitis omnis blanditiis cum at laborum
                        doloremque, nam rem nesciunt error nemo voluptatibus
                        quos quisquam non recusandae asperiores, sed quas.
                    </div>
                    <div>Press [ESC] or click in the Overlay to close it</div>
                </div>
            </Modal>
            <Modal
                shouldCloseOnEsc
                shouldCloseOnOverlayClick
                ariaHideApp={false}
                isOpen={isToModalOpen}
                onRequestClose={() => setToModalOpen(false)}
                title="Select recipient"
            >
                <div className="space-y-3">
                    <div>
                        Lorem ipsum dolor sit amet consectetur adipisicing elit.
                        Ab consectetur debitis omnis blanditiis cum at laborum
                        doloremque, nam rem nesciunt error nemo voluptatibus
                        quos quisquam non recusandae asperiores, sed quas.
                    </div>
                    <div>Press [ESC] or click in the Overlay to close it</div>
                </div>
            </Modal>
            <Modal
                shouldCloseOnEsc
                shouldCloseOnOverlayClick
                ariaHideApp={false}
                isOpen={isConfirmModalOpen}
                onRequestClose={() => setConfirmModalOpen(false)}
                title=""
            >
                <ConfirmSendDialog
                    onBackClick={() => setConfirmModalOpen(false)}
                />
            </Modal>
        </div>
    );
};

export default SendDialog;
