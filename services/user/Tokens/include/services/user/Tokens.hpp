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

      Tokens(psio::shared_view_ptr<psibase::Action> action);

      void init();

      /// Create a new token.
      ///
      /// # Arguments
      /// * `precision` - Amount of decimal places in the token, 4 = 1.0000. 8 = 1.00000000
      /// * `max_issued_supply` - The permanent max issued supply of the token.
      ///
      /// # Returns the unique token identifier aka TID (u32)
      TID create(uint8_t precision, Quantity maxIssuedSupply);

      /// Mint tokens.
      ///
      /// Mint / Issue new tokens into existence. Total issuance cannot exceed the max issued supply
      ///
      /// * Requires - Sender holds the Token owner NFT
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `amount`   - Amount of tokens to burn.
      /// * `memo`     - Memo
      void mint(TID tokenId, Quantity amount, Memo memo);

      /// Burn tokens.
      ///
      /// Burns the token balance of the sender and increases the burned supply by the specific amount.
      ///
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `amount`   - Amount of tokens to burn.
      /// * `memo`     - Memo
      void burn(TID tokenId, Quantity amount, Memo memo);

      /// Set user global configuration of sender.
      ///
      /// # Arguments
      /// * `index` - Position between 0 - 7
      /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
      void setUserConf(uint8_t index, bool enable);

      /// Set balance configuration
      ///
      /// Set user balance configuration of sender.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `index` - Position between 0 - 7
      /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
      void setBalConf(TID tokenId, uint8_t index, bool enable);

      /// Set token configuration.
      ///
      /// * Requires - Sender holds the Token owner NFT
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `index` - Position between 0 - 7
      /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
      void setTokenConf(TID tokenId, uint8_t index, bool enable);

      /// Credit
      ///
      /// Send tokens to a shared balance between the creditor (sender) and the debitor (recipient)
      /// By default, funds will then move automatically from the shared balance to the debitor unless manual debiting is enabled by the `debitor`.
      /// `manual_debit` can be enabled using `setBalConf` or `setUserConf`
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `debitor`  - Debitor / recipient of shared balance.
      /// * `amount`   - Amount to credit towards shared balance.
      /// * `memo`     - Memo
      void credit(TID tokenId, psibase::AccountNumber receiver, Quantity amount, Memo memo);

      /// Uncredit
      ///
      /// Refunds tokens from the shared balance between the creditor (sender) and the debitor, sending back to the creditor.
      ///
      /// This is mimics the behaviour as `reject` but is called by the `sender` instead of the `debitor`
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `debitor`  - Debitor / recipient of shared balance.
      /// * `amount`   - Amount to uncredit from shared balance,
      /// * `memo`     - Memo
      void uncredit(TID tokenId, psibase::AccountNumber receiver, Quantity maxAmount, Memo memo);

      /// Reject
      ///
      /// Returns the entire shared balance between the creditor and the debitor (sender), back to the creditor.
      ///
      /// This is mimics the behaviour as `uncredit` but is called by the `debitor` instead of the `creditor`
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `creditor`  - Debitor / recipient of shared balance.
      /// * `memo`     - Memo
      void reject(TID tokenId, psibase::AccountNumber receiver, Memo memo);

      /// Debit
      ///
      /// Debits tokens from a shared balance between the creditor and the debitor (sender)
      ///
      /// By default, the debitor will automatically debit the amount towards the debitors balance.
      /// `manual_debit` can be enabled using `setBalConf` or `setUserConf`
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `creditor` - User which previously sent balance towards debitor (sender).
      /// * `amount`   - Amount to debit / take from shared balance.
      /// * `memo`     - Memo
      void debit(TID tokenId, psibase::AccountNumber sender, Quantity amount, Memo memo);

      /// Recall a user balance.
      ///
      /// Remote burns a specific user balance and increases burned supply by the specified amount.
      ///
      /// * Requires - Sender holds the Token owner NFT
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `from`     - User balance to be burned
      /// * `amount`   - Amount of tokens to burn.
      /// * `memo`     - Memo
      void recall(TID tokenId, psibase::AccountNumber from, Quantity amount, Memo memo);

      /// Map a symbol to a token.
      ///
      /// By default tokens are only identifiable by their TID, Symbols like "BTC" can be mapped as a permament one way lookup.
      /// Symbol mapping is permament and only map per token is allowed.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `symbol` - Symbol e.g. "BTC"
      void mapSymbol(TID tokenId, SID symbol);

      // Read-only interface:

      /// Lookup token details.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      ///
      /// # Returns token information including current, burned supply and precision.
      TokenRecord getToken(TID tokenId);
      SID         getTokenSym(TID tokenId);

      /// Get user balance.
      ///
      /// Fetch token specific balance of user account
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `account` - User account.
      ///
      /// # Returns user balance information
      Quantity getBalance(TID tokenId, psibase::AccountNumber account);

      /// Get shared balance.
      ///
      /// Fetch shared balance between the creditor and debitor.
      ///
      /// # Arguments
      /// * `creditor` - Creditor account.
      /// * `debitor` - Debitor account.
      /// * `token_id` - Unique token identifier.
      ///
      /// # Returns user balance
      Quantity getSharedBal(TID                    tokenId,
                            psibase::AccountNumber creditor,
                            psibase::AccountNumber debitor);

      /// Get user balance configuration.
      ///
      /// Settings apply only to specific token.
      ///
      /// # Arguments
      /// * `account` - User account.
      /// * `token_id` - Unique token identifier.
      /// * `index` - Position between 0 - 7
      ///
      ///
      /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
      bool getBalConf(psibase::AccountNumber account, TID tokenId, uint8_t index);

      /// Get user global configuration.
      ///
      /// Settings apply to all tokens without a user balance configuration.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      /// * `index` - Position between 0 - 7
      ///
      /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
      bool getUserConf(psibase::AccountNumber account, uint8_t index);

      /// Get token configuration.
      ///
      /// Determine settings e.g. unrecallable and untransferable
      ///
      /// # Arguments
      /// * `account` - User account.
      /// * `token_id` - Unique token identifier.
      /// * `index` - Position between 0 - 7
      ///
      /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
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
            void created(TID tokenId, Account creator, Precision precision, Quantity maxIssuedSupply) {}
            void minted(TID tokenId, Account minter, Quantity amount, Memo memo) {}
            void burned(TID tokenId, Account burner, Quantity amount, Memo memo) {}
            void userConfSet(Account account, psibase::EnumElement flag, bool enable) {}
            void tokenConfSet(TID tokenId, Account setter, psibase::EnumElement flag, bool enable) {}
            // TODO: time is redundant with which block the event was written in
            void transferred(TID tmanualDebitokenId, psibase::BlockTime time, Account sender, Account receiver, Quantity amount, Memo memo) {}
            void recalled(TID tokenId, psibase::BlockTime time, Account from, Quantity amount, Memo memo) {}
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
      method(mapSymbol, tokenId, symbol),
    );
   PSIBASE_REFLECT_EVENTS(Tokens);
   PSIBASE_REFLECT_HISTORY_EVENTS(Tokens,
      method(created, tokenId, creator, precision, maxIssuedSupply),
      method(minted, tokenId, minter, amount, memo),
      method(burned, tokenId, burner, amount),
      method(userConfSet, account, flag, enable),
      method(tokenConfSet, tokenId, setter, flag, enable),
      method(recalled, tokenId, time, from, amount, memo),
   );
   PSIBASE_REFLECT_UI_EVENTS(Tokens);
   PSIBASE_REFLECT_MERKLE_EVENTS(Tokens);
   PSIBASE_REFLECT_TABLES(Tokens, Tokens::Tables)
   // clang-format on

}  // namespace UserService
