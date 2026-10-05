#include "services/user/Explorer.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <services/system/CommonApi.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;
using namespace SystemService;

using SharedBlock = psio::shared_view_ptr<Block>;

struct TransactionAuthChecker
{
   TransactionAuthChecker(std::optional<AccountNumber> user)
       : user(user ? std::vector{*user} : std::vector<AccountNumber>{})
   {
   }
   std::vector<AccountNumber>            user;
   mutable std::map<AccountNumber, bool> visited;
   bool                                  operator()(AccountNumber account) const
   {
      if (account == AccountNumber{})
         return false;
      auto [pos, inserted] = visited.try_emplace(account, false);
      if (inserted)
      {
         pos->second = to<Transact>().isAuth(
             std::vector{
                 AuthTarget{account, ServiceMethod{getReceiver(), MethodNumber{"graphql"}}}},
             user);
      }
      return pos->second;
   }
   bool operator()(psio::view<const Action> action) const
   {
      return (*this)(action.sender()) || (*this)(action.service());
   }
   bool operator()(psio::view<const Transaction> transaction) const
   {
      for (auto action : transaction.actions())
      {
         if ((*this)(action))
            return true;
      }
      return false;
   }
   bool operator()(psio::view<const SignedTransaction> transaction) const
   {
      return (*this)(*transaction.transaction());
   }
};

struct ActionQuery
{
   psio::view<const Action> action;
   AccountNumber            sender() const { return action.sender(); }
   AccountNumber            service() const { return action.service(); }
   MethodNumber             method() const { return action.method(); }
   std::string              rawData() const
   {
      std::span<const char> result = action.rawData();
      return psio::to_hex(result);
   }
   PSIO_REFLECT(ActionQuery, method(sender), method(service), method(method), method(rawData))
};

struct ActionFilter
{
   std::optional<AccountNumber> sender;
   std::optional<AccountNumber> service;
   bool                         operator()(psio::view<const Action> action)
   {
      return action.sender().unpack() == sender || action.service().unpack() == service;
   }
   bool operator()(psio::view<const Transaction> transaction)
   {
      for (auto action : transaction.actions())
      {
         if ((*this)(action))
         {
            return true;
         }
      }
      return false;
   }
};

struct TransactionQuery
{
   psio::view<const Transaction> transaction;
   std::vector<ActionQuery>      actions() const
   {
      std::vector<ActionQuery> result;
      result.reserve(transaction.actions().size());
      for (auto action : transaction.actions())
      {
         result.push_back({action});
      }
      return result;
   }
   PSIO_REFLECT(TransactionQuery, method(actions))
};

struct SignedTransactionQuery
{
   psio::view<const SignedTransaction> value;
   const TransactionAuthChecker*       censor;
   Checksum256 id() const { return sha256(value.transaction().data(), value.transaction().size()); }
   std::optional<TransactionQuery> transaction() const
   {
      if ((*censor)(value))
      {
         return TransactionQuery{*value.transaction()};
      }
      else
      {
         return std::nullopt;
      }
   }
   std::optional<std::vector<std::string>> proofs() const
   {
      if ((*censor)(value))
      {
         std::vector<std::string> result;
         result.reserve(value.proofs().size());
         for (std::span<const char> proof : value.proofs())
         {
            result.push_back(psio::to_hex(proof));
         }
         return result;
      }
      else
      {
         return std::nullopt;
      }
   }
   PSIO_REFLECT(SignedTransactionQuery, method(id), method(transaction), method(proofs))
};

struct BlockQuery
{
   SharedBlock                         block;
   const TransactionAuthChecker*       transactionCensor;
   Checksum256                         id() const { return BlockInfo{header()}.blockId; }
   BlockHeader                         header() const { return block->header(); }
   std::vector<SignedTransactionQuery> transactions() const
   {
      std::vector<SignedTransactionQuery> result;
      result.reserve(block->transactions().size());
      for (auto transaction : block->transactions())
      {
         result.push_back(SignedTransactionQuery{transaction, transactionCensor});
      }
      return result;
   }
   PSIO_REFLECT(BlockQuery, method(id), method(header), method(transactions))
};

struct Query
{
   TransactionAuthChecker transactionCensor;
   auto                   blocks() const
   {
      return psibase::TransformedConnectionView{
          psibase::TableIndex<psibase::Block, uint32_t>{psibase::DbId::blockLog, {}, false},
          [this](SharedBlock&& block) { return BlockQuery{std::move(block), &transactionCensor}; }};
   }
};
PSIO_REFLECT(  //
    Query,
    method(blocks))

namespace SystemService
{
   std::optional<psibase::HttpReply> Explorer::serveSys(psibase::HttpRequest   request,
                                                        std::optional<int32_t> socket,
                                                        std::optional<psibase::AccountNumber> user)
   {
      psibase::check(psibase::getSender() == HttpServer::service, "Wrong sender");
      if (auto result = psibase::serveGraphQL(request, Query{user}))
         return result;
      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Explorer)
