#include <services/user/Tokens.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/commonErrors.hpp>

#include <services/user/Events.hpp>

#include "services/user/RTokens.hpp"
#include "services/user/Symbol.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace psibase;
using psio::view;
using SystemService::Accounts;
using SystemService::ServiceMethod;
using SystemService::Transact;
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

   namespace userConfig
   {
      constexpr auto manualDebit = psibase::EnumElement{"manualDebit"};
   }

   namespace tokenConfig
   {
      constexpr auto unrecallable = psibase::EnumElement{"unrecallable"};
      constexpr auto untradeable  = psibase::EnumElement{"untradeable"};
   }  // namespace tokenConfig

}  // namespace

Tokens::Tokens(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().getIndex<0>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void Tokens::init()
{
   // Set initialized flag
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.getIndex<0>().get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   auto nftService = to<Nft>();

   // Configure manual debit for self on Token and NFT
   recurse().setUserConf(userConfig::manualDebit, true);
   nftService.setUserConf(userConfig::manualDebit, true);

   // Configure manual debit for Nft on Token
   {
      auto holder  = getTokenHolder(Nft::service);
      auto flagBit = TokenHolderRecord::Configurations::value(userConfig::manualDebit);

      holder.config.set(flagBit, true);

      emit().history().userConfSet(Nft::service, userConfig::manualDebit, true);

      Tables().open<TokenHolderTable>().put(holder);
   }

   // Create system token
   auto tid = recurse().create(Precision{4}, Quantity{1'000'000'000e4});
   check(tid == TID{1}, wrongSysTokenId);

   // Make system token default untradeable
   recurse().setTokenConf(tid, tokenConfig::untradeable, true);

   // Pass system token ownership to symbol service
   auto tNft = getToken(tid).ownerNft;
   nftService.credit(tNft, Symbol::service, "Passing system token ownership");

   // Register proxy
   to<SystemService::HttpServer>().registerServer(RTokens::service);

   // Register event indices and schema
   to<EventIndex>().setSchema(ServiceSchema::make<Tokens>());

   // Event indices:
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"created"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"created"}, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"minted"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"burned"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"userConfSet"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"tokenConfSet"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"symbolMapped"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"transferred"}, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"transferred"}, 2);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"transferred"}, 3);
   to<EventIndex>().addIndex(DbId::historyEvent, Tokens::service, MethodNumber{"recalled"}, 0);
}

TID Tokens::create(Precision precision, Quantity maxSupply)
{
   auto creator    = getSender();
   auto tokenTable = Tables().open<TokenTable>();
   auto tokenIdx   = tokenTable.getIndex<0>();
   auto nftService = to<Nft>();

   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;
   check(TokenRecord::isValidKey(newId), invalidTokenId);
   check(maxSupply.value > 0, supplyGt0);

   auto nftId = nftService.mint();
   if (creator != Tokens::service)
   {
      nftService.credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));
   }

   emit().history().created(newId, creator, precision, maxSupply);

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply,  //
   });

   return newId;
}

void Tokens::mint(TID tokenId, Quantity amount, view<const Memo> memo)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not sumExceeds(token.currentSupply.value, amount.value, token.maxSupply.value),
         maxSupplyExceeded);

   emit().history().minted(tokenId, sender, amount, memo);

   token.currentSupply += amount;
   balance.balance += amount.value;
   Tables().open<TokenTable>().put(token);
   Tables().open<BalanceTable>().put(balance);
}

void Tokens::burn(TID tokenId, Quantity amount)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(balance.balance >= amount.value, insufficientBalance);

   balance.balance -= amount.value;

   if (balance.balance == 0)
   {
      Tables().open<BalanceTable>().erase(BalanceKey{sender, tokenId});
   }
   else
   {
      Tables().open<BalanceTable>().put(balance);
   }

   emit().history().burned(tokenId, sender, amount);
}

void Tokens::setUserConf(psibase::EnumElement flag, bool enable)
{
   auto sender  = getSender();
   auto holder  = getTokenHolder(sender);
   auto flagBit = TokenHolderRecord::Configurations::value(flag);

   if (not holder.config.get(flagBit) == enable)
   {
      holder.config.set(flagBit, enable);

      emit().history().userConfSet(sender, flag, enable);

      Tables().open<TokenHolderTable>().put(holder);
   }
}

void Tokens::setTokenConf(TID tokenId, psibase::EnumElement flag, bool enable)
{
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   if (flag == tokenConfig::unrecallable)
   {
      check(enable, invalidConfigUpdate);
   }

   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::value(flag);

   emit().history().tokenConfSet(tokenId, getSender(), flag, enable);

   token.config.set(flagIndex, enable);
   Tables().open<TokenTable>().put(token);
}

void Tokens::credit(TID tokenId, AccountNumber receiver, Quantity amount, view<const Memo> memo)
{
   auto sender      = getSender();
   auto balance     = getBalance(tokenId, sender);
   auto token       = getToken(tokenId);
   auto untradeable = getTokenConf(tokenId, tokenConfig::untradeable);

   check(sender != receiver, senderIsReceiver);
   check(amount.value > 0, quantityGt0);
   check(amount.value <= balance.balance, insufficientBalance);
   if (not isSenderIssuer(tokenId))
   {  // Token issuer may still distribute untradeable tokens
      check(untradeable == false, tokenUntradeable);
   }

   balance.balance -= amount.value;
   auto balanceTable = Tables().open<BalanceTable>();
   balanceTable.put(balance);

   auto manualDebitFlag = TokenHolderConfig::value(userConfig::manualDebit);
   bool manualDebitBit  = getTokenHolder(receiver).config.get(manualDebitFlag);
   if (manualDebitBit)
   {
      auto sharedBalance = getSharedBal(tokenId, sender, receiver);
      sharedBalance.balance += amount.value;
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   else
   {
      auto time            = to<Transact>().currentBlock().time;
      auto receiverBalance = getBalance(tokenId, receiver);
      receiverBalance.balance += amount.value;
      Tables().open<BalanceTable>().put(receiverBalance);

      emit().history().transferred(tokenId, time, sender, receiver, amount, memo);
   }
}

void Tokens::uncredit(TID              tokenId,
                      AccountNumber    receiver,
                      Quantity         maxAmount,
                      view<const Memo> memo)
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
      Tables().open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   Tables().open<BalanceTable>().put(creditorBalance);
}

void Tokens::debit(TID tokenId, AccountNumber sender, Quantity amount, view<const Memo> memo)
{
   auto receiver        = getSender();  //The action sender is the token receiver
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto receiverBalance = getBalance(tokenId, receiver);
   auto time            = to<Transact>().currentBlock().time;

   check(amount.value > 0, quantityGt0);
   check(sharedBalance.balance >= amount.value, insufficientBalance);

   sharedBalance.balance -= amount.value;
   receiverBalance.balance += amount.value;

   if (sharedBalance.balance == 0)
   {
      Tables().open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   Tables().open<BalanceTable>().put(receiverBalance);

   emit().history().transferred(tokenId, time, sender, receiver, amount,
                                memo);  // Index on sender and receiver
}

void Tokens::recall(TID tokenId, AccountNumber from, Quantity amount, view<const Memo> memo)
{
   auto sender          = getSender();
   auto token           = getToken(tokenId);
   auto fromBalance     = getBalance(tokenId, from);
   auto unrecallableBit = TokenRecord::Configurations::value(tokenConfig::unrecallable);
   auto time            = to<Transact>().currentBlock().time;

   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not token.config.get(unrecallableBit), tokenUnrecallable);
   check(amount.value > 0, quantityGt0);
   check(fromBalance.balance >= amount.value, insufficientBalance);

   // Recall is ultimately a remote burn
   fromBalance.balance -= amount.value;

   auto balanceTable = Tables().open<BalanceTable>();
   balanceTable.put(fromBalance);

   emit().history().recalled(tokenId, time, from, amount, memo);
}

void Tokens::mapSymbol(TID tokenId, SID symbolId)
{
   auto sender     = getSender();
   auto symbol     = to<Symbol>().getSymbol(symbolId);
   auto token      = getToken(tokenId);
   auto nftService = to<Nft>();

   check(symbol.ownerNft != NID{0}, symbolDNE);
   check(nftService.exists(symbol.ownerNft), missingRequiredAuth);
   check(token.symbolId == SID{0}, tokenHasSymbol);
   check(isSenderIssuer(tokenId), missingRequiredAuth);

   // Take ownership of the symbol owner NFT
   auto debitMemo = "Mapping symbol " + symbolId.str() + " to token " + std::to_string(tokenId);
   nftService.debit(symbol.ownerNft, debitMemo);

   emit().history().symbolMapped(tokenId, sender, symbolId);

   // Store mapping
   token.symbolId = symbolId;
   Tables().open<TokenTable>().put(token);

   // Destroy symbol owner NFT, it can never be used or traded again
   nftService.burn(symbol.ownerNft);
}

TokenRecord Tokens::getToken(TID tokenId)
{
   auto tokenTable = Tables().open<TokenTable>();
   auto tokenOpt   = tokenTable.get(tokenId);
   psibase::check(tokenOpt.has_value(), tokenDNE);

   return *tokenOpt;
}

SID Tokens::getTokenSymbol(TID tokenId)
{
   auto token = getToken(tokenId);
   psibase::check(token.symbolId != SID{0}, noMappedSymbol);

   return token.symbolId;
}

bool Tokens::exists(TID tokenId)
{
   return Tables().open<TokenTable>().get(tokenId).has_value();
}

BalanceRecord Tokens::getBalance(TID tokenId, AccountNumber account)
{
   auto balanceTable = Tables().open<BalanceTable>();
   auto balanceOpt   = balanceTable.get(BalanceKey{account, tokenId});

   BalanceRecord record;
   if (balanceOpt != std::nullopt)
   {
      record = *balanceOpt;
   }
   else
   {
      check(to<Accounts>().exists(account), invalidAccount);
      check(exists(tokenId), tokenDNE);

      record = {.key = {account, tokenId}, .balance = 0};
   }

   return record;
}

SharedBalanceRecord Tokens::getSharedBal(TID tokenId, AccountNumber creditor, AccountNumber debitor)
{
   auto             sharedBalanceTable = Tables().open<SharedBalanceTable>();
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

TokenHolderRecord Tokens::getTokenHolder(AccountNumber account)
{
   auto acTable = Tables().open<TokenHolderTable>();
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

bool Tokens::getUserConf(psibase::AccountNumber account, psibase::EnumElement flag)
{
   auto holder = Tables().open<TokenHolderTable>().getIndex<0>().get(account);
   if (holder.has_value() == false)
   {
      return false;
   }
   else
   {
      return (*holder).config.get(TokenHolderConfig::value(flag));
   }
}

bool Tokens::getTokenConf(TID tokenId, psibase::EnumElement flag)
{
   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::value(flag);

   return token.config.get(flagIndex);
}

void Tokens::checkAccountValid(psibase::AccountNumber account)
{
   check(to<Accounts>().exists(account), invalidAccount);
   check(account != Accounts::nullAccount, invalidAccount);
}

bool Tokens::isSenderIssuer(TID tokenId)
{
   auto token      = getToken(tokenId);
   auto nftService = to<Nft>();

   return nftService.exists(token.ownerNft) &&
          nftService.getNft(token.ownerNft).owner == getSender();
}

PSIBASE_DISPATCH(UserService::Tokens)
