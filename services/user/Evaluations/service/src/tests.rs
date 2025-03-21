#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Evaluations"))]
    fn test_set_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {

        Ok(())
    }
}
