// TODO: tables

#[crate::service(name = "accounts", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn newAccount(name: AccountNumber, authService: AccountNumber, requireNew: bool) {
        unimplemented!()
    }

    #[action]
    fn setAuthServ(authService: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn exists(num: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn setCreator(creator: AccountNumber) {
        unimplemented!()
    }
}
