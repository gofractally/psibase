#[psibase::service(name = "chat+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use chat::call_timeline;
    use chat::sessions;
    use chat::spaces::{space_with_members, spaces_for_user};
    use chat::tables::{SpaceRow, SPACE_KIND_DM, SPACE_KIND_GROUP};
    use psibase::services::transact::Wrapper as TransactSvc;
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

    #[derive(SimpleObject)]
    struct SessionEntry {
        session_id: String,
        space_uuid: String,
        purpose: String,
        participants: Vec<AccountNumber>,
        lifecycle: u8,
        expires_at: i64,
        created_at: i64,
    }

    #[derive(SimpleObject)]
    struct SessionJoinAuthEntry {
        session_id: String,
        authorized: bool,
        purpose: String,
        space_uuid: String,
        participants: Vec<AccountNumber>,
        lifecycle: u8,
        expires_at: i64,
        expired: bool,
    }

    #[derive(SimpleObject)]
    struct CallEventEntry {
        space_uuid: String,
        session_id: String,
        event: String,
        account: AccountNumber,
        reason: String,
        at: i64,
    }

    fn now_micros() -> i64 {
        TransactSvc::call()
            .currentBlock()
            .time
            .seconds()
            .microseconds()
            .microseconds
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

        /// Active objective session for a Space and purpose (e.g. chat-data), if any.
        async fn active_session(
            &self,
            space_uuid: String,
            purpose: String,
        ) -> async_graphql::Result<Option<SessionEntry>> {
            let _ = self.require_authenticated()?;
            let row = sessions::active_session_for_space(&space_uuid, &purpose);
            Ok(row.map(|r| {
                let view = sessions::session_to_view(r);
                SessionEntry {
                    session_id: view.session_id,
                    space_uuid: view.space_uuid,
                    purpose: view.purpose,
                    participants: view.participants,
                    lifecycle: view.lifecycle,
                    expires_at: view.expires_at,
                    created_at: view.created_at,
                }
            }))
        }

        /// Objective session metadata for x-webrtc-sig join authorization (no SDP/ICE).
        async fn session(&self, session_id: String) -> async_graphql::Result<Option<SessionEntry>> {
            let _ = self.require_authenticated()?;
            let row = sessions::session_row(&session_id);
            Ok(row.map(|r| {
                let view = sessions::session_to_view(r);
                SessionEntry {
                    session_id: view.session_id,
                    space_uuid: view.space_uuid,
                    purpose: view.purpose,
                    participants: view.participants,
                    lifecycle: view.lifecycle,
                    expires_at: view.expires_at,
                    created_at: view.created_at,
                }
            }))
        }

        /// Whether the authenticated account may join this session (active, unexpired, participant).
        async fn session_join_auth(
            &self,
            session_id: String,
        ) -> async_graphql::Result<SessionJoinAuthEntry> {
            let user = self.require_authenticated()?;
            let auth = sessions::authorize_session_join(&session_id, user, now_micros());
            Ok(SessionJoinAuthEntry {
                session_id: auth.session_id,
                authorized: auth.authorized,
                purpose: auth.purpose,
                space_uuid: auth.space_uuid,
                participants: auth.participants,
                lifecycle: auth.lifecycle,
                expires_at: auth.expires_at,
                expired: auth.expired,
            })
        }

        /// Call lifecycle timeline for a Space (av-call sessions).
        async fn call_events(
            &self,
            space_uuid: String,
        ) -> async_graphql::Result<Vec<CallEventEntry>> {
            let user = self.require_authenticated()?;
            if !chat::spaces::is_space_member(&space_uuid, user) {
                return Err(async_graphql::Error::new(
                    "permission denied: account is not a member of this space",
                ));
            }
            Ok(call_timeline::call_events_for_space(&space_uuid)
                .into_iter()
                .filter_map(|row| {
                    call_timeline::call_timeline_ui_event(row.kind, &row.reason).map(|event| {
                        CallEventEntry {
                            space_uuid: row.space_uuid,
                            session_id: row.session_id,
                            event: event.into(),
                            account: row.account,
                            reason: row.reason,
                            at: row.at,
                        }
                    })
                })
                .collect())
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
            get_sender() == psibase::services::http_server::SERVICE,
            "permission denied: serveSys only callable by 'http'",
        );

        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
