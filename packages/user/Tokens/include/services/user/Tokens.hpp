#pragma once

#include <psibase/Memo.hpp>
#include <psibase/psibase.hpp>

#include <services/system/CommonTables.hpp>
#include <services/user/symbolTables.hpp>
#include <services/user/tokenErrors.hpp>
#include <services/user/tokenTables.hpp>
#include <services/user/tokenTypes.hpp>

namespace UserService
{
   class Tokens : public psibase::Service
   {
     public:
      using Tables = psibase::ServiceTables<TokenTable, TokenHolderTable, InitTable>;

      using Memo = psibase::Memo;

      static constexpr auto service  = psibase::AccountNumber("tokens");
      static constexpr auto sysToken = TID{1};

      static constexpr uint8_t untransferable = 0;
      static constexpr uint8_t unrecallable   = 1;
      static constexpr uint8_t manualDebit    = 0;

      Tokens(psio::shared_view_ptr<psibase::Action> action);

      void init();

      /// Create a new token
      ///
      /// # Arguments
      /// * `precision` - Amount of decimal places in the token, 4 = 1.0000. 8 = 1.00000000
      /// * `max_issued_supply` - The permanent max issued supply of the token
      ///
      /// Returns the unique token identifier aka TID (u32)
      TID create(Precision precision, Quantity maxIssuedSupply);

      /// Mint / Issue new tokens into existence
      ///
      /// Only the token owner can mint new tokens, and only if the total issuance
      /// does not exceed the max issued supply.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `amount`   - Amount of tokens to mint
      /// * `memo`     - Memo
      void mint(TID tokenId, Quantity amount, Memo memo);

      /// Burn's the specified amount of the sender's specified tokens
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `amount`   - Amount of tokens to burn
      /// * `memo`     - Memo
      void burn(TID tokenId, Quantity amount, Memo memo);

      /// Set user global configuration of sender
      ///
      /// # Arguments
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      /// * `enabled`  - A `bool` indicating the intended value of the specified configuration flag
      ///
      /// Configurations:
      /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      void setUserConf(uint8_t index, bool enable);

      /// Set user's token-specific balance configuration
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      /// * `enabled`  - A `bool` indicating the intended value of the specified configuration flag
      ///
      /// Configurations:
      /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      void setBalConf(TID tokenId, uint8_t index, bool enable);

      /// Delete the user's token-specific balance configuration
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      void delBalConf(TID tokenId);

      /// Set token configuration. Only the token owner can set the configuration.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      /// * `enabled`  - A `bool` indicating whether the specified configuration flag is enabled.
      ///
      /// Configurations:
      /// * 0: Untransferrable - If enabled, the token cannot be transferred
      /// * 1: Unrecallable    - If enabled, the token cannot be recalled
      void setTokenConf(TID tokenId, uint8_t index, bool enable);

      /// Credit tokens to a debitor (recipient).
      ///
      /// On credit, tokens are typically automatically debited by the debitor. However,
      /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
      /// "shared balance".
      ///
      /// # Shared balance mechanics
      /// When in the shared balance, the tokens can be:
      /// * uncredited (transfer cancelled) by the creditor
      /// * debited (transfer accepted) by the debitor
      /// * rejected (transfer rejected) by the debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `debitor`  - Debitor / recipient
      /// * `amount`   - Amount to credit
      /// * `memo`     - Memo
      void credit(TID tokenId, psibase::AccountNumber receiver, Quantity amount, Memo memo);

      /// Uncredit tokens that were credited into a shared balance
      ///
      /// On credit, tokens are typically automatically debited by the debitor. However,
      /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
      /// "shared balance".
      ///
      /// # Shared balance mechanics
      /// When in the shared balance, the tokens can be:
      /// * uncredited (transfer cancelled) by the creditor
      /// * debited (transfer accepted) by the debitor
      /// * rejected (transfer rejected) by the debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `debitor`  - Debitor / recipient
      /// * `amount`   - Amount to uncredit
      /// * `memo`     - Memo
      void uncredit(TID tokenId, psibase::AccountNumber receiver, Quantity maxAmount, Memo memo);

      /// Rejects the shared balance between a creditor and a debitor
      ///
      /// On credit, tokens are typically automatically debited by the debitor. However,
      /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
      /// "shared balance".
      ///
      /// # Shared balance mechanics
      /// When in the shared balance, the tokens can be:
      /// * uncredited (transfer cancelled) by the creditor
      /// * debited (transfer accepted) by the debitor
      /// * rejected (transfer rejected) by the debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `creditor`  - User who credited the tokens
      /// * `memo`     - Memo
      void reject(TID tokenId, psibase::AccountNumber receiver, Memo memo);

      /// Debit tokens that were credited into a shared balance
      ///
      /// On credit, tokens are typically automatically debited by the debitor. However,
      /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
      /// "shared balance".
      ///
      /// # Shared balance mechanics
      /// When in the shared balance, the tokens can be:
      /// * uncredited (transfer cancelled) by the creditor
      /// * debited (transfer accepted) by the debitor
      /// * rejected (transfer rejected) by the debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `creditor` - User who credited the tokens
      /// * `amount`   - Amount to debit
      /// * `memo`     - Memo
      void debit(TID tokenId, psibase::AccountNumber sender, Quantity amount, Memo memo);

      /// Recalls an amount of tokens from a user's balance and burns them
      ///
      /// Only the token owner can recall tokens, and only if the token is not marked as unrecallable.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `from`     - User account from which to recall
      /// * `amount`   - Amount of tokens to recall
      /// * `memo`     - Memo
      void recall(TID tokenId, psibase::AccountNumber from, Quantity amount, Memo memo);



      // Read-only interface:

      /// Lookup token details
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      ///
      /// Returns token information including current, burned supply and precision
      TokenRecord getToken(TID tokenId);
      SID         getTokenSym(TID tokenId);

      /// Get user token balance
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `user` - User account
      ///
      /// Returns quantity of tokens in the user's balance
      Quantity getBalance(TID tokenId, psibase::AccountNumber account);

      /// Get shared balance between a creditor and debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `creditor` - Creditor account
      /// * `debitor` - Debitor account
      ///
      /// Returns quantity of tokens in the shared balance
      Quantity getSharedBal(TID                    tokenId,
                            psibase::AccountNumber creditor,
                            psibase::AccountNumber debitor);

      /// Get user's token-specific balance configuration
      ///
      /// # Arguments
      /// * `account`  - User account
      /// * `token_id` - Unique token identifier
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      ///
      /// Configurations:
      /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      ///
      /// Returns a `bool` indicating whether the specified configuration flag is enabled.
      bool getBalConf(psibase::AccountNumber account, TID tokenId, uint8_t index);

      /// Get user's global configuration.
      ///
      /// Settings apply to all tokens without a specific balance configuration.
      ///
      /// # Arguments
      /// * `account`  - User account
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      ///
      /// Configurations:
      /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      ///
      /// Returns a `bool` indicating whether the specified configuration flag is enabled.
      bool getUserConf(psibase::AccountNumber account, uint8_t index);

      /// Get token configuration
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      ///
      /// Configurations:
      /// * 0: Untransferrable - If enabled, the token cannot be transferred
      /// * 1: Unrecallable    - If enabled, the token cannot be recalled
      ///
      /// Returns a `bool` indicating whether the specified configuration flag is enabled
      bool getTokenConf(TID tokenId, uint8_t index);

     private:
      void checkAccountValid(psibase::AccountNumber account);
      bool isSenderIssuer(TID tokenId);

     public:
      struct Events
      {
         using Account = psibase::AccountNumber;
         using Memo    = psibase::Memo;

         // clang-format off
         struct History
         {
            void configured(TID tokenId, std::string action, Memo memo) {}
            void supplyChanged(TID tokenId, Account actor, std::string action, std::string amount, Memo memo) {}
            void balChanged(TID tokenId, Account account, Account counterParty, std::string action, std::string amount, Memo memo) {}
         };

         struct Ui {};

         struct Merkle{};
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Tokens,
      method(init),
      method(create, precision, maxIssuedSupply),
      method(mint, tokenId, amount, memo),
      method(burn, tokenId, amount, memo),
      method(setBalConf, tokenId, index, enable),
      method(delBalConf, tokenId),
      method(setUserConf, index, enable),
      method(setTokenConf, tokenId, index, enable),
      method(credit, tokenId, receiver, amount, memo),
      method(uncredit, tokenId, receiver, maxAmount, memo),
      method(reject, tokenId, receiver, memo),
      method(debit, tokenId, sender, amount, memo),
      method(recall, tokenId, from, amount, memo),
      method(getToken, tokenId),
      method(getUserConf, account, index),
      method(getTokenSym, tokenId),
      method(getBalance, tokenId, account),
      method(getSharedBal, tokenId, creditor, debitor),
      method(getBalConf, account, tokenId, index),
      method(getTokenConf, tokenId, index),
    );
   PSIBASE_REFLECT_EVENTS(Tokens);
   PSIBASE_REFLECT_HISTORY_EVENTS(Tokens,
      method(configured, tokenId, action, memo),
      method(supplyChanged, tokenId, actor, action, amount, memo),
      method(balChanged, tokenId, account, counterParty, action, amount, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(Tokens);
   PSIBASE_REFLECT_MERKLE_EVENTS(Tokens);
   PSIBASE_REFLECT_TABLES(Tokens, Tokens::Tables)
   // clang-format on

}  // namespace UserService
