use crate::{Action, ActionGroup, ActionSink, SignedTransaction};

pub struct TransactionBuilder<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> {
    size: usize,
    action_limit: usize,
    actions: Vec<Action>,
    transactions: Vec<(String, Vec<SignedTransaction>, bool)>,
    index: usize,
    f: F,
}

impl<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> TransactionBuilder<F> {
    pub fn new(action_limit: usize, f: F) -> Self {
        TransactionBuilder {
            size: 0,
            action_limit,
            actions: vec![],
            transactions: vec![],
            index: 0,
            f,
        }
    }
    pub fn set_label(&mut self, label: String) {
        // If the previous label had no actions, drop it
        if self.index + 1 < self.transactions.len() {
            self.transactions.pop();
        }
        self.transactions
            .push((label, vec![], !self.transactions.is_empty()))
    }
    pub fn push<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error> {
        let prev_len = self.actions.len();
        let prev_size = self.size;
        act.append_to_tx(&mut self.actions, &mut self.size);
        if prev_len != 0 && self.size > self.action_limit {
            // If we just saw a set_label, then there is no carry over
            for new_group in &mut self.transactions[(self.index + 1)..] {
                new_group.2 = false;
            }
            self.transactions[self.index]
                .1
                .push((self.f)(self.actions.drain(..prev_len).collect())?);
            self.size -= prev_size;
        }
        self.index = self.transactions.len() - 1;
        Ok(())
    }
    pub fn push_all<T: ActionGroup>(&mut self, actions: Vec<T>) -> Result<(), anyhow::Error> {
        for act in actions {
            self.push(act)?;
        }
        Ok(())
    }
    // Returns transactions grouped by label
    // - Only the first transaction in a group can contain actions from
    //   previous labels.
    // - If the carry bit is set, then previous labels had some actions
    //   that are in this (or a later) group.
    pub fn finish(mut self) -> Result<Vec<(String, Vec<SignedTransaction>, bool)>, anyhow::Error> {
        for new_group in &mut self.transactions[(self.index + 1)..] {
            new_group.2 = false;
        }
        if !self.actions.is_empty() {
            self.transactions[self.index]
                .1
                .push((self.f)(self.actions)?);
        }
        Ok(self.transactions)
    }
    // Returns the number of transactions that would be created if the
    // builder were finished now.
    pub fn num_transactions(&self) -> usize {
        let complete = self.transactions.iter().map(|group| group.1.len()).sum();
        if !self.actions.is_empty() {
            return complete + 1;
        } else {
            return complete;
        }
    }
}

impl<F: Fn(Vec<Action>) -> Result<SignedTransaction, anyhow::Error>> ActionSink
    for TransactionBuilder<F>
{
    fn push_action<T: ActionGroup>(&mut self, act: T) -> Result<(), anyhow::Error> {
        self.push(act)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Tapos, Transaction};
    use fracpack::Pack;

    fn mkact(size: usize) -> Action {
        let mut result = Action::default();
        result.rawData.0.resize(size, 0u8);
        result
    }
    fn mktx(actions: Vec<Action>) -> Result<SignedTransaction, anyhow::Error> {
        Ok(SignedTransaction {
            transaction: Transaction {
                tapos: Tapos::default(),
                actions,
                claims: Vec::new(),
            }
            .packed()
            .into(),
            proofs: Vec::new(),
        })
    }

    #[test]
    fn test_tx_builder_exact() -> Result<(), anyhow::Error> {
        let mut builder = TransactionBuilder::new(64, mktx);
        builder.set_label("1".to_string());
        builder.push(mkact(32))?;
        builder.push(mkact(32))?;
        builder.push(mkact(64))?;
        let tx = builder.finish()?;
        assert_eq!(
            tx,
            vec![(
                "1".to_string(),
                vec![mktx(vec![mkact(32), mkact(32)])?, mktx(vec![mkact(64)])?],
                false
            )]
        );
        Ok(())
    }

    #[test]
    fn test_tx_builder_exact_label() -> Result<(), anyhow::Error> {
        let mut builder = TransactionBuilder::new(64, mktx);
        builder.set_label("1".to_string());
        builder.push(mkact(32))?;
        builder.push(mkact(32))?;
        builder.set_label("2".to_string());
        builder.push(mkact(64))?;
        let tx = builder.finish()?;
        assert_eq!(
            tx,
            vec![
                (
                    "1".to_string(),
                    vec![mktx(vec![mkact(32), mkact(32)])?],
                    false
                ),
                ("2".to_string(), vec![mktx(vec![mkact(64)])?], false)
            ]
        );
        Ok(())
    }

    #[test]
    fn test_tx_builder_carry() -> Result<(), anyhow::Error> {
        let mut builder = TransactionBuilder::new(64, mktx);
        builder.set_label("1".to_string());
        builder.push(mkact(32))?;
        builder.set_label("2".to_string());
        builder.push(mkact(32))?;
        builder.push(mkact(64))?;
        builder.set_label("3".to_string());
        let tx = builder.finish()?;
        assert_eq!(
            tx,
            vec![
                ("1".to_string(), vec![], false),
                (
                    "2".to_string(),
                    vec![mktx(vec![mkact(32), mkact(32)])?, mktx(vec![mkact(64)])?],
                    true
                ),
                ("3".to_string(), vec![], false)
            ]
        );
        Ok(())
    }
    #[test]
    fn test_tx_builder_carry_chain() -> Result<(), anyhow::Error> {
        let mut builder = TransactionBuilder::new(64, mktx);
        builder.set_label("1".to_string());
        builder.push(mkact(16))?;
        builder.set_label("2".to_string());
        builder.push(mkact(16))?;
        builder.set_label("3".to_string());
        builder.push(mkact(16))?;
        builder.set_label("4".to_string());
        builder.push(mkact(16))?;
        let tx = builder.finish()?;
        assert_eq!(
            tx,
            vec![
                ("1".to_string(), vec![], false),
                ("2".to_string(), vec![], true),
                ("3".to_string(), vec![], true),
                (
                    "4".to_string(),
                    vec![mktx(vec![mkact(16), mkact(16), mkact(16), mkact(16)])?],
                    true
                ),
            ]
        );
        Ok(())
    }
}
