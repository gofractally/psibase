#include "token_sys.hpp"
#include "errors.hpp"

#include <contracts/system/account_sys.hpp>
#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace UserContract::Errors;
using namespace psibase;
using psio::const_view;
using system_contract::account_sys;

// For helpers
#include <concepts>
#include <limits>

namespace
{
   template <std::integral T>
   constexpr bool sumOverflows(T value1, T value2)
   {
      return std::numeric_limits<T>::max() - value2 < value1;
   }

   template <std::integral T>
   constexpr bool sumExceeds(T addend1, T addend2, T limit)
   {
      return sumOverflows(addend1, addend2) || addend1 + addend2 > limit;
   }
}  // namespace

TID TokenSys::create(Precision precision, Quantity maxSupply)
{
   auto creator     = get_sender();
   auto tokenTable  = db.open<TokenTable_t>();
   auto tokenIdx    = tokenTable.get_index<0>();
   auto nftContract = at<NftSys>();

   // Todo - replace with auto incrementing when available
   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;

   check(TokenRecord::isValidKey(newId), invalidTokenId);
   check(maxSupply > Quantity{0}, supplyGt0);

   auto nftId = nftContract.mint();
   nftContract.credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply   //
   });

   emit().ui().created(newId, creator, precision, maxSupply);

   return newId;
}

void TokenSys::mint(TID tokenId, Quantity amount, AccountNumber receiver, const_view<String> memo)
{
   auto sender      = get_sender();
   auto token       = getToken(tokenId);
   auto balance     = getBalance(tokenId, receiver);
   auto nftContract = at<NftSys>();

   check(amount > Quantity{0}, quantityGt0);
   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);
   check(not sumExceeds(token.currentSupply.value, amount.value, token.maxSupply.value),
         maxSupplyExceeded);

   token.currentSupply += amount;
   balance.balance += amount.value;
   db.open<TokenTable_t>().put(token);
   db.open<BalanceTable_t>().put(balance);

   emit().ui().minted(tokenId, sender, amount, receiver, memo);
}

void TokenSys::setUnrecallable(TID tokenId)
{
   auto sender      = get_sender();
   auto token       = getToken(tokenId);
   auto nftContract = at<NftSys>();

   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);

   token.flags.set(TokenRecord::Flags::unrecallable, true);
   db.open<TokenTable_t>().put(token);

   emit().ui().set(tokenId, sender, TokenRecord::Flags::unrecallable);
}

void TokenSys::burn(TID tokenId, Quantity amount)
{
   auto sender  = get_sender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   if (amount == 0)
   {
      return;
   }

   check(balance.balance >= amount.value, insufficientBalance);

   balance.balance -= amount.value;

   if (balance.balance == 0)
   {
      db.open<BalanceTable_t>().erase(BalanceKey_t{tokenId, sender});
   }
   else
   {
      db.open<BalanceTable_t>().put(balance);
   }

   emit().ui().burned(tokenId, sender, amount);
}

void TokenSys::manualDebit(bool enable)
{
   auto sender = get_sender();
   auto hodler = getTokenHolder(sender);

   check(not hodler.config.get(TokenHolderRecord::Flags::manualDebit) == enable, redundantUpdate);

   hodler.config.set(TokenHolderRecord::Flags::manualDebit, enable);
   db.open<TokenHolderTable_t>().put(hodler);

   if (enable)
   {
      emit().ui().enabledManDeb(sender);
   }
   else
   {
      emit().ui().disabledManDeb(sender);
   }
}

void TokenSys::credit(TID tokenId, AccountNumber receiver, Quantity amount, const_view<String> memo)
{
   auto sender  = get_sender();
   auto balance = getBalance(tokenId, sender);

   check(amount > Quantity{0}, quantityGt0);
   check(amount <= balance, insufficientBalance);

   balance.balance -= amount.value;
   db.open<BalanceTable_t>().put(balance);

   bool manualDebit = getTokenHolder(receiver).config.get(TokenHolderRecord::Flags::manualDebit);
   if (manualDebit)
   {
      auto sharedBalance = getSharedBal(tokenId, sender, receiver);
      sharedBalance.balance += amount.value;
      db.open<SharedBalanceTable_t>().put(sharedBalance);
   }
   else
   {
      auto balance = getBalance(tokenId, receiver);
      balance.balance += amount.value;
      db.open<BalanceTable_t>().put(balance);
   }

   emit().ui().credited(tokenId, sender, receiver, amount, memo);

   if (!manualDebit)
   {
      emit().ui().transferred(tokenId, sender, receiver, amount, memo);
   }
}

void TokenSys::uncredit(TID                tokenId,
                        AccountNumber      receiver,
                        Quantity           amount,
                        const_view<String> memo)
{
   auto sender          = get_sender();
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto creditorBalance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(sharedBalance.balance >= amount.value, insufficientBalance);

   sharedBalance.balance -= amount.value;
   creditorBalance.balance += amount.value;

   if (sharedBalance.balance == 0)
   {
      db.open<SharedBalanceTable_t>().erase(SharedBalanceKey_t{tokenId, sender, receiver});
   }
   else
   {
      db.open<SharedBalanceTable_t>().put(sharedBalance);
   }
   db.open<BalanceTable_t>().put(creditorBalance);

   emit().ui().uncredited(tokenId, sender, receiver, amount, memo);
}

void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
   auto receiver        = get_sender();  //The action sender is the token receiver
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto receiverBalance = getBalance(tokenId, receiver);

   check(amount.value > 0, quantityGt0);
   check(sharedBalance.balance >= amount.value, insufficientBalance);

   sharedBalance.balance -= amount.value;
   receiverBalance.balance += amount.value;

   if (sharedBalance.balance == 0)
   {
      db.open<SharedBalanceTable_t>().erase(SharedBalanceKey_t{tokenId, sender, receiver});
   }
   else
   {
      db.open<SharedBalanceTable_t>().put(sharedBalance);
   }
   db.open<BalanceTable_t>().put(receiverBalance);

   emit().ui().transferred(tokenId, sender, receiver, amount, memo);
}

void TokenSys::recall(TID                tokenId,
                      AccountNumber      from,
                      AccountNumber      to,
                      Quantity           amount,
                      const_view<String> memo)
{
   auto sender      = get_sender();
   auto token       = getToken(tokenId);
   auto fromBalance = getBalance(tokenId, from);
   auto toBalance   = getBalance(tokenId, to);
   auto nftContract = at<NftSys>();

   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);
   check(not token.flags.get(TokenRecord::Flags::unrecallable), tokenUnrecallable);
   check(amount.value > 0, quantityGt0);
   check(fromBalance.balance >= amount.value, insufficientBalance);

   fromBalance.balance -= amount.value;
   toBalance.balance += amount.value;

   // Todo - How should this work?
   // If it goes into shared balance between from/to, then from could uncredit.
   // If it goes into shared balance between issuer/to, then the recipient needs to know token issuer
   // Should it just directly transfer to their balance?

   auto balanceTable = db.open<BalanceTable_t>();
   balanceTable.put(fromBalance);
   balanceTable.put(toBalance);

   emit().ui().recalled(tokenId, from, to, amount, memo);
}

TokenRecord TokenSys::getToken(TID tokenId)
{
   auto tokenTable = db.open<TokenTable_t>();
   auto tokenIdx   = tokenTable.get_index<0>();
   auto tokenOpt   = tokenIdx.get(tokenId);
   psibase::check(tokenOpt.has_value(), invalidTokenId);

   return *tokenOpt;
}

bool TokenSys::exists(TID tokenId)
{
   return db.open<TokenTable_t>().get_index<0>().get(tokenId).has_value();
}

BalanceRecord TokenSys::getBalance(TID tokenId, AccountNumber account)
{
   auto balanceTable = db.open<BalanceTable_t>();
   auto balanceIdx   = balanceTable.get_index<0>();
   auto balanceOpt   = balanceIdx.get(BalanceKey_t{tokenId, account});

   BalanceRecord record;
   if (balanceOpt != std::nullopt)
   {
      record = *balanceOpt;
   }
   else
   {
      check(at<account_sys>().exists(account), invalidAccount);
      check(exists(tokenId), tokenDNE);

      record = {{tokenId, account}, 0};
   }

   return record;
}

SharedBalanceRecord TokenSys::getSharedBal(TID           tokenId,
                                           AccountNumber creditor,
                                           AccountNumber debitor)
{
   auto               sharedBalanceTable = db.open<SharedBalanceTable_t>();
   auto               sbIdx              = sharedBalanceTable.get_index<0>();
   SharedBalanceKey_t key                = {tokenId, creditor, debitor};
   auto               sbOpt              = sbIdx.get(key);

   SharedBalanceRecord record;
   if (sbOpt != std::nullopt)
   {
      record = *sbOpt;
   }
   else
   {
      _checkAccountValid(creditor);
      _checkAccountValid(debitor);
      check(creditor != debitor, creditorIsDebitor);
      check(exists(tokenId), tokenDNE);

      record = {.key = key, .balance = 0};
   }

   return record;
}

TokenHolderRecord TokenSys::getTokenHolder(AccountNumber account)
{
   auto acTable = db.open<TokenHolderTable_t>();
   auto acIdx   = acTable.get_index<0>();
   auto acOpt   = acIdx.get(account);

   TokenHolderRecord record;
   if (acOpt != std::nullopt)
   {
      record = *acOpt;
   }
   else
   {
      _checkAccountValid(account);
      record = {.account = account, .config = Bitset()};
   }

   return record;
}

bool TokenSys::isManualDebit(AccountNumber account)
{
   auto hodler = db.open<TokenHolderTable_t>().get_index<0>().get(account);
   if (hodler.has_value() == false)
   {
      return false;
   }
   else
   {
      return (*hodler).config.get(TokenHolderRecord::Flags::manualDebit);
   }
}

void TokenSys::_checkAccountValid(psibase::AccountNumber account)
{
   check(at<account_sys>().exists(account), invalidAccount);
   check(account != AccountNumber{0}, invalidAccount);
}

PSIBASE_DISPATCH(UserContract::TokenSys)