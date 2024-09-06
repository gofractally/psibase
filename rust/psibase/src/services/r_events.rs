#[crate::service(name = "r-events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod effluvium_interface {
    use crate::HttpRequest;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }
}
