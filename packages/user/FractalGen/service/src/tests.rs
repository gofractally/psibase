#[cfg(test)]
mod tests {
    use psibase::services::auth_delegate::Wrapper as AuthDelegate;
    use psibase::{account, Chain, Push, PRODUCER_ACCOUNT};

    #[psibase::test_case]
    fn package_installs() -> Result<(), psibase::Error> {
        let chain = Chain::create(1 << 27, 1 << 27, 1 << 27, 1 << 27);
        chain.boot_with(
            &Chain::test_registry(),
            &["TestDefault".to_string(), "FractalGen".to_string()],
        )?;

        let owner = AuthDelegate::push_from(&chain, PRODUCER_ACCOUNT)
            .getOwner(account!("root"))
            .get()?;
        assert_eq!(
            owner,
            Some(account!("core-fract")),
            "boot should leave root owned by core-fract"
        );
        Ok(())
    }
}
