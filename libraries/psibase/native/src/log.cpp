#include <psibase/LogQueue.hpp>
#include <psibase/log.hpp>

#include <psio/to_json.hpp>

#include <boost/log/attributes/function.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/syslog_constants.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <boost/log/utility/setup/filter_parser.hpp>
#include <boost/log/utility/setup/formatter_parser.hpp>
#include <chrono>
#include <iomanip>
#include <iostream>

#include <unistd.h>  // gethostname

namespace psibase::loggers
{
   BOOST_LOG_GLOBAL_LOGGER_DEFAULT(generic, common_logger)

   // Available attributes: Timestamp, Channel, Severity, Host
   //
   // Additional attributes for specific Channels:
   // p2p: PeerId, RemoteEndpoint
   // block: BlockId, BlockHeader

   namespace
   {

      template <typename S, typename T>
      void format_timestamp(S& os, const T& timestamp)
      {
         auto date = std::chrono::floor<std::chrono::days>(timestamp);
         auto ymd  = std::chrono::year_month_day(date);
         auto time = std::chrono::hh_mm_ss(
             std::chrono::duration_cast<std::chrono::milliseconds>(timestamp - date));
         os << std::setfill('0');
         os << std::setw(4) << (int)ymd.year() << '-' << std::setw(2) << (unsigned)ymd.month()
            << '-' << std::setw(2) << (unsigned)ymd.day();
         os << 'T' << std::setw(2) << time.hours().count() << ':' << std::setw(2)
            << time.minutes().count() << ':' << std::setw(2) << time.seconds().count() << '.'
            << std::setw(3) << time.subseconds().count() << 'Z';
         os << std::setfill(' ');
      }

      auto gelf_formatter =
          [](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
      {
         os << '{';
         os << "\"version\":\"1.1\"";

         if (auto attr = boost::log::extract<std::string>("Host", rec))
         {
            os << ",\"host\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = rec[boost::log::expressions::smessage])
         {
            os << ",\"short_message\":" << psio::convert_to_json(*attr);
         }

         if (auto timestamp =
                 boost::log::extract<std::chrono::system_clock::time_point>("TimeStamp", rec))
         {
            auto msecs =
                std::chrono::duration_cast<std::chrono::milliseconds>(timestamp->time_since_epoch())
                    .count();
            os << ",\"timestamp\":" << msecs / 1000.0;
         }

         if (auto l = boost::log::extract<level>("Severity", rec))
         {
            os << ",\"level\":";
            switch (*l)
            {
               case level::debug:
                  os << boost::log::sinks::syslog::debug;
                  break;
               case level::info:
                  os << boost::log::sinks::syslog::info;
                  break;
               case level::notice:
                  os << boost::log::sinks::syslog::notice;
                  break;
               case level::warning:
                  os << boost::log::sinks::syslog::warning;
                  break;
               case level::error:
                  os << boost::log::sinks::syslog::error;
                  break;
            }
         }

         if (auto attr = boost::log::extract<unsigned>("PeerId", rec))
         {
            os << ",\"_peer_id\":" << *attr;
         }

         if (auto attr = boost::log::extract<std::string>("RemoteEndpoint", rec))
         {
            os << ",\"_remote_endpoint\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<Checksum256>("BlockId", rec))
         {
            os << ",\"_block_id\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<BlockHeader>("BlockHeader", rec))
         {
            os << ",\"_block_header\":" << psio::convert_to_json(*attr);
         }

         os << '}';
      };

      auto json_formatter =
          [](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
      {
         os << '{';

         if (auto attr = rec[boost::log::expressions::smessage])
         {
            os << "\"Message\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<std::string>("Host", rec))
         {
            os << ",\"Host\":" << psio::convert_to_json(*attr);
         }

         if (auto timestamp =
                 boost::log::extract<std::chrono::system_clock::time_point>("TimeStamp", rec))
         {
            os << ",\"TimeStamp\":\"";
            format_timestamp(os, *timestamp);
            os << "\"";
         }

         if (auto l = boost::log::extract<level>("Severity", rec))
         {
            os << ",\"Severity\":";
            switch (*l)
            {
               case level::debug:
                  os << "\"debug\"";
                  break;
               case level::info:
                  os << "\"info\"";
                  break;
               case level::notice:
                  os << "\"notice\"";
                  break;
               case level::warning:
                  os << "\"warning\"";
                  break;
               case level::error:
                  os << "\"error\"";
                  break;
            }
         }

         if (auto attr = boost::log::extract<unsigned>("PeerId", rec))
         {
            os << ",\"PeerId\":" << *attr;
         }

         if (auto attr = boost::log::extract<std::string>("RemoteEndpoint", rec))
         {
            os << ",\"RemoteEndpoint\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<Checksum256>("BlockId", rec))
         {
            os << ",\"BlockId\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<BlockHeader>("BlockHeader", rec))
         {
            os << ",\"BlockHeader\":" << psio::convert_to_json(*attr);
         }

         os << '}';
      };

      class timestamp_formatter_factory : public boost::log::formatter_factory<char>
      {
        public:
         formatter_type create_formatter(const boost::log::attribute_name& name,
                                         const args_map&                   args)
         {
            // TODO: use std::format when it becomes available
            return [name](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
            {
               if (auto timestamp =
                       boost::log::extract<std::chrono::system_clock::time_point>(name, rec))
               {
                  format_timestamp(os, *timestamp);
               }
            };
         }
      };

      class blockid_formatter_factory : public boost::log::formatter_factory<char>
      {
        public:
         formatter_type create_formatter(const boost::log::attribute_name& name,
                                         const args_map&                   args)
         {
            return [name](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
            {
               if (auto header = boost::log::extract<Checksum256>(name, rec))
               {
                  os << loggers::to_string(*header);
               }
            };
         }
      };

      template <typename T>
      class json_formatter_factory : public boost::log::formatter_factory<char>
      {
        public:
         formatter_type create_formatter(const boost::log::attribute_name& name,
                                         const args_map&                   args)
         {
            return [name](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
            {
               if (auto header = boost::log::extract<T>(name, rec))
               {
                  os << psio::convert_to_json(*header);
               }
            };
         }
      };

      template <typename F>
      class function_formatter_factory : public boost::log::formatter_factory<char>
      {
        public:
         function_formatter_factory(const F& f) : f(f) {}
         formatter_type create_formatter(const boost::log::attribute_name&, const args_map&)
         {
            return f;
         }
         F f;
      };

      template <typename N, typename F>
      void register_function_formatter(N&& name, F&& f)
      {
         boost::log::register_formatter_factory(
             name,
             boost::make_shared<function_formatter_factory<std::decay_t<F>>>(std::forward<F>(f)));
      }

      class log_queue_backend
          : public boost::log::sinks::
                basic_formatted_sink_backend<char, boost::log::sinks::synchronized_feeding>
      {
        public:
         explicit log_queue_backend(boost::asio::any_io_executor&& ctx) : queue(std::move(ctx)) {}
         void consume(const boost::log::record_view&, const string_type& message)
         {
            queue.push(std::string(message));
         }
         LogQueue queue;
      };

      struct per_channel_formatter
      {
         void operator()(const boost::log::record_view&  rec,
                         boost::log::formatting_ostream& os) const
         {
            if (auto channel = boost::log::extract<std::string>("Channel", rec))
            {
               auto iter = formatters.find(*channel);
               if (iter != formatters.end())
               {
                  return iter->second(rec, os);
               }
            }
            return default_(rec, os);
         }
         boost::log::formatter                        default_;
         std::map<std::string, boost::log::formatter> formatters;
      };

      bool is_known_channel(std::string_view name)
      {
         return name == "p2p" || name == "consensus" || name == "chain" || name == "block";
      }
      boost::log::formatter formatter_from_json(auto&& stream, std::string& raw)
      {
         auto t = stream.peek_token();
         if (t.get().type == psio::json_token_type::type_start_object)
         {
            // parse map
            per_channel_formatter result;
            bool                  needs_comma = false;
            raw += '{';
            psio::from_json_object(
                stream,
                [&](auto key)
                {
                   auto s = stream.get_string();
                   auto f = boost::log::parse_formatter(s.begin(), s.end());
                   if (key == "default")
                   {
                      result.default_ = f;
                   }
                   else
                   {
                      if (!is_known_channel(key))
                      {
                         throw std::runtime_error("Unknown log channel: " + std::string(s));
                      }
                      result.formatters.try_emplace(std::string(key), std::move(f));
                   }
                   if (needs_comma)
                   {
                      raw.push_back(',');
                   }
                   else
                   {
                      needs_comma = true;
                   }
                   raw += psio::convert_to_json(key);
                   raw += ':';
                   raw += psio::convert_to_json(s);
                });
            raw += '}';
            return std::move(result);
         }
         else
         {
            auto s = stream.get_string();
            raw += psio::convert_to_json(s);
            return boost::log::parse_formatter(s.begin(), s.end());
         }
      }

      struct LogReaderConfig
      {
         boost::log::filter    filter;
         boost::log::formatter format = json_formatter;
      };

      void from_json(LogReaderConfig& obj, auto& stream)
      {
         psio::from_json_object(stream,
                                [&](std::string_view key)
                                {
                                   if (key == "format")
                                   {
                                      std::string tmp;
                                      obj.format = formatter_from_json(stream, tmp);
                                   }
                                   else if (key == "filter")
                                   {
                                      auto s     = stream.get_string();
                                      obj.filter = boost::log::parse_filter(s.begin(), s.end());
                                   }
                                   else
                                   {
                                      psio::from_json_skip_value(stream);
                                   }
                                });
      }

      struct sink_config
      {
         boost::log::formatter              format;
         boost::log::filter                 filter;
         std::string                        format_str;
         std::string                        filter_str;
         std::string                        type;
         std::map<std::string, std::string> args;
      };

      void from_json(sink_config& obj, auto& stream)
      {
         psio::from_json_object(stream,
                                [&](std::string_view key)
                                {
                                   if (key == "format")
                                   {
                                      obj.format = formatter_from_json(stream, obj.format_str);
                                   }
                                   else if (key == "filter")
                                   {
                                      auto s         = stream.get_string();
                                      obj.filter_str = s;
                                      obj.filter     = boost::log::parse_filter(s.begin(), s.end());
                                   }
                                   else if (key == "type")
                                   {
                                      obj.type = stream.get_string();
                                   }
                                   else
                                   {
                                      obj.args.try_emplace(std::string(key), stream.get_string());
                                   }
                                });
      }

      void to_json(const sink_config& obj, auto& stream)
      {
         stream.write('{');
         psio::to_json("type", stream);
         stream.write(':');
         psio::to_json(obj.type, stream);
         if (!obj.filter_str.empty())
         {
            stream.write(',');
            psio::to_json("filter", stream);
            stream.write(':');
            psio::to_json(obj.filter_str, stream);
         }
         stream.write(',');
         psio::to_json("format", stream);
         stream.write(':');
         stream.write(obj.format_str.data(), obj.format_str.size());
         for (const auto& [k, v] : obj.args)
         {
            stream.write(',');
            psio::to_json(k, stream);
            stream.write(':');
            psio::to_json(v, stream);
         }
         stream.write('}');
      }

      boost::shared_ptr<boost::log::sinks::sink> make_sink(const sink_config& cfg)
      {
         if (cfg.type == "console")
         {
            auto backend = boost::make_shared<boost::log::sinks::text_ostream_backend>();
            backend->add_stream(boost::shared_ptr<std::ostream>(&std::clog, boost::null_deleter()));
            auto result = boost::make_shared<
                boost::log::sinks::synchronous_sink<boost::log::sinks::text_ostream_backend>>(
                backend);
            result->set_filter(cfg.filter);
            result->set_formatter(cfg.format);
            return result;
         }
         else if (cfg.type == "file")
         {
            //
         }
         throw std::runtime_error("Unkown sink type: " + cfg.type);
      }

      void update_sink(boost::shared_ptr<boost::log::sinks::sink>& sink,
                       sink_config&                                old_cfg,
                       sink_config&&                               new_cfg)
      {
         auto core = boost::log::core::get();
         // Normally this shouldn't happen, but we'll handle it anyway
         if (old_cfg.type != new_cfg.type)
         {
            auto new_sink = make_sink(new_cfg);
            core->remove_sink(sink);
            core->add_sink(new_sink);
            old_cfg = std::move(new_cfg);
            sink    = new_sink;
         }
         else if (old_cfg.type == "console")
         {
            auto frontend = static_cast<
                boost::log::sinks::synchronous_sink<boost::log::sinks::text_ostream_backend>*>(
                sink.get());
            frontend->set_formatter(new_cfg.format);
            frontend->set_filter(new_cfg.filter);
            old_cfg = std::move(new_cfg);
         }
      }

      void do_init()
      {
         auto core = boost::log::core::get();
         core->add_global_attribute(
             "TimeStamp", boost::log::attributes::function<std::chrono::system_clock::time_point>(
                              []() { return std::chrono::system_clock::now(); }));
         char hostname[HOST_NAME_MAX + 1];
         if (gethostname(hostname, sizeof(hostname)))
         {
            throw std::system_error{errno, std::generic_category()};
         }
         hostname[HOST_NAME_MAX] = '\0';
         core->add_global_attribute("Host",
                                    boost::log::attributes::constant(std::string(hostname)));

         boost::log::register_simple_formatter_factory<level, char>("Severity");
         boost::log::register_simple_filter_factory<level, char>("Severity");
         boost::log::register_formatter_factory("TimeStamp",
                                                boost::make_shared<timestamp_formatter_factory>());
         boost::log::register_formatter_factory("BlockId",
                                                boost::make_shared<blockid_formatter_factory>());
         boost::log::register_formatter_factory(
             "BlockHeader", boost::make_shared<json_formatter_factory<BlockHeader>>());
         register_function_formatter("Json", json_formatter);
      }

      struct log_config
      {
         std::map<std::string,
                  std::pair<sink_config, boost::shared_ptr<boost::log::sinks::sink>>,
                  std::less<>>
              sinks;
         void set(auto& stream)
         {
            auto                          core = boost::log::core::get();
            std::vector<std::string_view> found_keys;
            psio::from_json_object(stream,
                                   [&](std::string_view key)
                                   {
                                      found_keys.push_back(key);
                                      auto iter = sinks.find(key);
                                      if (iter == sinks.end())
                                      {
                                         sink_config cfg;
                                         from_json(cfg, stream);
                                         auto sink = make_sink(cfg);
                                         sinks.try_emplace(std::string(key), cfg, sink);
                                         core->add_sink(sink);
                                      }
                                      else
                                      {
                                         sink_config cfg;
                                         from_json(cfg, stream);
                                         update_sink(iter->second.second, iter->second.first,
                                                     std::move(cfg));
                                      }
                                   });
            // Remove obsolete sinks
            std::sort(found_keys.begin(), found_keys.end());
            for (auto iter = sinks.begin(), end = sinks.end(); iter != end;)
            {
               if (std::binary_search(found_keys.begin(), found_keys.end(), iter->first))
               {
                  ++iter;
               }
               else
               {
                  core->remove_sink(iter->second.second);
                  iter = sinks.erase(iter);
               }
            }
         }

         static log_config& instance()
         {
            static auto result = (do_init(), log_config());
            return result;
         }
      };

      void to_json(const log_config& obj, auto& stream)
      {
         bool first = true;
         stream.write('{');
         for (const auto& [name, sink] : obj.sinks)
         {
            if (!first)
            {
               stream.write(',');
            }
            else
            {
               first = false;
            }
            psio::to_json(name, stream);
            stream.write(':');
            to_json(sink.first, stream);
         }
         stream.write('}');
      }

   }  // namespace

   void configure(std::string_view cfg)
   {
      std::vector<char> data(cfg.begin(), cfg.end());
      data.push_back(0);
      data.push_back(0);
      data.push_back(0);
      psio::json_token_stream stream(data.data());
      log_config::instance().set(stream);
   }
   void configure()
   {
      configure(R"({
         "console": {
            "type": "console",
            "filter": "%Severity% >= info",
            "format": {
               "default": "[%TimeStamp%] [%Severity%] [%Channel%]: %Message%",
               "p2p": "[%TimeStamp%] [%Severity%] [%Channel%] [%RemoteEndpoint%]: %Message%",
               "block": "[%TimeStamp%] [%Severity%] [%Channel%]: %Message% %BlockId%"
            }
         }
      })");
   }
   std::string get_config()
   {
      std::string         result;
      psio::string_stream stream{result};
      to_json(log_config::instance(), stream);
      return result;
   }

   std::ostream& operator<<(std::ostream& os, const level& l)
   {
      switch (l)
      {
         case level::debug:
            os << "debug";
            break;
         case level::info:
            os << "info";
            break;
         case level::notice:
            os << "notice";
            break;
         case level::warning:
            os << "warning";
            break;
         case level::error:
            os << "error";
            break;
      }
      return os;
   }
   std::istream& operator>>(std::istream& is, level& l)
   {
      std::string s;
      if (is >> s)
      {
         if (s == "debug")
         {
            l = level::debug;
         }
         else if (s == "info")
         {
            l = level::info;
         }
         else if (s == "notice")
         {
            l = level::notice;
         }
         else if (s == "warning")
         {
            l = level::warning;
         }
         else if (s == "error")
         {
            l = level::error;
         }
         else
         {
            throw std::runtime_error("not a valid log level: \"" + s + "\"");
         }
      }
      return is;
   }

   std::string to_string(const Checksum256& c)
   {
      std::string result;
      for (auto ch : c)
      {
         static const char xdigits[] = "0123456789ABCDEF";
         result += xdigits[(ch >> 4) & 0xF];
         result += xdigits[ch & 0xF];
      }
      return result;
   }

   struct LogReader::Impl
   {
      boost::shared_ptr<boost::log::sinks::synchronous_sink<log_queue_backend>> sink;
      LogQueue&                                                                 reader;
      bool                                                                      registered = false;
   };

   LogReader::LogReader(boost::asio::any_io_executor ctx)
   {
      auto backend = boost::make_shared<log_queue_backend>(std::move(ctx));
      auto sink =
          boost::make_shared<boost::log::sinks::synchronous_sink<log_queue_backend>>(backend);
      impl.reset(new Impl{.sink = sink, .reader = backend->queue});
   }

   LogReader::~LogReader()
   {
      if (impl)
      {
         boost::log::core::get()->remove_sink(impl->sink);
      }
   }

   void LogReader::async_read(std::function<void(const std::error_code&, std::span<const char>)> f)
   {
      impl->reader.async_read(std::move(f));
   }

   void LogReader::cancel()
   {
      impl->reader.cancel();
   }

   void LogReader::config(std::string_view json)
   {
      auto cfg = psio::convert_from_json<LogReaderConfig>(std::string(json));
      impl->sink->set_filter(cfg.filter);
      impl->sink->set_formatter(cfg.format);
      if (!impl->registered)
      {
         boost::log::core::get()->add_sink(impl->sink);
         impl->registered = true;
      }
   }

}  // namespace psibase::loggers
