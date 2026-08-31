#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Meet"))]
    fn set_meeting_rejects_non_host(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let host = account!("host");
        let alice = account!("alice");
        chain.new_account(host).unwrap();
        chain.new_account(alice).unwrap();

        let id = account!("standup");
        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice],
                vec![b"h".to_vec(), b"a".to_vec()],
                "hash-1".to_string(),
            )
            .get()?;

        let stolen = Wrapper::push_from(&chain, alice)
            .set_meeting(
                id,
                vec![alice],
                vec![b"stolen".to_vec()],
                "hash-2".to_string(),
            )
            .get();
        assert!(stolen.is_err(), "non-host cannot set an existing meeting");

        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice],
                vec![b"h2".to_vec(), b"a2".to_vec()],
                "hash-2".to_string(),
            )
            .get()?;

        Ok(())
    }

    #[psibase::test_case(packages("Meet"))]
    fn private_meeting_wrap_rules(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let host = account!("host");
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(host).unwrap();
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        Wrapper::push_from(&chain, host)
            .set_key(b"host-pub".to_vec())
            .get()?;
        Wrapper::push_from(&chain, alice)
            .set_key(b"alice-pub".to_vec())
            .get()?;

        let id = account!("chat");
        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice, bob],
                vec![b"wrap-host".to_vec(), b"wrap-alice".to_vec(), vec![]],
                "hash-1".to_string(),
            )
            .get()?;

        Wrapper::push_from(&chain, alice)
            .set_member_wrap(id, bob, b"wrap-bob".to_vec(), "hash-1".to_string())
            .get()?;

        let replaced = Wrapper::push_from(&chain, alice)
            .set_member_wrap(id, bob, b"wrap-bob-2".to_vec(), "hash-1".to_string())
            .get();
        assert!(replaced.is_err(), "non-host cannot replace a wrap");

        Wrapper::push_from(&chain, host)
            .set_member_wrap(id, bob, b"wrap-bob-host".to_vec(), "hash-1".to_string())
            .get()?;

        let outsider = Wrapper::push_from(&chain, alice)
            .set_member_wrap(id, host, b"nope".to_vec(), "wrong-hash".to_string())
            .get();
        assert!(outsider.is_err(), "wrong hash must fail");

        Ok(())
    }

    #[psibase::test_case(packages("Meet"))]
    fn set_meeting_drops_absent_members(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let host = account!("host");
        let alice = account!("alice");
        let bob = account!("bob");
        chain.new_account(host).unwrap();
        chain.new_account(alice).unwrap();
        chain.new_account(bob).unwrap();

        let id = account!("room");
        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice, bob],
                vec![b"h".to_vec(), b"a".to_vec(), b"b".to_vec()],
                "hash-1".to_string(),
            )
            .get()?;

        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice],
                vec![b"h2".to_vec(), b"a2".to_vec()],
                "hash-2".to_string(),
            )
            .get()?;

        let dropped = Wrapper::push_from(&chain, bob)
            .set_member_wrap(id, alice, b"nope".to_vec(), "hash-2".to_string())
            .get();
        assert!(dropped.is_err(), "removed member cannot set a wrap");

        Ok(())
    }

    #[psibase::test_case(packages("Meet"))]
    fn outsider_cannot_wrap(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let host = account!("host");
        let alice = account!("alice");
        let carol = account!("carol");
        chain.new_account(host).unwrap();
        chain.new_account(alice).unwrap();
        chain.new_account(carol).unwrap();

        let id = account!("guild");
        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice],
                vec![b"h".to_vec(), b"a".to_vec()],
                "hash-1".to_string(),
            )
            .get()?;

        let outsider = Wrapper::push_from(&chain, carol)
            .set_member_wrap(id, alice, b"nope".to_vec(), "hash-1".to_string())
            .get();
        assert!(outsider.is_err(), "non-member cannot set a wrap");

        Wrapper::push_from(&chain, host)
            .add_members(id, vec![carol])
            .get()?;

        Wrapper::push_from(&chain, alice)
            .set_member_wrap(id, carol, b"wrap-carol".to_vec(), "hash-1".to_string())
            .get()?;

        Ok(())
    }

    #[psibase::test_case(packages("Meet"))]
    fn delete_meeting_frees_id(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let host = account!("host");
        let alice = account!("alice");
        chain.new_account(host).unwrap();
        chain.new_account(alice).unwrap();

        let id = account!("standup");
        Wrapper::push_from(&chain, host)
            .set_meeting(
                id,
                vec![host, alice],
                vec![b"h".to_vec(), b"a".to_vec()],
                "hash-1".to_string(),
            )
            .get()?;

        let denied = Wrapper::push_from(&chain, alice).delete_meeting(id).get();
        assert!(denied.is_err(), "non-host cannot delete a meeting");

        Wrapper::push_from(&chain, host).delete_meeting(id).get()?;

        Wrapper::push_from(&chain, alice)
            .set_meeting(id, vec![alice], vec![b"a".to_vec()], "hash-2".to_string())
            .get()?;

        Ok(())
    }
}
