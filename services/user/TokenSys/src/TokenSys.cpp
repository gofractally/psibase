#include <psibase/dispatch.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/RTokenSys.hpp>
#include <services/user/TokenSys.hpp>
#include <services/user/tokenErrors.hpp>

#include "services/user/SymbolSys.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace psibase;
using psio::const_view;
using SystemService::AccountSys;
using SystemService::TransactionSys;
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

   namespace UserConfig
   {
      constexpr auto manualDebit = psibase::NamedBit{"manualDebit"};
   }

   namespace TokenConfig
   {
      constexpr auto unrecallable = psibase::NamedBit{"unrecallable"};
      constexpr auto untradeable  = psibase::NamedBit{"untradeable"};
   }  // namespace TokenConfig

}  // namespace

TokenSys::TokenSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = db.open<InitTable>().getIndex<0>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void TokenSys::init()
{
   // Set initialized flag
   auto initTable = db.open<InitTable>();
   auto init      = (initTable.getIndex<0>().get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});
   emit().history().initialized();

   auto tokService = to<TokenSys>();
   auto nftService = to<NftSys>();

   // Configure manual debit for self and NFT
   tokService.setUserConf(UserConfig::manualDebit, true);
   nftService.setUserConf(UserConfig::manualDebit, true);

   // Create system token
   auto tid = tokService.create(Precision{8}, Quantity{1'000'000'000e8});
   check(tid == TID{1}, wrongSysTokenId);

   // Make system token default untradeable
   tokService.setTokenConf(tid, TokenConfig::untradeable, true);

   // Pass system token ownership to symbol service
   auto tNft = getToken(tid).ownerNft;
   nftService.credit(tNft, SymbolSys::service, "Passing system token ownership");

   // Register proxy
   to<SystemService::ProxySys>().registerServer(RTokenSys::service);
}

TID TokenSys::create(Precision precision, Quantity maxSupply)
{
   auto creator    = getSender();
   auto tokenTable = db.open<TokenTable>();
   auto tokenIdx   = tokenTable.getIndex<0>();
   auto nftService = to<NftSys>();

   // Todo - replace with auto incrementing when available
   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;

   Precision::fracpack_validate(precision);  // Todo remove if/when happens automatically
   check(TokenRecord::isValidKey(newId), invalidTokenId);
   check(maxSupply.value > 0, supplyGt0);

   auto nftId = nftService.mint();
   if (creator != TokenSys::service)
   {
      nftService.credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));
   }

   auto lastEvent = emit().history().created(newId, creator, precision, maxSupply);

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply,  //
       .lastEvent = lastEvent,  //
   });

   return newId;
}

void TokenSys::mint(TID tokenId, Quantity amount, const_view<String> memo)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not sumExceeds(token.currentSupply.value, amount.value, token.maxSupply.value),
         maxSupplyExceeded);

   token.lastEvent = emit().history().minted(token.lastEvent, tokenId, sender, amount, memo);

   token.currentSupply += amount;
   balance.balance += amount.value;
   db.open<TokenTable>().put(token);
   db.open<BalanceTable>().put(balance);
}

void TokenSys::burn(TID tokenId, Quantity amount)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(balance.balance >= amount.value, insufficientBalance);

   balance.balance -= amount.value;

   if (balance.balance == 0)
   {
      db.open<BalanceTable>().erase(BalanceKey{sender, tokenId});
   }
   else
   {
      db.open<BalanceTable>().put(balance);
   }

   token.lastEvent = emit().history().burned(token.lastEvent, tokenId, sender, amount);

   db.open<TokenTable>().put(token);
}

void TokenSys::setUserConf(psibase::NamedBit flag, bool enable)
{
   auto sender  = getSender();
   auto hodler  = getTokenHolder(sender);
   auto flagBit = TokenHolderRecord::Configurations::getIndex(flag);

   check(not hodler.config.get(flagBit) == enable, redundantUpdate);

   hodler.config.set(flagBit, enable);
   db.open<TokenHolderTable>().put(hodler);

   emit().history().userConfSet(sender, flag, enable);
}

void TokenSys::setTokenConf(TID tokenId, psibase::NamedBit flag, bool enable)
{
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   if (flag == TokenConfig::unrecallable)
   {
      check(enable, invalidConfigUpdate);
   }

   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::getIndex(flag);

   token.lastEvent =
       emit().history().tokenConfSet(token.lastEvent, tokenId, getSender(), flag, enable);

   token.config.set(flagIndex, enable);
   db.open<TokenTable>().put(token);
}

void TokenSys::credit(TID tokenId, AccountNumber receiver, Quantity amount, const_view<String> memo)
{
   auto sender      = getSender();
   auto balance     = getBalance(tokenId, sender);
   auto untradeable = getTokenConf(tokenId, TokenConfig::untradeable);

   check(sender != receiver, senderIsReceiver);
   check(amount.value > 0, quantityGt0);
   check(amount.value <= balance.balance, insufficientBalance);
   if (not isSenderIssuer(tokenId))
   {  // Token issuer may still distribute untradeable tokens
      check(!untradeable, tokenUntradeable);
   }

   balance.balance -= amount.value;
   db.open<BalanceTable>().put(balance);

   auto manualDebitFlag = TokenHolderConfig::getIndex(UserConfig::manualDebit);
   bool manualDebitBit  = getTokenHolder(receiver).config.get(manualDebitFlag);
   if (manualDebitBit)
   {
      auto sharedBalance = getSharedBal(tokenId, sender, receiver);
      sharedBalance.balance += amount.value;
      db.open<SharedBalanceTable>().put(sharedBalance);
   }
   else
   {
      auto time    = to<TransactionSys>().currentBlock().time;
      auto balance = getBalance(tokenId, receiver);
      balance.balance += amount.value;
      db.open<BalanceTable>().put(balance);

      auto senderHolder             = getTokenHolder(sender);
      senderHolder.lastHistoryEvent = emit().history().transferred(
          senderHolder.lastHistoryEvent, tokenId, time, sender, receiver, amount, memo);
      db.open<TokenHolderTable>().put(senderHolder);

      auto receiverHolder             = getTokenHolder(receiver);
      receiverHolder.lastHistoryEvent = emit().history().transferred(
          receiverHolder.lastHistoryEvent, tokenId, time, sender, receiver, amount, memo);
      db.open<TokenHolderTable>().put(receiverHolder);
   }
}

void TokenSys::uncredit(TID                tokenId,
                        AccountNumber      receiver,
                        Quantity           maxAmount,
                        const_view<String> memo)
{
   auto sender          = getSender();
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto creditorBalance = getBalance(tokenId, sender);
   auto uncreditAmt     = std::min(maxAmount.value, sharedBalance.balance);

   check(maxAmount.value > 0, quantityGt0);
   check(sharedBalance.balance > 0, insufficientBalance);

   sharedBalance.balance -= uncreditAmt;
   creditorBalance.balance += uncreditAmt;

   if (sharedBalance.balance == 0)
   {
      db.open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      db.open<SharedBalanceTable>().put(sharedBalance);
   }
   db.open<BalanceTable>().put(creditorBalance);
}

void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
   auto receiver        = getSender();  //The action sender is the token receiver
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto receiverBalance = getBalance(tokenId, receiver);
   auto time            = to<TransactionSys>().currentBlock().time;

   check(amount.value > 0, quantityGt0);
   check(sharedBalance.balance >= amount.value, insufficientBalance);

   sharedBalance.balance -= amount.value;
   receiverBalance.balance += amount.value;

   if (sharedBalance.balance == 0)
   {
      db.open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      db.open<SharedBalanceTable>().put(sharedBalance);
   }
   db.open<BalanceTable>().put(receiverBalance);

   auto senderHolder             = getTokenHolder(sender);
   senderHolder.lastHistoryEvent = emit().history().transferred(
       senderHolder.lastHistoryEvent, tokenId, time, sender, receiver, amount, memo);
   db.open<TokenHolderTable>().put(senderHolder);

   auto receiverHolder             = getTokenHolder(receiver);
   receiverHolder.lastHistoryEvent = emit().history().transferred(
       receiverHolder.lastHistoryEvent, tokenId, time, sender, receiver, amount, memo);
   db.open<TokenHolderTable>().put(receiverHolder);
}

void TokenSys::recall(TID tokenId, AccountNumber from, Quantity amount, const_view<String> memo)
{
   auto token           = getToken(tokenId);
   auto fromBalance     = getBalance(tokenId, from);
   auto unrecallableBit = TokenRecord::Configurations::getIndex(TokenConfig::unrecallable);
   auto time            = to<TransactionSys>().currentBlock().time;

   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not token.config.get(unrecallableBit), tokenUnrecallable);
   check(amount.value > 0, quantityGt0);
   check(fromBalance.balance >= amount.value, insufficientBalance);

   // Recall is ultimately a remote burn
   fromBalance.balance -= amount.value;

   auto balanceTable = db.open<BalanceTable>();
   balanceTable.put(fromBalance);

   auto holder = getTokenHolder(from);
   holder.lastHistoryEvent =
       emit().history().recalled(holder.lastHistoryEvent, tokenId, time, from, amount, memo);
   db.open<TokenHolderTable>().put(holder);
}

void TokenSys::mapSymbol(TID tokenId, SID symbolId)
{
   auto sender     = getSender();
   auto symbol     = to<SymbolSys>().getSymbol(symbolId);
   auto token      = getToken(tokenId);
   auto nftService = to<NftSys>();

   check(symbol.ownerNft != NID{0}, symbolDNE);
   check(nftService.exists(symbol.ownerNft), missingRequiredAuth);
   check(token.symbolId == SID{0}, tokenHasSymbol);
   check(isSenderIssuer(tokenId), missingRequiredAuth);

   // Take ownership of the symbol owner NFT
   auto debitMemo = "Mapping symbol " + symbolId.str() + " to token " + std::to_string(tokenId);
   nftService.debit(symbol.ownerNft, debitMemo);

   // Emit mapped event
   token.lastEvent = emit().history().symbolMapped(token.lastEvent, tokenId, sender, symbolId);

   // Store mapping
   token.symbolId = symbolId;
   db.open<TokenTable>().put(token);

   // Destroy symbol owner NFT, it can never be used or traded again
   nftService.burn(symbol.ownerNft);
}

TokenRecord TokenSys::getToken(TID tokenId)
{
   auto tokenTable = db.open<TokenTable>();
   auto tokenIdx   = tokenTable.getIndex<0>();
   auto tokenOpt   = tokenIdx.get(tokenId);
   psibase::check(tokenOpt.has_value(), tokenDNE);

   return *tokenOpt;
}

SID TokenSys::getTokenSymbol(TID tokenId)
{
   auto token = getToken(tokenId);
   psibase::check(token.symbolId != SID{0}, noMappedSymbol);

   return token.symbolId;
}

bool TokenSys::exists(TID tokenId)
{
   return db.open<TokenTable>().getIndex<0>().get(tokenId).has_value();
}

BalanceRecord TokenSys::getBalance(TID tokenId, AccountNumber account)
{
   auto balanceTable = db.open<BalanceTable>();
   auto balanceIdx   = balanceTable.getIndex<0>();
   auto balanceOpt   = balanceIdx.get(BalanceKey{account, tokenId});

   BalanceRecord record;
   if (balanceOpt != std::nullopt)
   {
      record = *balanceOpt;
   }
   else
   {
      check(to<AccountSys>().exists(account), invalidAccount);
      check(exists(tokenId), tokenDNE);

      record = {.key = {account, tokenId}, .balance = 0};
   }

   return record;
}

SharedBalanceRecord TokenSys::getSharedBal(TID           tokenId,
                                           AccountNumber creditor,
                                           AccountNumber debitor)
{
   auto             sharedBalanceTable = db.open<SharedBalanceTable>();
   auto             sbIdx              = sharedBalanceTable.getIndex<0>();
   SharedBalanceKey key                = {creditor, debitor, tokenId};
   auto             sbOpt              = sbIdx.get(key);

   SharedBalanceRecord record;
   if (sbOpt != std::nullopt)
   {
      record = *sbOpt;
   }
   else
   {
      checkAccountValid(creditor);
      checkAccountValid(debitor);
      check(creditor != debitor, creditorIsDebitor);
      check(exists(tokenId), tokenDNE);

      record = {.key = key, .balance = 0};
   }

   return record;
}

TokenHolderRecord TokenSys::getTokenHolder(AccountNumber account)
{
   auto acTable = db.open<TokenHolderTable>();
   auto acIdx   = acTable.getIndex<0>();
   auto acOpt   = acIdx.get(account);

   TokenHolderRecord record;
   if (acOpt != std::nullopt)
   {
      record = *acOpt;
   }
   else
   {
      checkAccountValid(account);
      record = TokenHolderRecord{account};
   }

   return record;
}

bool TokenSys::getUserConf(psibase::AccountNumber account, psibase::NamedBit flag)
{
   auto hodler = db.open<TokenHolderTable>().getIndex<0>().get(account);
   if (!hodler.has_value())
   {
      return false;
   }

   return (*hodler).config.get(TokenHolderConfig::getIndex(flag));
}

bool TokenSys::getTokenConf(TID tokenId, psibase::NamedBit flag)
{
   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::getIndex(flag);

   return token.config.get(flagIndex);
}

void TokenSys::checkAccountValid(psibase::AccountNumber account)
{
   check(to<AccountSys>().exists(account), invalidAccount);
   check(account != AccountSys::nullAccount, invalidAccount);
}

bool TokenSys::isSenderIssuer(TID tokenId)
{
   auto token      = getToken(tokenId);
   auto nftService = to<NftSys>();

   return nftService.exists(token.ownerNft) &&
          nftService.getNft(token.ownerNft).owner == getSender();
}

PSIBASE_DISPATCH(UserService::TokenSys)
