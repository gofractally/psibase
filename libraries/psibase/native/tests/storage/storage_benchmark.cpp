#include <unistd.h>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <psibase/Watchdog.hpp>
#include <psibase/storage.hpp>
#include <psitri/engines/big.hpp>
#include <string>

using namespace std::chrono;
using Engine = psitri::big_engine;
std::string key(unsigned index)
{
   std::string result(16, '\0');
   for (unsigned i = 0; i < 4; ++i)
      result[i] = char(index >> (24 - i * 8));
   return result;
}
template <typename F>
auto measure(F function)
{
   auto wall = steady_clock::now();
   auto cpu  = psibase::RunClock::now();
   function();
   return std::pair(duration_cast<nanoseconds>(steady_clock::now() - wall).count(),
                    (psibase::RunClock::now() - cpu).count());
}
int main(int argc, char** argv)
{
   if (argc != 2)
      return 2;
   constexpr unsigned records = 10000, reads = 20000, updates = 2000;
   const auto parent = std::filesystem::path(std::string(argv[1]) + "-" + std::to_string(getpid()));
   if (std::filesystem::exists(parent))
      throw std::runtime_error("benchmark path exists");
   std::filesystem::create_directories(parent);
   Engine::config config;
   config.sync_mode                = psitri::sync_mode::fsync;
   config.enable_read_cache        = false;
   config.max_pinned_cache_size_mb = 0;
   auto db     = Engine::database::open(parent / "direct", psitri::open_mode::create_only, config);
   auto writer = db->start_write_session();
   auto tree   = writer->create_temporary_tree();
   psibase::storage::database    facade(parent / "facade", {1 << 25, 1 << 25, 1 << 25, 1 << 25},
                                        psibase::storage::open_mode::create_new);
   auto                          session = facade.start_write_session();
   psibase::storage::shared_root root;
   const std::string             value(128, 'v');
   auto populateDirect = measure(
       [&]
       {
          for (unsigned i = 0; i < records; ++i)
          {
             auto tx = writer->start_write_transaction(tree);
             tx.upsert(key(i), value);
             tree = tx.get_tree();
          }
       });
   auto populateFacade = measure(
       [&]
       {
          for (unsigned i = 0; i < records; ++i)
             session->upsert(root, key(i), value);
       });
   std::uint64_t checksum = 0;
   std::cout << "{\"records\":" << records << ",\"reads_per_round\":" << reads
             << ",\"updates_per_round\":" << updates
             << ",\"payload_bytes\":128,"
                "\"cache_policy\":\"disabled\",\"sync\":\"fsync\",\"rounds\":[";
   for (unsigned round = 0; round < 5; ++round)
   {
      auto directRead = measure(
          [&]
          {
             for (unsigned i = 0; i < reads; ++i)
             {
                auto found = tree.snapshot_cursor().get<std::string>(key((i * 7919) % records));
                if (!found || found->size() != 128)
                   throw std::runtime_error("direct lookup mismatch");
                checksum += found->size();
             }
          });
      auto facadeRead = measure(
          [&]
          {
             for (unsigned i = 0; i < reads; ++i)
             {
                auto found = session->get(root, key((i * 7919) % records));
                if (!found || found->size() != 128)
                   throw std::runtime_error("facade lookup mismatch");
                checksum += found->size();
             }
          });
      auto directWrite = measure(
          [&]
          {
             for (unsigned i = 0; i < updates; ++i)
             {
                auto tx = writer->start_write_transaction(tree);
                tx.upsert(key((i * 7919) % records), value);
                tree = tx.get_tree();
             }
          });
      auto facadeWrite = measure(
          [&]
          {
             for (unsigned i = 0; i < updates; ++i)
                session->upsert(root, key((i * 7919) % records), value);
          });
      if (round)
         std::cout << ',';
      std::cout << "{\"direct_read_wall_ns\":" << directRead.first
                << ",\"facade_read_wall_ns\":" << facadeRead.first
                << ",\"direct_read_cpu_ns\":" << directRead.second
                << ",\"facade_read_cpu_ns\":" << facadeRead.second
                << ",\"direct_write_wall_ns\":" << directWrite.first
                << ",\"facade_write_wall_ns\":" << facadeWrite.first
                << ",\"direct_write_cpu_ns\":" << directWrite.second
                << ",\"facade_write_cpu_ns\":" << facadeWrite.second;
      std::cout << '}';
   }
   auto directCommit = measure(
       [&]
       {
          auto tx = writer->start_transaction(0);
          tx.primary().set_root(tree);
          tx.commit();
       });
   auto facadeCommit = measure([&] { session->set_top_root(root); });
   std::cout << "],\"populate_direct_wall_ns\":" << populateDirect.first
             << ",\"populate_facade_wall_ns\":" << populateFacade.first
             << ",\"direct_commit_wall_ns\":" << directCommit.first
             << ",\"facade_commit_wall_ns\":" << facadeCommit.first << ",\"checksum\":" << checksum;
   std::cout << "}\n";
}
