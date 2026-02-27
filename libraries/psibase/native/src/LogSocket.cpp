#include <psibase/LogSocket.hpp>

#include <psibase/Socket.hpp>
#include <psibase/log.hpp>
#include <psibase/nativeTables.hpp>

using namespace psibase;

namespace
{
   struct LogSocket : Socket
   {
      LogSocket()
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("service")));
      }
      void send(Writer&, std::span<const char> data)
      {
         auto record = psio::from_frac<LogMessage>(data);
         check(record.severity <= LogMessage::Severity::critical, "Unknown severity");
         auto _ = record.service
                      ? std::optional{boost::log::add_scoped_logger_attribute(
                            logger, "Service", boost::log::attributes::constant(*record.service))}
                      : std::nullopt;
         BOOST_LOG_SEV(logger, static_cast<loggers::level>(record.severity)) << record.message;
      }
      SocketInfo             info() const { return LogSocketInfo{}; }
      loggers::common_logger logger;
   };
}  // namespace

std::shared_ptr<Socket> psibase::makeLogSocket()
{
   return std::make_shared<LogSocket>();
}
