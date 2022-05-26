#include "token_sys.hpp"
#include "symbol_sys.hpp"
#include "token_errors.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/common_errors.hpp>
#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace UserContract::Errors;
using namespace psibase;
using psio::const_view;
using system_contract::account_sys;
using TokenHolderConfig = typename TokenHolderRecord::Configurations;

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

   constexpr auto unrecallable = "unrecallable"_m;
   constexpr auto manualDebit  = "manualDebit"_m;
}  // namespace

TokenSys::TokenSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = db.open<InitTable_t>().get_index<0>().get((uint8_t)0);
      check(initRecord.has_value(), uninitialized);
   }
}

void TokenSys::init()
{
   auto initTable = db.open<InitTable_t>();
   auto init      = (initTable.get_index<0>().get((uint8_t)0));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{(uint8_t)0});

   // Configure manual debit for self and NFT
   at<TokenSys>().setConfig(manualDebit, true);
   at<NftSys>().setConfig(manualDebit, true);

   // Create system token
   auto tid = at<TokenSys>().create(Precision{8}, Quantity{1'000'000'000e8});
   check(tid == TID{1}, sysTokenId);

   emit().ui().initialized();
}

TID TokenSys::create(Precision precision, Quantity maxSupply)
{
   auto creator     = get_sender();
   auto tokenTable  = db.open<TokenTable_t>();
   auto tokenIdx    = tokenTable.get_index<0>();
   auto nftContract = at<NftSys>();

   // Todo - replace with auto incrementing when available
   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;

   check(TokenRecord::isValidKey(newId), invalidTokenId);
   check(maxSupply.value > 0, supplyGt0);

   auto nftId = nftContract.mint();
   if (creator != TokenSys::contract)
   {
      nftContract.credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));
   }

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply   //
   });

   emit().ui().created(newId, creator, precision, maxSupply);

   return newId;
}

void TokenSys::mint(TID tokenId, Quantity amount, const_view<String> memo)
{
   auto sender      = get_sender();
   auto token       = getToken(tokenId);
   auto balance     = getBalance(tokenId, sender);
   auto nftContract = at<NftSys>();

   check(amount.value > 0, quantityGt0);
   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);
   check(not sumExceeds(token.currentSupply.value, amount.value, token.maxSupply.value),
         maxSupplyExceeded);

   token.currentSupply += amount;
   balance.balance += amount.value;
   db.open<TokenTable_t>().put(token);
   db.open<BalanceTable_t>().put(balance);

   emit().ui().minted(tokenId, sender, amount, memo);
}

void TokenSys::setUnrecallable(TID tokenId)
{
   auto sender          = get_sender();
   auto token           = getToken(tokenId);
   auto nftContract     = at<NftSys>();
   auto unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);

   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);

   token.config.set(unrecallableBit, true);
   db.open<TokenTable_t>().put(token);

   emit().ui().setUnrecallable(tokenId, sender);
}

void TokenSys::burn(TID tokenId, Quantity amount)
{
   auto sender  = get_sender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(balance.balance >= amount.value, insufficientBalance);

   balance.balance -= amount.value;

   if (balance.balance == 0)
   {
      db.open<BalanceTable_t>().erase(BalanceKey_t{sender, tokenId});
   }
   else
   {
      db.open<BalanceTable_t>().put(balance);
   }

   emit().ui().burned(tokenId, sender, amount);
}

void TokenSys::setConfig(psibase::NamedBit_t flag, bool enable)
{
   auto sender  = get_sender();
   auto hodler  = getTokenHolder(sender);
   auto flagBit = TokenHolderRecord::Configurations::getIndex(flag);

   check(not hodler.config.get(flagBit) == enable, redundantUpdate);

   hodler.config.set(flagBit, enable);
   db.open<TokenHolderTable_t>().put(hodler);

   emit().ui().configChanged(sender, flag, enable);
}

void TokenSys::credit(TID tokenId, AccountNumber receiver, Quantity amount, const_view<String> memo)
{
   auto sender  = get_sender();
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(amount.value <= balance.balance, insufficientBalance);

   balance.balance -= amount.value;
   db.open<BalanceTable_t>().put(balance);

   emit().ui().credited(tokenId, sender, receiver, amount, memo);
   auto manualDebitFlag = TokenHolderConfig::getIndex("manualDebit"_m);
   bool manualDebit     = getTokenHolder(receiver).config.get(manualDebitFlag);
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
      emit().ui().transferred(tokenId, sender, receiver, amount, memo);
   }
}

void TokenSys::uncredit(TID                tokenId,
                        AccountNumber      receiver,
                        Quantity           maxAmount,
                        const_view<String> memo)
{
   auto sender          = get_sender();
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto creditorBalance = getBalance(tokenId, sender);
   auto uncreditAmt     = std::min(maxAmount.value, sharedBalance.balance);

   check(maxAmount.value > 0, quantityGt0);
   check(sharedBalance.balance > 0, insufficientBalance);

   sharedBalance.balance -= uncreditAmt;
   creditorBalance.balance += uncreditAmt;

   if (sharedBalance.balance == 0)
   {
      db.open<SharedBalanceTable_t>().erase(SharedBalanceKey_t{sender, receiver, tokenId});
   }
   else
   {
      db.open<SharedBalanceTable_t>().put(sharedBalance);
   }
   db.open<BalanceTable_t>().put(creditorBalance);

   emit().ui().uncredited(tokenId, sender, receiver, uncreditAmt, memo);
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
      db.open<SharedBalanceTable_t>().erase(SharedBalanceKey_t{sender, receiver, tokenId});
   }
   else
   {
      db.open<SharedBalanceTable_t>().put(sharedBalance);
   }
   db.open<BalanceTable_t>().put(receiverBalance);

   emit().ui().transferred(tokenId, sender, receiver, amount, memo);
}

void TokenSys::recall(TID tokenId, AccountNumber from, Quantity amount, const_view<String> memo)
{
   auto sender          = get_sender();
   auto token           = getToken(tokenId);
   auto fromBalance     = getBalance(tokenId, from);
   auto nftContract     = at<NftSys>();
   auto unrecallableBit = TokenRecord::Configurations::getIndex(unrecallable);

   check(nftContract.exists(token.ownerNft), missingRequiredAuth);
   check(nftContract.getNft(token.ownerNft)->owner() == sender, missingRequiredAuth);
   check(not token.config.get(unrecallableBit), tokenUnrecallable);
   check(amount.value > 0, quantityGt0);
   check(fromBalance.balance >= amount.value, insufficientBalance);

   // Recall is ultimately a remote burn
   fromBalance.balance -= amount.value;

   auto balanceTable = db.open<BalanceTable_t>();
   balanceTable.put(fromBalance);

   emit().ui().recalled(tokenId, from, amount, memo);
}

void TokenSys::mapSymbol(TID tokenId, SID symbolId)
{
   //auto symbol = at<SymbolSys>().getSymbol(symbolId);
   // auto nftId =

   // Check that the token exists
   // Check that the token doesn't already have a mapping
   // Check that the token nft exists
   // Check that sender own the token nft

   // Check that the symbol exists
   // Check that the symbol nft exists
   // Check that TokenSys own the symbol nft

   // Store mapping
   // Destroy symbol NFT

   // Emit mapped event
}

TokenRecord TokenSys::getToken(TID tokenId)
{
   auto tokenTable = db.open<TokenTable_t>();
   auto tokenIdx   = tokenTable.get_index<0>();
   auto tokenOpt   = tokenIdx.get(tokenId);
   psibase::check(tokenOpt.has_value(), invalidTokenId);

   return *tokenOpt;
}

SymbolRecord TokenSys::getSymbol(TID tokenId)
{
   auto tokenTable = db.open<TokenTable_t>();
   auto tokenIdx   = tokenTable.get_index<0>();
   auto tokenOpt   = tokenIdx.get(tokenId);

   psibase::check(tokenOpt.has_value(), tokenDNE);
   psibase::check(tokenOpt->symbolId != SID{0}, noMappedSymbol);

   return at<SymbolSys>().getSymbol(tokenOpt->symbolId);
}

bool TokenSys::exists(TID tokenId)
{
   return db.open<TokenTable_t>().get_index<0>().get(tokenId).has_value();
}

BalanceRecord TokenSys::getBalance(TID tokenId, AccountNumber account)
{
   auto balanceTable = db.open<BalanceTable_t>();
   auto balanceIdx   = balanceTable.get_index<0>();
   auto balanceOpt   = balanceIdx.get(BalanceKey_t{account, tokenId});

   BalanceRecord record;
   if (balanceOpt != std::nullopt)
   {
      record = *balanceOpt;
   }
   else
   {
      check(at<account_sys>().exists(account), invalidAccount);
      check(exists(tokenId), tokenDNE);

      record = {.key = {account, tokenId}, .balance = 0};
   }

   return record;
}

SharedBalanceRecord TokenSys::getSharedBal(TID           tokenId,
                                           AccountNumber creditor,
                                           AccountNumber debitor)
{
   auto               sharedBalanceTable = db.open<SharedBalanceTable_t>();
   auto               sbIdx              = sharedBalanceTable.get_index<0>();
   SharedBalanceKey_t key                = {creditor, debitor, tokenId};
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
      record = TokenHolderRecord{account};
   }

   return record;
}

bool TokenSys::getConfig(psibase::AccountNumber account, psibase::NamedBit_t flag)
{
   auto hodler = db.open<TokenHolderTable_t>().get_index<0>().get(account);
   if (hodler.has_value() == false)
   {
      return false;
   }
   else
   {
      return (*hodler).config.get(TokenHolderConfig::getIndex(flag));
   }
}

void TokenSys::_checkAccountValid(psibase::AccountNumber account)
{
   check(at<account_sys>().exists(account), invalidAccount);
   check(account != AccountNumber{0}, invalidAccount);
}

PSIBASE_DISPATCH(UserContract::TokenSys)