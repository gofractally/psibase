#[crate::service(name = "x-packages", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{HttpReply, HttpRequest};

    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
