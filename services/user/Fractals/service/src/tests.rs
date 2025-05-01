#![allow(non_snake_case)]

#[cfg(test)]
mod tests {

    #[psibase::test_case(packages("Fractals"))]
    fn test_set_thing() -> Result<(), psibase::Error> {
        Ok(())
    }
}
