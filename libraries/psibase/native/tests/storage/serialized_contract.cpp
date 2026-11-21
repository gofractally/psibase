#include <unistd.h>
#include <array>
#include <atomic>
#include <condition_variable>
#include <exception>
#include <iostream>
#include <mutex>
#include <psibase/Watchdog.hpp>
#include <psibase/storage.hpp>
#include <thread>
#include <vector>
using namespace psibase;
using namespace psibase::storage;
using namespace std::chrono_literals;
const database_config config{1 << 25, 1 << 25, 1 << 25, 1 << 25};
std::span<const char> bytes(std::string_view value)
{
   return {value.data(), value.size()};
}
void require(bool result, const char* text)
{
   if (!result)
      throw std::runtime_error(text);
}
std::string get(read_session& session, const shared_root& root, std::string_view key)
{
   auto value = session.get(root, bytes(key));
   return value ? std::string(value->begin(), value->end()) : "<missing>";
}
void put(write_session& session, shared_root& root, std::string_view key, std::string_view value)
{
   session.upsert(root, bytes(key), bytes(value));
}
int main(int argc, char** argv)
{
   if (argc != 2)
      return 2;
   const auto base = std::filesystem::path(std::string(argv[1]) + "-" + std::to_string(getpid()));
   if (std::filesystem::exists(base))
      throw std::runtime_error("test path exists");
   try
   {
      {
         database    db(base / "cancelled-lock-wait", config, open_mode::create_new);
         auto        writer = db.start_write_session();
         auto        reader = db.start_read_session();
         shared_root first;
         put(*writer, first, "same", "value");
         auto second = first;
         put(*writer, second, "same", "value");
         std::mutex               mutex;
         std::condition_variable  condition;
         bool                     held = false, release = false, entered = false;
         std::atomic<unsigned>    checks = 0;
         std::exception_ptr       holderError, waiterError;
         std::atomic<bool>        fired = false;
         std::chrono::nanoseconds billed{};
         bool                     cancelled     = false;
         auto                     holderRequest = std::make_shared<accounting::Request>(
             [&]
             {
                if (++checks == 3)
                {
                   std::unique_lock lock(mutex);
                   held = true;
                   condition.notify_all();
                   condition.wait(lock, [&] { return release; });
                }
                return true;
             });
         std::thread holder(
             [&]
             {
                try
                {
                   // Only mutating work enters the writer's gate; reads no longer do.
                   accounting::Scope scope(holderRequest);
                   shared_root       copy;
                   writer->splice(copy, first, {}, {});
                   require(reader->is_equal_weak(first, copy, {}, {}),
                           "equal immutable roots differed");
                }
                catch (...)
                {
                   holderError = std::current_exception();
                }
             });
         bool didHold;
         {
            std::unique_lock lock(mutex);
            didHold = condition.wait_for(lock, 3s, [&] { return held; });
         }
         if (!didHold)
         {
            {
               std::lock_guard lock(mutex);
               release = true;
            }
            condition.notify_all();
            holder.join();
            throw std::runtime_error("native serialization gate not entered");
         }
         auto        cancelRequest = std::make_shared<accounting::Request>([] { return true; });
         auto        before        = second;
         std::thread waiter(
             [&]
             {
                try
                {
                   WatchdogManager manager;
                   Watchdog        watchdog(manager, [&] { fired = true; });
                   watchdog.setLimit(30ms);
                   auto              budget = watchdog.accountingScope();
                   accounting::Scope cancellation(cancelRequest);
                   {
                      std::lock_guard lock(mutex);
                      entered = true;
                   }
                   condition.notify_all();
                   try
                   {
                      put(*writer, second, "cancelled", "must-not-appear");
                   }
                   catch (const accounting::Cancelled&)
                   {
                      cancelled = true;
                   }
                   billed = watchdog.elapsed();
                }
                catch (...)
                {
                   waiterError = std::current_exception();
                }
             });
         bool didEnter;
         {
            std::unique_lock lock(mutex);
            didEnter = condition.wait_for(lock, 3s, [&] { return entered; });
         }
         std::this_thread::sleep_for(80ms);
         const bool expiredWhileWaiting = fired.load();
         cancelRequest->cancel();
         {
            std::lock_guard lock(mutex);
            release = true;
         }
         condition.notify_all();
         holder.join();
         waiter.join();
         if (holderError)
            std::rethrow_exception(holderError);
         if (waiterError)
            std::rethrow_exception(waiterError);
         require(didEnter && cancelled, "cancelled waiter entered mutable work");
         require(!expiredWhileWaiting && billed < 30ms, "serialization wait was charged as CPU");
         require(second == before && get(*reader, second, "cancelled") == "<missing>",
                 "cancelled waiter changed immutable root");
      }
      {
         const auto                    path = base / "cross-thread-lifetime";
         std::shared_ptr<read_session> lease;
         shared_root                   retained, privateRoot;
         {
            auto db     = std::make_shared<database>(path, config, open_mode::create_new);
            auto writer = db->start_write_session();
            put(*writer, retained, "value", "published");
            writer->set_top_root(retained);
            lease            = db->start_read_session();
            auto clone       = db->clone();
            auto cloneWriter = clone->start_write_session();
            privateRoot      = cloneWriter->get_top_root();
            put(*cloneWriter, privateRoot, "value", "private");
            cloneWriter->set_top_root(privateRoot);
            std::thread destroy([db = std::move(db), writer = std::move(writer),
                                 clone       = std::move(clone),
                                 cloneWriter = std::move(cloneWriter)] {});
            destroy.join();
         }
         require(get(*lease, retained, "value") == "published" &&
                     get(*lease, privateRoot, "value") == "private",
                 "retained revisions outlived native database unsafely");
         std::thread lastOwner([lease = std::move(lease), retained = std::move(retained),
                                privateRoot = std::move(privateRoot)] {});
         lastOwner.join();
         database reopened(path, config, open_mode::read_only);
         auto     reader = reopened.start_read_session();
         auto     proxy  = reopened.start_write_session();
         require(get(*reader, proxy->get_top_root(), "value") == "published",
                 "clone published or shutdown retained writable lock");
      }
      {
         const auto  path = base / "concurrent-publish-read-destroy";
         std::string expected;
         {
            auto        db     = std::make_shared<database>(path, config, open_mode::create_new);
            auto        writer = db->start_write_session();
            shared_root original;
            for (unsigned i = 0; i < 20; ++i)
               put(*writer, original, "key" + std::to_string(i), "frozen");
            writer->set_top_root(original);
            shared_root                      list;
            const std::array<shared_root, 1> children{original};
            writer->upsert(list, bytes("roots"), std::span(children));
            std::atomic<bool>               start = false;
            std::mutex                      errorsMutex;
            std::vector<std::exception_ptr> errors;
            std::vector<std::thread>        threads;
            for (unsigned thread = 0; thread < 4; ++thread)
               threads.emplace_back(
                   [&, original, list]
                   {
                      try
                      {
                         auto session = db->start_read_session();
                         while (!start)
                            std::this_thread::yield();
                         for (unsigned i = 0; i < 500; ++i)
                         {
                            require(
                                get(*session, original, "key" + std::to_string(i % 20)) == "frozen",
                                "concurrent writer mutated retained root");
                            std::vector<shared_root> extracted;
                            require(session->get(list, bytes("roots"), nullptr, &extracted) &&
                                        extracted.size() == 1,
                                    "root list lease failed");
                            require(get(*session, extracted[0], "key0") == "frozen",
                                    "extracted immutable child lease failed");
                         }
                      }
                      catch (...)
                      {
                         std::lock_guard lock(errorsMutex);
                         errors.push_back(std::current_exception());
                      }
                   });
            for (unsigned publisher = 0; publisher < 2; ++publisher)
               threads.emplace_back(
                   [&, publisher, original]
                   {
                      try
                      {
                         auto session = db->start_write_session();
                         auto current = original;
                         while (!start)
                            std::this_thread::yield();
                         for (unsigned i = 0; i < 30; ++i)
                         {
                            put(*session, current, "publisher",
                                std::to_string(publisher) + ":" + std::to_string(i));
                            session->set_top_root(current);
                            auto clone       = db->clone();
                            auto cloneWriter = clone->start_write_session();
                            auto privateRoot = cloneWriter->get_top_root();
                            put(*cloneWriter, privateRoot, "clone", "private");
                            cloneWriter->set_top_root(privateRoot);
                         }
                      }
                      catch (...)
                      {
                         std::lock_guard lock(errorsMutex);
                         errors.push_back(std::current_exception());
                      }
                   });
            start = true;
            for (auto& thread : threads)
               thread.join();
            if (!errors.empty())
               std::rethrow_exception(errors.front());
            expected = get(*writer, writer->get_top_root(), "publisher");
            require(expected != "<missing>", "no publisher completed");
         }
         database reopened(path, config, open_mode::read_only);
         auto     reader = reopened.start_read_session();
         auto     proxy  = reopened.start_write_session();
         require(get(*reader, proxy->get_top_root(), "publisher") == expected,
                 "cached and persistent root publication order differed");
         require(get(*reader, proxy->get_top_root(), "clone") == "<missing>",
                 "concurrent clone published private root");
      }
      std::cout << "{\"passed\":true,\"groups\":3,\"wait_not_cpu\":true,\"cancel_before_mutation\":"
                   "true,\"native_lifetime\":true,\"concurrent_publish\":true}\n";
   }
   catch (const std::exception& e)
   {
      std::cerr << e.what() << '\n';
      return 1;
   }
}
