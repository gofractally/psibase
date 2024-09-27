#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;
    use tpack;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<tpack::Wrapper>(&request))
    }
}
