#[cfg(test)]
mod tests {
    #[psibase::test_case(packages("AuthDyn"))]
    fn package_installs(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        Ok(())
    }
}
