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
   std::filesystem::remove_all(path);
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

void runFor(boost::asio::io_context& ctx, mock_clock::duration total_time)
{
   for (auto end = mock_clock::now() + total_time; mock_clock::now() < end; mock_clock::advance())
   {
      ctx.poll();
   }
}
