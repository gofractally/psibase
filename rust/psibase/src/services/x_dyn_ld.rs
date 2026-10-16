use crate::AccountNumber;
use serde::{Deserialize, Serialize};

use super::dyn_ld::DynDep;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkRequest {
    pub service: AccountNumber,
    pub group: String,
    pub deps: Vec<DynDep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlinkRequest {
    pub service: AccountNumber,
    pub group: String,
}

#[crate::service(name = "x-dyn-ld", dispatch = false, psibase_mod = "crate")]
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
