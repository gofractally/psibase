#include "test_util.hpp"

#include <psibase/Actor.hpp>
#include <psibase/nativeTables.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/CpuLimit.hpp>
#include <services/system/Producers.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

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
   ctx->pushTransaction(std::move(strx), trace, std::nullopt);
}

std::vector<psibase::AccountNumber> makeAccounts(
    const std::vector<std::string_view>& producer_names)
{
   std::vector<psibase::AccountNumber> result;
   for (auto prod : producer_names)
      result.push_back(psibase::AccountNumber{prod});
   return result;
}

auto makeBoot(const ConsensusData& producers, bool ec) -> std::vector<SignedTransaction>
{
   std::vector<SignedTransaction> result;
   std::vector<GenesisService>    services = {{
                                                  .service = Transact::service,
                                                  .flags   = Transact::serviceFlags,
                                                  .code    = readWholeFile("Transact.wasm"),
                                           },
                                              {
                                                  .service = RTransact::service,
                                                  .flags   = 0,
                                                  .code    = readWholeFile("RTransact.wasm"),
                                           },
                                              {
                                                  .service = CpuLimit::service,
                                                  .flags   = CpuLimit::serviceFlags,
                                                  .code    = readWholeFile("MockCpuLimit.wasm"),
                                           },
                                              {
                                                  .service = Accounts::service,
                                                  .flags   = 0,
                                                  .code    = readWholeFile("Accounts.wasm"),
                                           },
                                              {
                                                  .service = Producers::service,
                                                  .flags   = Producers::serviceFlags,
                                                  .code    = readWholeFile("Producers.wasm"),
                                           },
                                              {
                                                  .service = AuthAny::service,
                                                  .flags   = 0,
                                                  .code    = readWholeFile("AuthAny.wasm"),
                                           }};
   if (ec)
   {
      services.push_back({
          .service = VerifySig::service,
          .flags   = VerifySig::serviceFlags,
          .code    = readWholeFile("VerifySig.wasm"),
      });
   }
   // Transact + Producers + AuthAny + Accounts
   result.push_back({Transaction{
       //
       .actions = {
           //
           Action{.sender  = AccountNumber{"psibase"},  // ignored
                  .service = AccountNumber{"psibase"},  // ignored
                  .method  = MethodNumber{"boot"},
                  .rawData = psio::convert_to_frac(GenesisActionData{.services = services})}}}});

   result.push_back({Transaction{
       .tapos   = {.expiration = TimePointSec{Seconds(2)}},
       .actions = {
           Action{.sender  = Transact::service,
                  .service = Transact::service,
                  .method  = MethodNumber{"startBoot"},
                  .rawData = psio::to_frac(std::tuple(std::vector<Checksum256>()))},
           Action{.sender  = Accounts::service,
                  .service = Accounts::service,
                  .method  = MethodNumber{"init"},
                  .rawData = psio::to_frac(std::tuple())},
           transactor<Producers>(Producers::service, Producers::service).setConsensus(producers),
           Action{.sender  = Transact::service,
                  .service = Transact::service,
                  .method  = MethodNumber{"finishBoot"},
                  .rawData = psio::to_frac(std::tuple())}}}});
   return result;
}

static Tapos getTapos(const BlockInfo& info)
{
   Tapos result;
   result.expiration = std::chrono::time_point_cast<Seconds>(info.header.time) + Seconds(2);
   std::memcpy(&result.refBlockSuffix,
               info.blockId.data() + info.blockId.size() - sizeof(result.refBlockSuffix),
               sizeof(result.refBlockSuffix));
   result.refBlockIndex = (info.header.blockNum) & 0x7f;
   return result;
}

static Tapos getTapos(psibase::BlockContext* ctx)
{
   Tapos result;
   result.expiration = std::chrono::time_point_cast<Seconds>(ctx->current.header.time) + Seconds(1);
   std::memcpy(&result.refBlockSuffix,
               ctx->current.header.previous.data() + ctx->current.header.previous.size() -
                   sizeof(result.refBlockSuffix),
               sizeof(result.refBlockSuffix));
   result.refBlockIndex = (ctx->current.header.blockNum - 1) & 0x7f;
   return result;
}

Transaction setProducers(const psibase::ConsensusData& producers)
{
   return Transaction{
       .tapos   = {},
       .actions = {
           transactor<Producers>(Producers::service, Producers::service).setConsensus(producers)}};
}

void setProducers(psibase::BlockContext* ctx, const psibase::ConsensusData& producers)
{
   pushTransaction(
       ctx, Transaction{.tapos   = getTapos(ctx),
                        .actions = {transactor<Producers>(Producers::service, Producers::service)
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

TestBlock makeBlock(const BlockInfo&                   info,
                    const JointConsensus&              state,
                    std::string_view                   producer,
                    TermNum                            view,
                    std::vector<SignedTransaction>     trxs,
                    BlockNum                           commitNum,
                    const std::optional<BlockConfirm>& auxData = {})
{
   SignedBlock    newBlock;
   JointConsensus newState{state};
   newBlock.block.header.previous  = info.blockId;
   newBlock.block.header.blockNum  = info.header.blockNum + 1;
   newBlock.block.header.time      = info.header.time + Seconds(1);
   newBlock.block.header.producer  = AccountNumber{producer};
   newBlock.block.header.term      = view;
   newBlock.block.header.commitNum = commitNum;
   Merkle m;
   if (newState.next && newState.next->blockNum <= info.header.commitNum)
   {
      newState.current = std::move(newState.next->consensus);
      newState.next.reset();
   }
   for (auto& trx : trxs)
   {
      for (auto act : trx.transaction->actions())
      {
         if (act.service() == Producers::service && act.method() == MethodNumber{"setConsensus"})
         {
            using param_tuple =
                psio::make_param_value_tuple<decltype(&Producers::setConsensus)>::type;
            auto params                        = psio::view<const param_tuple>(act.rawData());
            newBlock.block.header.newConsensus = Consensus{get<0>(params), {}};
            check(!newState.next, "Joint consensus is already running");
            newState.next = {*newBlock.block.header.newConsensus, newBlock.block.header.blockNum};
         }
      }
      trx.subjectiveData.emplace();
      trx.subjectiveData->emplace_back();
      trx.subjectiveData->push_back(psio::to_frac(std::chrono::nanoseconds(100000)));
      m.push(TransactionInfo{trx});
   }
   newBlock.block.header.consensusState  = sha256(newState);
   newBlock.block.transactions           = std::move(trxs);
   newBlock.block.header.trxMerkleRoot   = m.root();
   newBlock.block.header.eventMerkleRoot = Checksum256{};
   if (auxData)
   {
      newBlock.auxConsensusData = psio::to_frac(*auxData);
   }
   return {BlockMessage{newBlock}, newState};
}

TestBlock makeBlock(const BlockArg& info, std::string_view producer, TermNum view)
{
   return makeBlock(info.info, info.state, producer, view, {}, info.info.header.commitNum);
}

TestBlock makeBlock(const BlockArg&    info,
                    std::string_view   producer,
                    TermNum            view,
                    const Transaction& trx)
{
   return makeBlock(info.info, info.state, producer, view, signTransactions(info, {trx}),
                    info.info.header.commitNum);
}

TestBlock makeBlock(const BlockArg&     info,
                    std::string_view    producer,
                    TermNum             view,
                    const BlockMessage& irreversible)
{
   return makeBlock(info.info, info.state, producer, view, {},
                    irreversible.block->block().header().blockNum());
}

TestBlock makeBlock(const BlockArg&     info,
                    std::string_view    producer,
                    TermNum             view,
                    const BlockConfirm& irreversible)
{
   return makeBlock(info.info, info.state, producer, view, {}, irreversible.blockNum, irreversible);
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

ViewChangeMessage makeViewChange(std::string_view                        producer,
                                 TermNum                                 view,
                                 const BlockInfo&                        prepared,
                                 std::initializer_list<std::string_view> preparers)
{
   ViewChangeMessage result{
       view, AccountNumber{producer}, {}, prepared.blockId, prepared.header.term};
   for (auto p : preparers)
   {
      result.prepares.push_back({AccountNumber{p}, {}});
   }
   return result;
}

void runFor(boost::asio::io_context& ctx, mock_clock::duration total_time)
{
   ctx.poll();
   ctx.restart();
   auto end = mock_clock::now() + total_time;
   while (mock_clock::advance(end))
   {
      ctx.poll();
      ctx.restart();
   }
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
