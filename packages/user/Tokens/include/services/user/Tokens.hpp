#pragma once

#include <optional>
#include <string>

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
      using Tables = psibase::ServiceTables<TokensInitTable, TokenTable>;

      using Memo = psibase::Memo;

      static constexpr auto service  = psibase::AccountNumber("tokens");
      static constexpr auto sysToken = TID{1};

      static constexpr uint8_t untransferable = 0;
      static constexpr uint8_t unrecallable   = 1;
      static constexpr uint8_t autoDebit      = 0;

      Tokens(psio::shared_pssz<psibase::Action> action);

      void init();

      /// Create a new token
      ///
      /// # Arguments
      /// * `precision` - Amount of decimal places in the token, 4 = 1.0000. 8 = 1.00000000
      /// * `max_issued_supply` - The permanent max issued supply of the token
      ///
      /// Returns the unique token identifier aka TID (u32)
      TID create(Precision precision, Quantity max_issued_supply);

      /// Mint / Issue new tokens into existence
      ///
      /// Only the token owner can mint new tokens, and only if the total issuance
      /// does not exceed the max issued supply.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `amount`   - Amount of tokens to mint
      /// * `memo`     - Memo
      void mint(TID token_id, Quantity amount, Memo memo);

      /// Burn's the specified amount of the sender's specified tokens
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `amount`   - Amount of tokens to burn
      /// * `memo`     - Memo
      void burn(TID token_id, Quantity amount, Memo memo);

      /// Set user global configuration of sender
      ///
      /// # Arguments
      /// * `index`    - Index of the configuration flag
      ///                Valid values: [0,8)
      ///                See `Configurations` for details
      /// * `enabled`  - A `bool` indicating the intended value of the specified configuration flag
      ///
      /// Configurations:
      /// * 0: auto_debit       - If enabled, any credits of this token will be automatically debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      void setUserConf(uint8_t index, bool enabled);

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
      /// * 0: auto_debit       - If enabled, any credits of this token will be automatically debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      void setBalConf(TID token_id, uint8_t index, bool enabled);

      /// Delete the user's token-specific balance configuration
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier.
      void delBalConf(TID token_id);

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
      void setTokenConf(TID token_id, uint8_t index, bool enabled);

      /// Sets the icon of a token. Only the token owner can set the icon.
      ///
      /// The icon is served at `/icon/<token_id>` on the tokens subdomain.
      ///
      /// # Arguments
      /// * `tokenId`     - Unique token identifier
      /// * `image`       - Image bytes, at most 32 KiB
      /// * `contentType` - Image type: 0 = PNG, 1 = JPEG, 2 = WebP
      void setIcon(TID token_id, std::vector<char> image, uint8_t contentType);

      /// Removes the icon of a token. Only the token owner can remove the icon.
      ///
      /// # Arguments
      /// * `tokenId` - Unique token identifier
      void removeIcon(TID token_id);

      /// Credit tokens to a debitor (recipient).
      ///
      /// On credit, tokens are typically placed in the shared balance and debited by the debitor. However,
      /// if the debitor has enabled `auto_debit`, then the tokens will be debited automatically.
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
      void credit(TID token_id, psibase::AccountNumber debitor, Quantity amount, Memo memo);

      /// Uncredit tokens that were credited into a shared balance
      ///
      /// On credit, tokens are typically placed in the shared balance and debited by the debitor. However,
      /// if the debitor has enabled `auto_debit`, then the tokens will be debited automatically.
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
      void uncredit(TID token_id, psibase::AccountNumber debitor, Quantity amount, Memo memo);

      /// Rejects the shared balance between a creditor and a debitor
      ///
      /// On credit, tokens are typically placed in the shared balance and debited by the debitor. However,
      /// if the debitor has enabled `auto_debit`, then the tokens will be debited automatically.
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
      void reject(TID token_id, psibase::AccountNumber creditor, Memo memo);

      /// Debit tokens that were credited into a shared balance
      ///
      /// On credit, tokens are typically placed in the shared balance and debited by the debitor. However,
      /// if the debitor has enabled `auto_debit`, then the tokens will be debited automatically.
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
      void debit(TID token_id, psibase::AccountNumber creditor, Quantity amount, Memo memo);

      /// Recalls an amount of tokens from a user's primary or sub-account balance and burns them
      ///
      /// Only the token owner can recall tokens, and only if the token is not marked as unrecallable.
      ///
      /// # Arguments
      /// * `token_id`    - Unique token identifier
      /// * `from`        - User account from which to recall
      /// * `amount`      - Amount of tokens to recall
      /// * `memo`        - Memo
      /// * `subAccount`  - If specified, recall from this sub-account of `from`
      void recall(TID                        token_id,
                  psibase::AccountNumber     from,
                  Quantity                   amount,
                  Memo                       memo,
                  std::optional<std::string> sub_account);

      /// Recalls an amount of tokens from a shared balance and burns them
      ///
      /// Only the token owner can recall tokens, and only if the token is not marked as unrecallable.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `creditor` - Account that credited the tokens
      /// * `debitor`  - Account that received the credit
      /// * `amount`   - Amount of tokens to recall
      /// * `memo`     - Memo
      void recallShared(TID                    token_id,
                        psibase::AccountNumber creditor,
                        psibase::AccountNumber debitor,
                        Quantity               amount,
                        Memo                   memo);

      /// Sends tokens from an account's primary balance into a "sub-account" balance
      ///
      /// The sub-account will be created if it does not exist.
      ///
      /// If a sub-account is created in this way, it will be deleted automatically when
      /// it has no token balances. To persist the sub-account until manually deleted, use
      /// `createSub`.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `sub_account` - Sub-account key
      /// * `amount`   - Amount of tokens to send
      void toSub(TID token_id, std::string sub_account, Quantity amount);

      /// Returns tokens from a "sub-account" balance into the account's primary balance
      ///
      /// If the subaccount was created using `toSub`, then it will be automatically deleted if this action
      /// results in the sub-account having no token balances.
      ///
      /// If the subaccount was created manually, then it must be deleted manually using `deleteSub`.
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `sub_account` - Sub-account key
      /// * `amount`   - Amount of tokens to return
      void fromSub(TID token_id, std::string sub_account, Quantity amount);

      /// Creates a new "sub-account" with an empty balance
      ///
      /// A sub-account created manually in this way must be deleted manually using
      /// `deleteSub`.
      ///
      /// This action will fail if the sub-account was already manually created. This action
      /// will succeed if the sub-account was created automatically using `toSub`, in which
      /// case the sub-account is updated to require manual deletion using `deleteSub`.
      ///
      /// # Arguments
      /// * `sub_account` - Sub-account key
      void createSub(std::string sub_account);

      /// Deletes a "sub-account" balance
      ///
      /// This action will fail if any sub-account balances are non-zero.
      ///
      /// # Arguments
      /// * `sub_account` - Sub-account key
      void deleteSub(std::string sub_account);

      // Read-only interface:

      /// Lookup token details
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      ///
      /// Returns token information including current, burned supply and precision
      TokenRecord getToken(TID token_id);

      /// Get user token balance
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `user` - User account
      ///
      /// Returns quantity of tokens in the user's balance
      Quantity getBalance(TID token_id, psibase::AccountNumber user);

      /// Get shared balance between a creditor and debitor
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `creditor` - Creditor account
      /// * `debitor` - Debitor account
      ///
      /// Returns quantity of tokens in the shared balance
      Quantity getSharedBal(TID                    token_id,
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
      /// * 0: auto_debit       - If enabled, any credits of this token will be automatically debited by
      ///                           the receiver.
      /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
      ///                           balance table, and will not need to be recreated on the next deposit.
      ///
      /// Returns a `bool` indicating whether the specified configuration flag is enabled.
      bool getBalConf(psibase::AccountNumber account, TID token_id, uint8_t index);

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
      /// * 0: auto_debit       - If enabled, any credits of this token will be automatically debited by
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
      bool getTokenConf(TID token_id, uint8_t index);

      /// Sets the system token
      ///
      /// # Arguments
      /// * `tokenId` - Identifier of a previously created token
      ///
      /// # Notes
      /// * Only the service account can set the system token
      /// * The system token can only be set once (changing system token is not yet supported)
      void setSysToken(TID tokenId);

      /// Gets the system token details (if set), otherwise returns `None`
      std::optional<TokenRecord> getSysToken();

      /// Get the token balance of the sender's specified sub-account
      ///
      /// # Arguments
      /// * `token_id` - Unique token identifier
      /// * `sub_account` - Sub-account key
      ///
      /// Returns the token balance of the sender's specified sub-account
      /// or `None` if the sub-account does not exist
      std::optional<Quantity> getSubBal(TID token_id, std::string sub_account);

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
            void configured(TID token_id, std::string action, Memo memo) {}
            void supplyChanged(TID token_id, Account actor, std::string action, std::string amount, Memo memo) {}
            void balChanged(TID token_id, Account account, Account counter_party, std::string action, std::string amount, Memo memo) {}
         };
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(Tokens,
      method(init),
      method(create, precision, max_issued_supply),
      method(mint, token_id, amount, memo),
      method(burn, token_id, amount, memo),
      method(setBalConf, token_id, index, enabled),
      method(delBalConf, token_id),
      method(setUserConf, index, enabled),
      method(setTokenConf, token_id, index, enabled),
      method(setIcon, token_id, image, contentType),
      method(removeIcon, token_id),
      method(credit, token_id, debitor, amount, memo),
      method(uncredit, token_id, debitor, amount, memo),
      method(reject, token_id, creditor, memo),
      method(toSub, token_id, attr(sub_account, utf8), amount),
      method(fromSub, token_id, attr(sub_account, utf8), amount),
      method(createSub, attr(sub_account, utf8)),
      method(deleteSub, attr(sub_account, utf8)),
      method(debit, token_id, creditor, amount, memo),
      method(recall, token_id, from, amount, memo, attr(sub_account, utf8)),
      method(recallShared, token_id, creditor, debitor, amount, memo),
      method(getToken, token_id),
      method(getUserConf, account, index),
      method(setSysToken, tokenId),
      method(getSysToken),
      method(getSubBal, token_id, attr(sub_account, utf8)),
      method(getBalance, token_id, user),
      method(getSharedBal, token_id, creditor, debitor),
      method(getBalConf, account, token_id, index),
      method(getTokenConf, token_id, index),
    );
   PSIBASE_REFLECT_HISTORY_EVENTS(Tokens,
      method(configured, token_id, attr(action, utf8), memo),
      method(supplyChanged, token_id, actor, attr(action, utf8), attr(amount, utf8), memo),
      method(balChanged, token_id, account, counter_party, attr(action, utf8), attr(amount, utf8), memo),
   );
   PSIBASE_REFLECT_TABLES(Tokens, Tokens::Tables)
   // clang-format on

}  // namespace UserService
