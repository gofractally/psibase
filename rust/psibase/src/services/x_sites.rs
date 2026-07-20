#[crate::service(name = "x-sites", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{HttpReply, HttpRequest};

    #[action]
    fn serveSys(req: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
