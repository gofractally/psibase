#[cfg(not(test))]
#[psibase::service(name = "transact+1", dispatch = false)]
#[allow(non_snake_case, unused_variables)]
mod service {
    use psibase::{AccountNumber, HttpReply, HttpRequest};

    #[action]
    fn getUser(request: HttpRequest) -> Option<AccountNumber> {
        unimplemented!()
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        unimplemented!()
    }
}

#[cfg(test)]
use psibase::{AccountNumber, HttpReply, HttpRequest};

#[cfg(test)]
pub struct Wrapper;

#[cfg(test)]
impl Wrapper {
    pub fn call() -> Self {
        Self
    }

    pub fn call_from(_sender: AccountNumber) -> Self {
        Self
    }

    #[allow(non_snake_case)]
    pub fn getUser(&self, _request: HttpRequest) -> Option<AccountNumber> {
        None
    }

    #[allow(non_snake_case)]
    pub fn serveSys(
        &self,
        _request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        unimplemented!()
    }
}
