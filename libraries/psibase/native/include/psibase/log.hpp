#pragma once

#include <boost/asio/any_io_executor.hpp>
#include <boost/log/expressions/keyword.hpp>
#include <boost/log/sources/global_logger_storage.hpp>
#include <boost/log/sources/record_ostream.hpp>
#include <boost/log/sources/severity_channel_logger.hpp>
#include <boost/log/sources/severity_logger.hpp>
#include <boost/log/utility/manipulators/add_value.hpp>
#include <boost/program_options/variables_map.hpp>

#include <psibase/block.hpp>

#include <cstdint>
#include <span>

namespace psibase
{
   namespace loggers
   {
      std::string to_string(const Checksum256& c);

      enum class level : std::uint32_t
      {
         debug,
         info,
         notice,
         warning,
         error,
      };
      std::ostream& operator<<(std::ostream&, const level&);
      std::istream& operator>>(std::istream& is, level& l);
      using common_logger     = boost::log::sources::severity_logger_mt<level>;
      using connection_logger = boost::log::sources::severity_channel_logger<level>;
      BOOST_LOG_GLOBAL_LOGGER(generic, common_logger)

      class LogReader
      {
        public:
         explicit LogReader(boost::asio::any_io_executor);
         ~LogReader();
         void async_read(std::function<void(const std::error_code&, std::span<const char>)>);
         void cancel();
         void config(std::string_view json);

        private:
         struct Impl;
         std::unique_ptr<Impl> impl;
      };

      namespace keyword
      {
         BOOST_LOG_ATTRIBUTE_KEYWORD(BlockHeader, "BlockHeader", psibase::BlockHeader)
         BOOST_LOG_ATTRIBUTE_KEYWORD(BlockId, "BlockId", Checksum256)
      }  // namespace keyword

      // Sets the root path for file loggers.  If this is
      // not set, it defaults to the current working directory.
      // This should be called before configure, as it does not
      // affect existing loggers.
      void        set_path(std::string_view p);
      void        configure();
      void        configure(std::string_view json);
      void        configure(const boost::program_options::variables_map&);
      void        configure_default();
      std::string get_config();

      class Config;
      void configure(const Config&);
      void from_json(Config&, psio::json_token_stream&);
      void to_json(const Config&, psio::vector_stream&);
      class Config
      {
        public:
         static Config get();

        private:
         struct Impl;
         friend void           from_json(Config&, psio::json_token_stream&);
         friend void           to_json(const Config&, psio::vector_stream&);
         friend void           configure(const Config&);
         std::shared_ptr<Impl> impl;
      };

   }  // namespace loggers

#define PSIBASE_LOG(logger, log_level) BOOST_LOG_SEV(logger, psibase::loggers::level::log_level)
#define PSIBASE_LOG_BLOCK(logger, log_level, header, id)                                           \
   PSIBASE_LOG(logger, log_level) << ::boost::log::add_value(                                      \
                                         ::psibase::loggers::keyword::BlockHeader, (header))       \
                                  << ::boost::log::add_value(::psibase::loggers::keyword::BlockId, \
                                                             (id))
}  // namespace psibase
