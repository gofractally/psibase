#include "fuzz.hpp"
#include <boost/log/attributes/function.hpp>
#include "test_util.hpp"

#include <triedent/database.hpp>

using namespace psibase;
using namespace psibase::test;
using namespace std::literals::chrono_literals;

namespace psibase::test
{
   namespace
   {
      mock_clock::time_point                         mock_current_time;
      std::vector<std::shared_ptr<mock_timer::impl>> timer_queue;
      std::mutex                                     queue_mutex;
      void cancel_timer(const std::shared_ptr<mock_timer::impl>& impl)
      {
         auto pos = std::find(timer_queue.begin(), timer_queue.end(), impl);
         if (pos != timer_queue.end())
         {
            swap(*pos, timer_queue.back());
            timer_queue.pop_back();
            for (const auto& f : impl->callbacks)
            {
               f(make_error_code(boost::asio::error::operation_aborted));
            }
            impl->callbacks.clear();
         }
      }
   }  // namespace

   mock_clock::time_point mock_clock::now()
   {
      std::lock_guard l{queue_mutex};
      return mock_current_time;
   }

   bool mock_clock::advance(mock_clock::time_point)
   {
      assert(!"not implemented");
   }

   void mock_clock::reset()
   {
      std::lock_guard l{queue_mutex};
      mock_current_time = {};
      timer_queue.clear();
   }
   std::ostream& operator<<(std::ostream& os, mock_clock::time_point tp)
   {
      os << tp.time_since_epoch().count();
      return os;
   }

   mock_timer::~mock_timer()
   {
      cancel();
   }
   void mock_timer::expires_at(time_point expiration)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = expiration;
   }
   void mock_timer::expires_after(duration d)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = mock_current_time + d;
   }
   void mock_timer::async_wait(std::function<void(const std::error_code&)> callback)
   {
      std::lock_guard l{queue_mutex};
      _impl->callbacks.push_back(_impl->bind(std::move(callback)));
      if (_impl->callbacks.size() == 1)
      {
         timer_queue.push_back(_impl);
      }
   }
   void mock_timer::cancel()
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
   }

   global_random::result_type global_random::operator()()
   {
      return 0;
   }

}  // namespace psibase::test

void expire_one_timer(bufrng& rng)
{
   if (!timer_queue.empty())
   {
      auto              idx  = rng() % timer_queue.size();
      mock_timer::impl* head = psibase::test::timer_queue.front().get();
      {
         mock_current_time = std::max(mock_current_time, head->deadline);
         for (const auto& f : head->callbacks)
         {
            f(std::error_code{});
         }
         head->callbacks.clear();
      }
      std::swap(timer_queue[idx], timer_queue.back());
      timer_queue.pop_back();
   }
}

void reset_mock_time(mock_clock::time_point new_now)
{
   mock_current_time = new_now;
   timer_queue.clear();
}

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format =
       "[{TimeStamp}] [{Severity}] [{Host}]: {Message}{?: {BlockId}: {BlockHeader}}";
};
PSIO_REFLECT(ConsoleLog, type, filter, format);

struct Loggers
{
   ConsoleLog stderr;
};
PSIO_REFLECT(Loggers, stderr);

void init_logging(const Loggers& logConfig)
{
   loggers::configure(psio::convert_from_json<loggers::Config>(psio::convert_to_json(logConfig)));

   // Replace timestamp with mock clock
   {
      auto core = boost::log::core::get();
      auto attr = boost::log::attributes::function<std::chrono::system_clock::time_point>(
          []()
          {
             return std::chrono::system_clock::time_point{
                 psibase::test::mock_clock::now().time_since_epoch()};
          });
      auto [iter, inserted] = core->add_global_attribute("TimeStamp", attr);
      if (!inserted)
      {
         core->remove_global_attribute(iter);
         core->add_global_attribute("TimeStamp", attr);
      }
   }
}

void handleArgs(int argc, const char** argv)
{
   Loggers logConfig;
   for (int i = 1; i < argc; ++i)
   {
      if (std::string_view("--log-filter") == argv[i])
      {
         ++i;
         if (i == argc)
         {
            break;
         }
         logConfig.stderr.filter = argv[i];
      }
      else if (std::string_view("--help") == argv[i] || std::string_view("-h") == argv[i])
      {
         std::cerr << "Usage: " << argv[0]
                   << " [--help] [--log-filter <filter>]\n\n"
#ifdef __AFL_COMPILER
                      "AFL++ instrumented binary\n\n"
#endif
                      "Reads random bytes from stdin to control a simulation of a\n"
                      "four producer network with one malicious producer."
                   << std::endl;
         std::exit(2);
      }
   }
   ExecutionContext::registerHostFunctions();
   init_logging(logConfig);
}

namespace
{
   struct StaticDatabaseImpl
   {
      StaticDatabaseImpl(const psibase::ConsensusData* init) : systemContext(db.getSystemContext())
      {
         assert(!!init);
         AccountNumber  genesisProducer{"alice"};
         auto           writer = systemContext->sharedDatabase.createWriter();
         auto           claim  = Claim{genesisProducer};
         CompoundProver prover;
         BlockContext blockContext(*systemContext, systemContext->sharedDatabase.getHead(), writer,
                                   true);
         blockContext.start(TimePointSec{0}, genesisProducer, 0, 0);
         blockContext.callStartBlock();
         boot(&blockContext, *init);
         auto [revision, id] = blockContext.writeRevision(prover, claim);
         systemContext->sharedDatabase.setHead(*writer, revision);
         initialHead  = revision;
         initialState = writer->get_top_root();
         psibase::test::mock_current_time += 1s;
         initialClock = mock_clock::now();
      }
      void reset()
      {
         auto writer = systemContext->sharedDatabase.createWriter();
         systemContext->sharedDatabase.setHead(*writer, initialHead);
         writer->set_top_root(initialState);
         reset_mock_time(initialClock);
      }
      TempDatabase                    db;
      std::unique_ptr<SystemContext>  systemContext;
      ConstRevisionPtr                initialHead;
      std::shared_ptr<triedent::root> initialState;
      mock_clock::time_point          initialClock;
      static StaticDatabaseImpl&      instance(const psibase::ConsensusData* init = nullptr)
      {
         static StaticDatabaseImpl result(init);
         return result;
      }
   };
}  // namespace

StaticDatabase::StaticDatabase(const psibase::ConsensusData& init)
{
   StaticDatabaseImpl::instance(&init);
}
StaticDatabase::~StaticDatabase()
{
   StaticDatabaseImpl::instance().reset();
}
StaticDatabase::operator psibase::SystemContext*()
{
   return StaticDatabaseImpl::instance().systemContext.get();
}
