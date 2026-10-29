#[cfg(test)]
mod tests {
    /// FractalGen is a boot package: it hands root to core-fract, which must
    /// happen after commit_install (see boot.rs). Post-boot install would
    /// break later root package commits in the same batch.
    #[psibase::test_case]
    fn package_installs() -> Result<(), psibase::Error> {
        let chain = psibase::Chain::create(1 << 27, 1 << 27, 1 << 27, 1 << 27);
        chain.boot_with(
            &psibase::Chain::test_registry(),
            &["TestDefault".to_string(), "FractalGen".to_string()],
        )?;
        Ok(())
    }
}
