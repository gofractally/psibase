#[crate::service(name = "revents", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod revents_interface {
    use crate::HttpRequest;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }
}
