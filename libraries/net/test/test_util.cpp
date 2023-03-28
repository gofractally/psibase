#include "test_util.hpp"

#include <psibase/Actor.hpp>
#include <psibase/nativeTables.hpp>

#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/ProducerSys.hpp>
#include <services/system/TransactionSys.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>

using namespace psibase::net;
using namespace psibase;
using namespace psibase::test;
using namespace SystemService;

std::filesystem::path randomDirName(std::string_view name)
{
   std::random_device rng;
   for (int tries = 0; tries < 5; ++tries)
   {
      auto suffix = rng() % 1000000;
      auto tmp =
          std::filesystem::temp_directory_path() / (std::string(name) + std::to_string(suffix));
      if (!std::filesystem::exists(tmp))
         return tmp;
   }
   throw std::runtime_error("Failed to find unique temp directory");
}

TempDir::TempDir(std::string_view name) : path(randomDirName(name)) {}
TempDir::~TempDir()
{
   reset();
}

void TempDir::reset()
{
   if (!path.empty())
   {
      std::filesystem::remove_all(path);
      path.clear();
   }
}

std::vector<char> readWholeFile(const std::filesystem::path& name)
{
   std::ifstream     in(name);
   std::vector<char> result;
   std::copy(std::istreambuf_iterator<char>(in.rdbuf()), std::istreambuf_iterator<char>(),
             std::back_inserter(result));
   return result;
}

void pushTransaction(BlockContext* ctx, Transaction trx)
{
   SignedTransaction strx{.transaction = trx};
   TransactionTrace  trace;
   ctx->pushTransaction(strx, trace, std::nullopt);
}

std::vector<psibase::AccountNumber> makeAccounts(
    const std::vector<std::string_view>& producer_names)
{
   std::vector<psibase::AccountNumber> result;
   for (auto prod : producer_names)
      result.push_back(psibase::AccountNumber{prod});
   return result;
}

void boot(BlockContext* ctx, const Consensus& producers)
{
   // TransactionSys + ProducerSys + AuthAnySys + AccountSys
   pushTransaction(
       ctx,
       Transaction{
           //
           .actions = {                                             //
                       Action{.sender  = AccountNumber{"psibase"},  // ignored
                              .service = AccountNumber{"psibase"},  // ignored
                              .method  = MethodNumber{"boot"},
                              .rawData = psio::convert_to_frac(GenesisActionData{
                                  .services = {{
                                                   .service = TransactionSys::service,
                                                   .flags   = TransactionSys::serviceFlags,
                                                   .code    = readWholeFile("TransactionSys.wasm"),
                                               },
                                               {
                                                   .service = AccountSys::service,
                                                   .flags   = 0,
                                                   .code    = readWholeFile("AccountSys.wasm"),
                                               },
                                               {
                                                   .service = ProducerSys::service,
                                                   .flags   = ProducerSys::serviceFlags,
                                                   .code    = readWholeFile("ProducerSys.wasm"),
                                               },
                                               {
                                                   .service = AuthAnySys::service,
                                                   .flags   = 0,
                                                   .code    = readWholeFile("AuthAnySys.wasm"),
                                               }}})}}});

   pushTransaction(
       ctx,
       Transaction{.tapos   = {.expiration = {ctx->current.header.time.seconds + 1}},
                   .actions = {Action{.sender  = AccountSys::service,
                                      .service = AccountSys::service,
                                      .method  = MethodNumber{"init"},
                                      .rawData = psio::to_frac(std::tuple())},
                               Action{.sender  = TransactionSys::service,
                                      .service = TransactionSys::service,
                                      .method  = MethodNumber{"init"},
                                      .rawData = psio::to_frac(std::tuple())},
                               transactor<ProducerSys>(ProducerSys::service, ProducerSys::service)
                                   .setConsensus(producers)}});
}

static Tapos getTapos(const BlockInfo& info)
{
   Tapos result;
   result.expiration.seconds = info.header.time.seconds + 2;
   std::memcpy(&result.refBlockSuffix,
               info.blockId.data() + info.blockId.size() - sizeof(result.refBlockSuffix),
               sizeof(result.refBlockSuffix));
   result.refBlockIndex = (info.header.blockNum) & 0x7f;
   return result;
}

static Tapos getTapos(psibase::BlockContext* ctx)
{
   Tapos result;
   result.expiration.seconds = ctx->current.header.time.seconds + 1;
   std::memcpy(&result.refBlockSuffix,
               ctx->current.header.previous.data() + ctx->current.header.previous.size() -
                   sizeof(result.refBlockSuffix),
               sizeof(result.refBlockSuffix));
   result.refBlockIndex = (ctx->current.header.blockNum - 1) & 0x7f;
   return result;
}

Transaction setProducers(const psibase::Consensus& producers)
{
   return Transaction{
       .tapos   = {},
       .actions = {transactor<ProducerSys>(ProducerSys::service, ProducerSys::service)
                       .setConsensus(producers)}};
}

void setProducers(psibase::BlockContext* ctx, const psibase::Consensus& producers)
{
   pushTransaction(
       ctx,
       Transaction{.tapos   = getTapos(ctx),
                   .actions = {transactor<ProducerSys>(ProducerSys::service, ProducerSys::service)
                                   .setConsensus(producers)}});
}

SignedTransaction signTransaction(const BlockInfo& prevBlock, const Transaction& trx)
{
   SignedTransaction result{trx};
   result.transaction->tapos() = getTapos(prevBlock);
   return result;
}

std::vector<SignedTransaction> signTransactions(const BlockInfo&                prevBlock,
                                                const std::vector<Transaction>& trxs)
{
   std::vector<SignedTransaction> result;
   for (auto& trx : trxs)
   {
      result.push_back(signTransaction(prevBlock, trx));
   }
   return result;
}

BlockMessage makeBlock(const BlockInfo&                   info,
                       std::string_view                   producer,
                       TermNum                            view,
                       std::vector<SignedTransaction>     trxs,
                       BlockNum                           commitNum,
                       const std::optional<BlockConfirm>& auxData = {})
{
   SignedBlock newBlock;
   newBlock.block.header.previous     = info.blockId;
   newBlock.block.header.blockNum     = info.header.blockNum + 1;
   newBlock.block.header.time.seconds = info.header.time.seconds + 1;
   newBlock.block.header.producer     = AccountNumber{producer};
   newBlock.block.header.term         = view;
   newBlock.block.header.commitNum    = commitNum;
   Merkle m;
   for (const auto& trx : trxs)
   {
      for (auto act : trx.transaction->actions())
      {
         if (act.service() == ProducerSys::service && act.method() == MethodNumber{"setConsensus"})
         {
            using param_tuple =
                decltype(psio::tuple_remove_view(psio::args_as_tuple(&ProducerSys::setConsensus)));
            auto params                        = psio::view<const param_tuple>(act.rawData());
            newBlock.block.header.newConsensus = get<0>(params);
         }
      }
      m.push(TransactionInfo{trx});
   }
   newBlock.block.transactions           = std::move(trxs);
   newBlock.block.header.trxMerkleRoot   = m.root();
   newBlock.block.header.eventMerkleRoot = Checksum256{};
   if (auxData)
   {
      newBlock.auxConsensusData = psio::to_frac(*auxData);
   }
   return BlockMessage{newBlock};
}

BlockMessage makeBlock(const BlockArg& info, std::string_view producer, TermNum view)
{
   return makeBlock(info, producer, view, {}, info.info.header.commitNum);
}

BlockMessage makeBlock(const BlockArg&    info,
                       std::string_view   producer,
                       TermNum            view,
                       const Transaction& trx)
{
   return makeBlock(info, producer, view, signTransactions(info, {trx}),
                    info.info.header.commitNum);
}

BlockMessage makeBlock(const BlockArg&     info,
                       std::string_view    producer,
                       TermNum             view,
                       const BlockMessage& irreversible)
{
   return makeBlock(info, producer, view, {}, irreversible.block->block().header().blockNum());
}

BlockMessage makeBlock(const BlockArg&     info,
                       std::string_view    producer,
                       TermNum             view,
                       const BlockConfirm& irreversible)
{
   return makeBlock(info, producer, view, {}, irreversible.blockNum, irreversible);
}

std::vector<ProducerConfirm> makeProducerConfirms(const std::vector<std::string_view>& names)
{
   std::vector<ProducerConfirm> result;
   for (auto name : names)
   {
      result.push_back(ProducerConfirm{AccountNumber{name}});
   }
   return result;
}

BlockConfirm makeBlockConfirm(const BlockArg&                      committed,
                              const std::vector<std::string_view>& prods,
                              const std::vector<std::string_view>& next_prods)
{
   return {committed.info.header.blockNum, makeProducerConfirms(prods),
           makeProducerConfirms(next_prods)};
}

template <NeedsSignature T>
auto sign(T&& message)
{
   return SignedMessage<std::remove_cvref_t<T>>{std::forward<T>(message)};
}

SignedMessage<PrepareMessage> makePrepare(const BlockMessage& block, std::string_view producer)
{
   BlockInfo info{block.block->block()};
   return sign(PrepareMessage{info.blockId, AccountNumber{producer}});
}

SignedMessage<CommitMessage> makeCommit(const BlockMessage& block, std::string_view producer)
{
   BlockInfo info{block.block->block()};
   return sign(CommitMessage{info.blockId, AccountNumber{producer}});
}

ViewChangeMessage makeViewChange(std::string_view producer, TermNum view)
{
   return ViewChangeMessage{view, AccountNumber{producer}};
}

void runFor(boost::asio::io_context& ctx, mock_clock::duration total_time)
{
   for (auto end = mock_clock::now() + total_time; mock_clock::now() < end; mock_clock::advance())
   {
      ctx.poll();
   }
   ctx.poll();
}

void printAccounts(std::ostream& os, const std::vector<AccountNumber>& producers)
{
   bool first = true;
   for (AccountNumber producer : producers)
   {
      if (first)
         first = false;
      else
         os << ' ';
      os << producer.str();
   }
}

std::ostream& operator<<(std::ostream& os, const NetworkPartition& obj)
{
   std::map<std::size_t, std::vector<AccountNumber>> groups;
   for (auto [producer, group] : obj.groups)
   {
      groups[group].push_back(producer);
   }
   for (auto iter = groups.begin(), end = groups.end(); iter != end;)
   {
      if (iter->second.size() > 1)
         ++iter;
      else
         iter = groups.erase(iter);
   }
   if (groups.size() == 1)
   {
      os << " ";
      printAccounts(os, groups.begin()->second);
   }
   else
   {
      for (const auto& [_, group] : groups)
      {
         os << " {";
         printAccounts(os, group);
         os << "}";
      }
   }
   return os;
}
