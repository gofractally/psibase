#pragma once

#include <boost/asio/any_io_executor.hpp>
#include <boost/log/attributes/scoped_attribute.hpp>
#include <boost/log/expressions/keyword.hpp>
#include <boost/log/sources/global_logger_storage.hpp>
#include <boost/log/sources/record_ostream.hpp>
#include <boost/log/sources/severity_channel_logger.hpp>
#include <boost/log/sources/severity_logger.hpp>
#include <boost/log/utility/manipulators/add_value.hpp>
#include <boost/program_options/variables_map.hpp>

#include <psibase/block.hpp>
#include <psio/json_value.hpp>

#include <cstdint>
#include <span>

namespace psibase
{
   class ConfigFile;
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
         critical,
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
      void        configure(const boost::program_options::variables_map&);
      std::string get_config();

      class Config;
      void configure(const Config&);
      void to_config(const Config& obj, ConfigFile& file);
      class Config
      {
        public:
         /// The configuration of the running loggers
         static Config get();
         /// Reads `{"<logger>": {"type", "filter", "format", <options of
         /// the sink type>}, ...}`. Throws `std::runtime_error` when `json`
         /// is not such a document, or a filter, a format or an option
         /// does not parse.
         static Config fromJson(const psio::json_value& json);
         /// The same document, for the configuration this holds
         psio::json_value toJson() const;

        private:
         friend void configure(const Config&);
         friend void to_config(const Config& obj, ConfigFile& file);

         struct Impl;
         std::shared_ptr<Impl> impl;
      };

      inline auto scopedBlockHeader(auto& logger, const BlockHeader& header, const Checksum256& id)
      {
         BlockHeader result{header};
         result.authCode.reset();
         return std::tuple{
             ::boost::log::add_scoped_logger_attribute(
                 logger, "BlockHeader", boost::log::attributes::constant<BlockHeader>(result)),
             ::boost::log::add_scoped_logger_attribute(
                 logger, "BlockId", boost::log::attributes::constant< ::psibase::Checksum256>(id))};
      }

      // Fixes anything that is not allowed in a log message
      // - control characters except tabs
      // More may be added in the future. This conversion may
      // not be reversible.
      std::string sanitize(std::string message);

   }  // namespace loggers

#define PSIBASE_LOG(logger, log_level) BOOST_LOG_SEV(logger, psibase::loggers::level::log_level)

#define PSIBASE_LOG_CONTEXT_BLOCK(logger, header, id) \
   auto _psibase_log_ctx = ::psibase::loggers::scopedBlockHeader(logger, header, id)

}  // namespace psibase
