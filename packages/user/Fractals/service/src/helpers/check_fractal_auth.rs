// Check sender is authorised to perform an action on behalf of a fractal.
//
// Asks the auth service of the fractal if whatever sender account is sufficient as the
// sole authoriser for the provided method number.
macro_rules! check_fractal_auth {
    ($fractal:expr, $action:ident) => {
        let auth = psibase::services::auth_dyn::Wrapper::call();

        let method_num = psibase::services::fractals::action_structs::$action::ACTION_NAME;

        check(
            auth.isAuthSys(
                $fractal,
                vec![get_sender()],
                Some(ServiceMethod::new(get_service(), method_num.into())),
                None,
            ),
            &format!(
                "sender {} not authorised for fractal: {} method: {}",
                get_sender(),
                $fractal,
                method_num
            ),
        );
    };
}

pub(crate) use check_fractal_auth;
