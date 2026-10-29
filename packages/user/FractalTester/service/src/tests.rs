#[cfg(test)]
mod tests {
    /// FractalTester depends on FractalGen, which must be installed at boot
    /// (see FractalGen::package_installs).
    #[psibase::test_case]
    fn package_installs() -> Result<(), psibase::Error> {
        let chain = psibase::Chain::create(1 << 27, 1 << 27, 1 << 27, 1 << 27);
        chain.boot_with(
            &psibase::Chain::test_registry(),
            &["TestDefault".to_string(), "FractalTester".to_string()],
        )?;
        Ok(())
    }
}
