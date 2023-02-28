import { AlertBannerType } from "components";

export enum ActionType {
    ToggleAccountMenu = "TOGGLE_ACCOUNT_MENU",
    ToggleModalCreateAddress = "TOGGLE_MODAL_CREATE_ADDRESS",
    ToggleModalExample = "TOGGLE_MODAL_EXAMPLE",
    SetAlertBanner = "SET_ALERT_BANNER",
}

export type DefaultModalResolver = (value: boolean) => void;
export interface DefaultModalToggleArgs {
    display: boolean;
    resolver: DefaultModalResolver | null;
}

/**
 * Action: ToggleAccountMenu
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const actionToggleAccountMenu = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleAccountMenu,
    payload: { isOpen: display, resolver },
});

/**
 * Action: SetAlertBanner
 * @param {AlertBannerType} alertBanner - controls which alert banner is displayed
 * @returns a reducer action
 */
export const actionSetAlertBanner = (alertBanner: AlertBannerType) => ({
    type: ActionType.SetAlertBanner,
    payload: { alertBanner },
});

/**
 * Action: DismissAlertBanner
 * @returns a reducer action
 */
export const actionDismissAlertBanner = () => ({
    type: ActionType.SetAlertBanner,
    payload: { alertBanner: null },
});

/**
 * Action: ToggleModalCreateAddress
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const actionToggleModalCreateAddress = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalCreateAddress,
    payload: { isOpen: display, resolver },
});

/**
 * Action: ToggleModalExample
 * @param {DefaultModalToggleArgs} actionArgs
 * @param {boolean} actionArgs.display - controls open/close state of modal
 * @param {DefaultModalResolver|null} actionArgs.resolver - A promise resolver that should be resolved when the modal is dismissed
 * @returns a reducer action
 */
export const actionToggleModalExample = ({
    display,
    resolver,
}: DefaultModalToggleArgs) => ({
    type: ActionType.ToggleModalExample,
    payload: { isOpen: display, resolver },
});
