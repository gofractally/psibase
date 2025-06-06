#include <psibase/ExecutionContext.hpp>
#include <psibase/log.hpp>
#include <psibase/mock_timer.hpp>

#include <boost/log/attributes/function.hpp>

#include <catch2/catch_all.hpp>

using namespace psibase;

struct ConsoleLog
{
   std::string type   = "console";
   std::string filter = "Severity > critical";
   std::string format =
       "[{TimeStamp}] [{Severity}] [{Host}]: {Message}{?: {TransactionId}}{?: {BlockId}: "
       "{BlockHeader}}";
};
PSIO_REFLECT(ConsoleLog, type, filter, format);

struct Loggers
{
   ConsoleLog stderr;
};
PSIO_REFLECT(Loggers, stderr);

std::optional<std::size_t> dataIndex;

int main(int argc, const char* const* argv)
{
   Loggers logConfig;

   ExecutionContext::registerHostFunctions();

   Catch::Session session;

   using Catch::Clara::Opt;
   auto cli =
       session.cli() |
       Opt(logConfig.stderr.filter,
           "filter")["--log-filter"]("The filter to apply to node loggers") |
       Opt(dataIndex, "index")["--data-index"]("The zero-based index into the test case data");
   session.cli(cli);

   if (int res = session.applyCommandLine(argc, argv))
      return res;

   if (auto seed = session.configData().rngSeed)
      psibase::test::global_random::set_global_seed(seed);

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

   return session.run();
}
