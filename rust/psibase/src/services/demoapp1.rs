use crate::{AccountNumber, PublicKey, Reflect};
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, Unpack};
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "InviteRecordInput")]
pub struct InviteRecord {
    pubkey: PublicKey,
    inviter: AccountNumber,
    actor: AccountNumber,
    expiry: u32,
    newAccountToken: bool,
    state: u8,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "NewAccountRecordInput")]
pub struct NewAccountRecord {
    name: AccountNumber,
    invitee: AccountNumber,
}

#[crate::service(name = "demoapp1", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, Hex};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn multiply(a: i32, b: i32) {
        unimplemented!()
    }
}
