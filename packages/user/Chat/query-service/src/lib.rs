#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use chat::spaces::{space_with_members, spaces_for_user};
    use chat::tables::{SpaceRow, SPACE_KIND_DM, SPACE_KIND_GROUP};
    use psibase::*;

    #[derive(Enum, Copy, Clone, Eq, PartialEq)]
    enum SpaceKind {
        #[graphql(name = "DM")]
        Dm,
        #[graphql(name = "GROUP")]
        Group,
    }

    impl SpaceKind {
        fn from_row_kind(kind: u8, member_count: usize) -> Self {
            match kind {
                SPACE_KIND_DM => SpaceKind::Dm,
                SPACE_KIND_GROUP => SpaceKind::Group,
                _ if member_count == 2 => SpaceKind::Dm,
                _ => SpaceKind::Group,
            }
        }
    }

    #[derive(SimpleObject)]
    struct SpaceEntry {
        space_uuid: String,
        members: Vec<AccountNumber>,
        kind: SpaceKind,
    }

    fn space_entry_from_row(row: SpaceRow) -> SpaceEntry {
        let space = space_with_members(row.clone());
        let member_count = space.members.len();
        SpaceEntry {
            space_uuid: space.space_uuid,
            members: space.members,
            kind: SpaceKind::from_row_kind(row.kind, member_count),
        }
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    impl Query {
        fn require_authenticated(&self) -> async_graphql::Result<AccountNumber> {
            self.user.ok_or_else(|| {
                async_graphql::Error::new(
                    "permission denied: an authorized session is required for this query.",
                )
            })
        }
    }

    #[Object]
    impl Query {
        /// Lists Spaces the authenticated user belongs to (DM and group).
        async fn my_spaces(&self) -> async_graphql::Result<Vec<SpaceEntry>> {
            let user = self.require_authenticated()?;
            Ok(spaces_for_user(user)
                .into_iter()
                .map(space_entry_from_row)
                .collect())
        }

        async fn chat_ready(&self) -> bool {
            true
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        check(
            get_sender() == AccountNumber::from("http-server"),
            "permission denied: serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
