#include <psibase/ConfigFile.hpp>
#include <psibase/LogQueue.hpp>
#include <psibase/log.hpp>
#include <psibase/trace.hpp>

#include <psio/json/any.hpp>
#include <psio/to_json.hpp>

#include <boost/asio/io_context.hpp>
#include <boost/asio/local/datagram_protocol.hpp>
#include <boost/asio/write.hpp>
#include <boost/lexical_cast.hpp>
#include <boost/log/attributes/current_process_id.hpp>
#include <boost/log/attributes/current_process_name.hpp>
#include <boost/log/attributes/function.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/syslog_constants.hpp>
#include <boost/log/sinks/text_file_backend.hpp>
#include <boost/log/sinks/text_ostream_backend.hpp>
#include <boost/process/child.hpp>
#include <boost/process/io.hpp>
#include <boost/process/start_dir.hpp>
#include <charconv>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <random>

#include <unistd.h>  // gethostname

namespace psibase::loggers
{
   BOOST_LOG_GLOBAL_LOGGER_DEFAULT(generic, common_logger)

   // Available attributes: Timestamp, Channel, Severity, Host
   //
   // Additional attributes for specific Channels:
   // p2p: PeerId, RemoteEndpoint
   // block: BlockId, BlockHeader
   // http: RequestMethod, RequestTarget, ResponseStatus, ResponseBytes

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

      template <std::size_t N, typename S, typename T>
      bool parse_fixed_int(T& out, S& stream)
      {
         if (stream.remaining() < N)
         {
            return false;
         }
         out = 0;
         for (std::size_t i = 0; i < N; ++i)
         {
            char ch;
            stream.read_raw(ch);
            if (ch < '0' || ch > '9')
            {
               return false;
            }
            out = out * 10 + (ch - '0');
         }
         return true;
      }

      template <char Ch, typename S>
      bool parse_char(S& stream)
      {
         if (stream.remaining() == 0)
            return false;
         char c;
         stream.read_raw(c);
         return c == Ch;
      }

      template <typename S, typename T>
      bool parse_timestamp(T& timestamp, S& stream)
      {
         unsigned year, month, day, hours, minutes, seconds;
         if (!parse_fixed_int<4>(year, stream))
            return false;
         if (!parse_char<'-'>(stream))
            return false;
         if (!parse_fixed_int<2>(month, stream) || month < 1 || month > 12)
            return false;
         if (!parse_char<'-'>(stream))
            return false;
         if (!parse_fixed_int<2>(day, stream) || day < 1 || day > 31)
            return false;
         if (!parse_char<'T'>(stream))
            return false;
         if (!parse_fixed_int<2>(hours, stream) || hours > 23)
            return false;
         if (!parse_char<':'>(stream))
            return false;
         if (!parse_fixed_int<2>(minutes, stream) || minutes > 59)
            return false;
         if (!parse_char<':'>(stream))
            return false;
         if (!parse_fixed_int<2>(seconds, stream) || seconds > 59)
            return false;
         if (!parse_char<'Z'>(stream))
            return false;
         auto ymd = std::chrono::year(year) / std::chrono::month(month) / std::chrono::day(day);
         if (!ymd.ok())
            return false;
         timestamp = static_cast<std::chrono::sys_days>(ymd) + std::chrono::hours(hours) +
                     std::chrono::minutes(minutes) + std::chrono::seconds(seconds);
         return true;
      }

      boost::log::sinks::syslog::level to_syslog(level l)
      {
         switch (l)
         {
            case level::debug:
               return boost::log::sinks::syslog::debug;
            case level::info:
               return boost::log::sinks::syslog::info;
            case level::notice:
               return boost::log::sinks::syslog::notice;
            case level::warning:
               return boost::log::sinks::syslog::warning;
            case level::error:
               return boost::log::sinks::syslog::error;
            case level::critical:
               return boost::log::sinks::syslog::critical;
         }
         __builtin_unreachable();
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
            os << ",\"level\":" << to_syslog(*l);
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

         if (auto attr = boost::log::extract<Checksum256>("TransactionId", rec))
         {
            os << ",\"_transaction_id\":" << psio::convert_to_json(*attr);
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

         if (auto attr = boost::log::extract<std::string>("Process", rec))
         {
            os << ",\"Process\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<boost::log::process_id>("ProcessId", rec))
         {
            os << ",\"ProcessId\":" << attr->native_id();
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
               case level::critical:
                  os << "\"critical\"";
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

         if (auto attr = boost::log::extract<Checksum256>("TransactionId", rec))
         {
            os << ",\"TransactionId\":" << psio::convert_to_json(*attr);
         }

         if (auto attr = boost::log::extract<std::string>("RequestMethod", rec))
         {
            os << ",\"Request\":{\"Method\":" << psio::convert_to_json(*attr);
            if (auto target = boost::log::extract<std::string>("RequestTarget", rec))
            {
               os << ",\"Target\":" << psio::convert_to_json(*target);
            }
            if (auto host = boost::log::extract<std::string>("RequestHost", rec))
            {
               os << ",\"Host\":" << psio::convert_to_json(*host);
            }
            os << "}";
         }

         if (auto attr = boost::log::extract<unsigned>("ResponseStatus", rec))
         {
            os << ",\"Response\":{\"Status\":" << *attr;
            if (auto bytes = boost::log::extract<std::uint64_t>("ResponseBytes", rec))
            {
               os << ",\"Bytes\":" << *bytes << std::endl;
            }
            if (auto time = boost::log::extract<std::chrono::microseconds>("ResponseTime", rec))
            {
               os << ",\"Time\":" << time->count() << std::endl;
            }
            os << "}";
         }

         if (auto attr = boost::log::extract<std::chrono::microseconds>("PackTime", rec))
         {
            os << ",\"PackTime\":" << attr->count();
         }

         if (auto attr = boost::log::extract<std::chrono::microseconds>("ServiceLoadTime", rec))
         {
            os << ",\"ServiceLoadTime\":" << attr->count();
         }

         if (auto attr = boost::log::extract<std::chrono::microseconds>("DatabaseTime", rec))
         {
            os << ",\"DatabaseTime\":" << attr->count();
         }

         if (auto attr = boost::log::extract<std::chrono::microseconds>("WasmExecTime", rec))
         {
            os << ",\"WasmExecTime\":" << attr->count();
         }

         os << '}';
      };

      auto rfc5424_formatter(int facility)
      {
         return [facility](const boost::log::record_view& rec, boost::log::formatting_ostream& os)
         {
            // PRI
            {
               auto l = boost::log::extract<level>("Severity", rec);
               os << '<' << (facility * 8 + to_syslog(l ? *l : level::info)) << '>';
            }
            // VERSION
            os << "1 ";
            // TIMESTAMP
            {
               auto t =
                   boost::log::extract<std::chrono::system_clock::time_point>("TimeStamp", rec);
               format_timestamp(os, t ? *t : std::chrono::system_clock::now());
            }
            os << ' ';
            // HOSTNAME
            if (auto attr = boost::log::extract<std::string>("Host", rec))
            {
               os << *attr;
            }
            else
            {
               os << '-';
            }
            os << ' ';
            // APPNAME
            if (auto attr = boost::log::extract<std::string>("Process", rec))
            {
               os << *attr;
            }
            else
            {
               os << '-';
            }
            os << ' ';
            // PROCID
            if (auto attr = boost::log::extract<boost::log::process_id>("ProcessId", rec))
            {
               os << attr->native_id();
            }
            else
            {
               os << '-';
            }
            os << ' ';
            // MSGID
            if (auto attr = boost::log::extract<std::string>("Channel", rec))
            {
               os << *attr;
            }
            else
            {
               os << '-';
            }
            os << " [timeQuality tzKnown=\"1\" isSynced=\"1\"] ";
         };
      }

      int parse_facility(std::string_view facility)
      {
         int num;
         if (facility == "kern")
         {
            num = 0;
         }
         else if (facility == "user")
         {
            num = 1;
         }
         else if (facility == "mail")
         {
            num = 2;
         }
         else if (facility == "daemon")
         {
            num = 3;
         }
         else if (facility == "auth")
         {
            num = 4;
         }
         else if (facility == "syslog")
         {
            num = 5;
         }
         else if (facility == "lpr")
         {
            num = 6;
         }
         else if (facility == "news")
         {
            num = 7;
         }
         else if (facility == "uucp")
         {
            num = 8;
         }
         else if (facility == "cron")
         {
            num = 9;
         }
         else if (facility == "authpriv")
         {
            num = 10;
         }
         else if (facility == "ftp")
         {
            num = 11;
         }
         else if (facility == "ntp")
         {
            num = 12;
         }
         else if (facility == "local0")
         {
            num = 16;
         }
         else if (facility == "local1")
         {
            num = 17;
         }
         else if (facility == "local2")
         {
            num = 18;
         }
         else if (facility == "local3")
         {
            num = 19;
         }
         else if (facility == "local4")
         {
            num = 20;
         }
         else if (facility == "local5")
         {
            num = 21;
         }
         else if (facility == "local6")
         {
            num = 22;
         }
         else if (facility == "local7")
         {
            num = 23;
         }
         else
         {
            auto res = std::from_chars(facility.begin(), facility.end(), num);
            if (res.ptr != facility.end() || res.ec != std::errc{} || num < 0 || num > 23)
            {
               throw std::runtime_error(std::string(facility) + " is not a valid syslog facility");
            }
         }
         return num;
      }

      auto rfc3164_formatter(int facility, bool include_host = true)
      {
         return [facility, include_host](const boost::log::record_view&  rec,
                                         boost::log::formatting_ostream& os)
         {
            // PRI
            {
               auto l = boost::log::extract<level>("Severity", rec);
               os << '<' << (facility * 8 + to_syslog(l ? *l : level::info)) << '>';
            }
            {
               // The timestamp must be in local time and follows an odd format
               // TODO: use std::local_t once it's available.
               auto t =
                   boost::log::extract<std::chrono::system_clock::time_point>("TimeStamp", rec);
               std::time_t ctime =
                   std::chrono::system_clock::to_time_t(t ? *t : std::chrono::system_clock::now());
               std::tm tm;
               localtime_r(&ctime, &tm);
               // Note: not using strftime, because strftime is locale dependent
               const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
               os << months[tm.tm_mon] << ' ' << std::setw(2) << tm.tm_mday << ' '
                  << std::setfill('0') << std::setw(2) << tm.tm_hour << ':' << std::setw(2)
                  << tm.tm_min << ':' << std::setw(2) << tm.tm_sec << std::setfill(' ');
            }
            os << ' ';
            // HOSTNAME
            if (include_host)
            {
               if (auto attr = boost::log::extract<std::string>("Host", rec))
               {
                  // The domain name MUST NOT be included (unlike rfc5424 which prefers FQDN)
                  std::string_view host = *attr;
                  os << host.substr(0, host.find('.'));
               }
               else
               {
                  // This isn't correct for BSD syslog, but we don't have a way to
                  // fill it correctly if a host attribute wasn't set.
                  os << '-';
               }
               os << ' ';
            }
            // TAG
            if (auto attr = boost::log::extract<std::string>("Process", rec))
            {
               os << *attr;
            }
            else
            {
               os << "psibase";
            }
            if (auto attr = boost::log::extract<boost::log::process_id>("ProcessId", rec))
            {
               os << '[' << attr->native_id() << ']';
            }
            os << ": ";
         };
      }

      // args (';' separated keywords):
      // - facility: can be specified as either a string or number. default local0
      // - format: rfc3164, rfc5424, glibc, bsd (equivalent to rfc3164). default bsd
      auto make_syslog_formatter = [](boost::log::attribute_name,
                                      std::string_view spec) -> boost::log::formatter
      {
         int              facility     = 16;
         std::string_view format       = "bsd";
         bool             has_facility = false;
         bool             has_format   = false;
         if (!spec.empty())
         {
            while (true)
            {
               auto pos     = spec.find(';');
               auto keyword = spec.substr(0, pos);
               if (keyword == "bsd" || keyword == "rfc3164" || keyword == "rfc5424" ||
                   keyword == "glibc")
               {
                  if (has_format)
                  {
                     throw std::runtime_error("Syslog: multiple formats specified");
                  }
                  has_format = true;
                  format     = keyword;
               }
               else
               {
                  if (has_facility)
                  {
                     throw std::runtime_error("Syslog: multiple facilities specified");
                  }
                  facility = parse_facility(keyword);
               }
               if (pos == std::string::npos)
               {
                  break;
               }
               spec = spec.substr(pos + 1);
            }
         }
         if (format == "bsd" || format == "rfc3164")
         {
            return rfc3164_formatter(facility);
         }
         else if (format == "rfc5424")
         {
            return rfc5424_formatter(facility);
         }
         else if (format == "glibc")
         {
            return rfc3164_formatter(facility, false);
         }
         else
         {
            __builtin_unreachable();
         }
      };

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

      boost::log::filter    parse_filter(std::string_view filter);
      boost::log::formatter parse_formatter(std::string_view formatter, bool in_expansion = false);

      bool is_known_channel(std::string_view name)
      {
         return name == "p2p" || name == "consensus" || name == "chain" || name == "block";
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
                                      obj.format = parse_formatter(stream.get_string());
                                   }
                                   else if (key == "filter")
                                   {
                                      obj.filter = parse_filter(stream.get_string());
                                   }
                                   else
                                   {
                                      psio::from_json_skip_value(stream);
                                   }
                                });
      }

      // searchable with string_view
      using sink_args_type = std::map<std::string, psio::json::any, std::less<>>;

      struct ConsoleSinkConfig
      {
         using backend_type = boost::log::sinks::text_ostream_backend;
         ConsoleSinkConfig() {}
         explicit ConsoleSinkConfig(const sink_args_type& args) {}
         static void init(backend_type& backend)
         {
            backend.add_stream(boost::shared_ptr<std::ostream>(&std::clog, [](void*) {}));
         }
         void apply(backend_type& backend) const {}
         void setPrevious(ConsoleSinkConfig&&) {}
      };

      struct time_rotation
      {
         template <typename F>
         time_rotation(F&& f) : update(std::forward<F>(f))
         {
         }
         std::function<std::chrono::system_clock::time_point(std::chrono::system_clock::time_point)>
                                               update;
         std::chrono::system_clock::time_point start;
         std::chrono::system_clock::time_point next;
         bool                                  operator()()
         {
            auto now = std::chrono::system_clock::now();
            if (next == std::chrono::system_clock::time_point())
            {
               next  = update(now);
               start = now;
               return false;
            }
            if (now >= next)
            {
               next  = update(now);
               start = now;
               return true;
            }
            return false;
         }
      };

      time_rotation parse_rotation_time(
          std::string_view                                     s,
          std::optional<std::chrono::system_clock::time_point> previous_start = {})
      {
         auto parse_time = [](std::string_view time)
         {
            // hh:mm:ssZ
            if (time.size() != 9 || time[2] != ':' || time[5] != ':' || time[8] != 'Z')
            {
               throw std::runtime_error("invalid time");
            }
            auto convert_int = [](std::string_view s)
            {
               unsigned result;
               auto     res = std::from_chars(s.begin(), s.end(), result);
               if (res.ptr != s.end())
               {
                  throw std::runtime_error("Invalid time");
               }
               return result;
            };
            unsigned hours   = convert_int(time.substr(0, 2));
            unsigned minutes = convert_int(time.substr(3, 2));
            unsigned seconds = convert_int(time.substr(6, 2));
            if (hours >= 24 || minutes >= 60 || seconds >= 60)
            {
               throw std::runtime_error("Invalid time");
            }
            return std::chrono::hours(hours) + std::chrono::minutes(minutes) +
                   std::chrono::seconds(seconds);
         };
         struct date_time
         {
            std::optional<std::chrono::month> month;
            std::optional<std::chrono::day>   day;
            std::chrono::seconds              time;
            auto operator()(std::chrono::system_clock::time_point now) const
            {
               auto                        now_date = std::chrono::floor<std::chrono::days>(now);
               auto                        now_time = now - now_date;
               std::chrono::year_month_day ymd(now_date);
               // Find the first time point that matches
               ymd = ymd.year() / (month ? *month : ymd.month()) / (day ? *day : ymd.day());
               auto calc_result = [&]()
               {
                  auto result = ymd;
                  if (!ymd.ok())
                  {
                     ymd = ymd.year() / ymd.month() / std::chrono::last;
                  }
                  return static_cast<std::chrono::sys_days>(result) + time;
               };
               if (calc_result() < now)
               {
                  if (month)
                  {
                     ymd += std::chrono::years(1);
                  }
                  else if (day)
                  {
                     ymd += std::chrono::months(1);
                  }
                  else
                  {
                     return calc_result() + std::chrono::days(1);
                  }
               }
               return calc_result();
            }
         };
         auto parse_date_time = [parse_time](std::string_view time)
         {
            // [[[MM-]DD]T]hh:mm:ssZ
            date_time result;
            if (time.size() == 15)
            {
               // parse month
               unsigned month;
               auto     res = std::from_chars(time.begin(), time.end(), month);
               if (res.ptr != time.begin() + 2 || month < 1 || month > 12)
               {
                  throw std::runtime_error("Invalid month");
               }
               result.month = std::chrono::month(month);
               time         = time.substr(3);
            }
            if (time.size() == 12)
            {
               // parse day
               unsigned day;
               auto     res = std::from_chars(time.begin(), time.end(), day);
               if (res.ptr != time.begin() + 2 || day < 1 || day > 31)
               {
                  throw std::runtime_error("Invalid day");
               }
               result.day = std::chrono::day(day);
               if (time[2] != 'T')
               {
                  throw std::runtime_error("Expected time");
               }
               time = time.substr(3);
            }
            if (time.size() == 10 && time[0] == 'T')
            {
               time = time.substr(1);
            }
            result.time = parse_time(time);
            return result;
         };
         struct duration
         {
            std::chrono::months  months = {};
            std::chrono::seconds time   = {};
            auto                 operator()(std::chrono::system_clock::time_point base) const
            {
               auto day = std::chrono::floor<std::chrono::days>(base);
               auto ymd = std::chrono::year_month_day(day);
               ymd += months;
               // Handle out-of-range day of month
               if (!ymd.ok())
               {
                  ymd = ymd.year() / ymd.month() / std::chrono::last;
               }
               return static_cast<std::chrono::sys_days>(ymd) + (base - day) + time;
            }
         };
         // ISO 8601 time duration: PnYnMnDTnHnMnS or PnW
         auto parse_duration = [](std::string_view d)
         {
            if (d.size() < 2 || d[0] != 'P')
            {
               throw std::runtime_error("Invalid duration");
            }
            d = d.substr(1);
            // const char* designators = "YMDTHMS";
            int      state = 0;
            duration result;
            while (true)
            {
               if (state < 4 && d[0] == 'T')
               {
                  state = 4;
                  d     = d.substr(1);
               }
               unsigned v;
               auto     res = std::from_chars(d.begin(), d.end(), v);
               if (res.ec != std::errc{} || res.ptr == d.end())
               {
                  throw std::runtime_error("Invalid duration");
               }
               d = {res.ptr + 1, d.end()};
               if (state == 0 && *res.ptr == 'Y')
               {
                  result.months += std::chrono::months(12 * v);
                  state = 1;
               }
               else if (state < 2 && *res.ptr == 'M')
               {
                  result.months += std::chrono::months(v);
                  state = 2;
               }
               else if (state < 3 && *res.ptr == 'D')
               {
                  result.time += std::chrono::days(v);
                  state = 3;
               }
               else if (state == 0 && *res.ptr == 'W')
               {
                  result.time += std::chrono::weeks(v);
                  state = 7;
               }
               else if (state == 4 && *res.ptr == 'H')
               {
                  result.time += std::chrono::hours(v);
                  state = 5;
               }
               else if (state >= 4 && state < 6 && *res.ptr == 'M')
               {
                  result.time += std::chrono::minutes(v);
                  state = 6;
               }
               else if (state >= 4 && state < 7 && *res.ptr == 'S')
               {
                  result.time += std::chrono::seconds(v);
                  state = 7;
               }
               else
               {
                  throw std::runtime_error("Invalid duration");
               }
               if (d.empty())
               {
                  return result;
               }
            }
         };
         struct repeating_interval
         {
            mutable std::chrono::system_clock::time_point base;
            duration                                      d;
            auto operator()(std::chrono::system_clock::time_point now) const
            {
               if (now < base)
               {
                  return base;
               }
               else if (d.time.count() == 0)
               {
                  auto base_ymd =
                      std::chrono::year_month_day(std::chrono::floor<std::chrono::days>(base));
                  auto offset = base - std::chrono::floor<std::chrono::days>(base);
                  auto now_ymd =
                      std::chrono::year_month_day(std::chrono::floor<std::chrono::days>(now));
                  auto diff = std::chrono::months(12 * (now_ymd.year() - base_ymd.year()).count()) +
                              (now_ymd.month() - base_ymd.month()) / d.months * d.months;
                  auto calc_result = [&]()
                  { return static_cast<std::chrono::sys_days>(base_ymd) + diff + offset; };
                  while (calc_result() <= now)
                  {
                     diff += d.months;
                  }
                  return calc_result();
               }
               else if (d.months.count() == 0)
               {
                  return base + ((now - base) / d.time + 1) * d.time;
               }
               else
               {
                  // The interval is at least one month, so we shouldn't need too many iterations
                  while (base <= now)
                  {
                     base = d(base);
                  }
                  return base;
               }
            }
         };
         // R/<time point>/<duration>
         auto parse_repeating_interval = [parse_duration](std::string_view s)
         {
            if (s.substr(0, 2) != "R/")
            {
               throw std::runtime_error("Invalid repeating interval");
            }
            repeating_interval result;
            psio::input_stream stream(s.substr(2));
            if (!parse_timestamp(result.base, stream))
            {
               throw std::runtime_error("Invalid time point");
            }
            if (!parse_char<'/'>(stream))
            {
               throw std::runtime_error("Expected /");
            }
            result.d = parse_duration({stream.pos, stream.end});
            return result;
         };
         if (s.empty())
         {
            throw std::runtime_error("Invalid rotation time");
         }
         if (s[0] == 'R')
         {
            // repeating interval
            // Note: The start point determines whether the current file
            // will be rotated immediately after a schedule update
            time_rotation result = parse_repeating_interval(s);
            if (previous_start)
            {
               result.start = *previous_start;
               result.next  = result.update(*previous_start);
            }
            return result;
         }
         else if (s[0] == 'P')
         {
            // duration
            time_rotation result = parse_duration(s);
            if (previous_start)
            {
               result.start = *previous_start;
               result.next  = result.update(*previous_start);
            }
            return result;
         }
         else
         {
            // time point
            return parse_date_time(s);
         }
      }

      std::filesystem::path log_file_path;

      struct FileSinkConfig
      {
         using backend_type = boost::log::sinks::text_file_backend;
         FileSinkConfig(const sink_args_type& args)
         {
            auto make_canonical_dir = [](auto& p)
            {
               if (p.has_filename())
               {
                  // Resolve symlinks except for the file name which is a pattern
                  p = std::filesystem::weakly_canonical(p.parent_path()) / p.filename();
               }
            };
            auto as_string = [](const auto& value) -> const std::string&
            {
               if (auto* result = std::get_if<std::string>(&value.value()))
               {
                  return *result;
               }
               else
               {
                  throw std::runtime_error("Expected string");
               }
            };
            if (auto iter = args.find("target"); iter != args.end())
            {
               target = log_file_path / as_string(iter->second);
               make_canonical_dir(target);
               targetDirectory = target.parent_path();
            }
            if (auto iter = args.find("filename"); iter != args.end())
            {
               filename = log_file_path / as_string(iter->second);
               make_canonical_dir(filename);
               if (targetDirectory.empty())
               {
                  targetDirectory = target.parent_path();
               }
            }
            if (targetDirectory.empty())
            {
               targetDirectory = log_file_path;
            }
            auto get_int = [&](std::string_view key) -> std::uint64_t
            {
               auto iter = args.find(key);
               if (iter != args.end())
               {
                  std::uint64_t result;
                  const auto&   s   = as_string(iter->second);
                  auto          err = std::from_chars(s.data(), s.data() + s.size(), result);
                  if (err.ptr != s.data() + s.size() || err.ec != std::errc())
                  {
                     throw std::runtime_error("Expected an integer");
                  }
                  return result;
               }
               else
               {
                  return std::numeric_limits<std::uint64_t>::max();
               }
            };
            maxFiles     = get_int("maxFiles");
            maxSize      = get_int("maxSize");
            rotationSize = get_int("rotationSize");
            if (auto iter = args.find("rotationTime"); iter != args.end())
            {
               rotationTime = as_string(iter->second);
               rotationTimeFunc.reset(new time_rotation(parse_rotation_time(rotationTime)));
            }
            if (auto iter = args.find("flush"); iter != args.end())
            {
               if (auto* ptr = std::get_if<bool>(&iter->second.value()))
               {
                  flush = *ptr;
               }
               else
               {
                  throw std::runtime_error("Expected Bool");
               }
            }
         }
         static void init(backend_type&) {}
         void        apply(boost::log::sinks::text_file_backend& backend) const
         {
            backend.set_file_name_pattern(filename.native());
            backend.set_target_file_name_pattern(target.native());
            backend.set_rotation_size(rotationSize);
            if (hasCollector())
            {
               if (resetCollector)
               {
                  backend.set_file_collector(nullptr);
                  backend.set_file_collector(boost::log::sinks::file::make_collector(
                      boost::log::keywords::target    = targetDirectory.native(),
                      boost::log::keywords::max_size  = maxSize,
                      boost::log::keywords::max_files = maxFiles));
               }
               if (needsScan)
               {
                  backend.scan_for_files(boost::log::sinks::file::scan_matching, updateCounter);
               }
            }
            else
            {
               backend.set_file_collector(nullptr);
            }
            if (rotationTimeFunc)
            {
               backend.set_time_based_rotation(std::ref(*rotationTimeFunc));
            }
            else
            {
               backend.set_time_based_rotation({});
            }
            backend.auto_flush(flush);
         }
         bool hasCollector() const { return true; }
         void setPrevious(FileSinkConfig&& prev)
         {
            if (rotationTime == prev.rotationTime)
            {
               rotationTimeFunc = std::move(prev.rotationTimeFunc);
            }
            else
            {
               rotationTimeFunc.reset(new time_rotation(
                   parse_rotation_time(rotationTime, prev.rotationTimeFunc->start)));
            }
            resetCollector = maxSize != prev.maxSize || maxFiles != prev.maxFiles;
            needsScan      = resetCollector || filename != prev.filename || target != prev.target;
            updateCounter  = filename != prev.filename || target != prev.target;
         }
         std::filesystem::path          targetDirectory;
         std::filesystem::path          filename;
         std::filesystem::path          target;
         std::uint64_t                  maxFiles;
         std::uint64_t                  maxSize;
         std::uint64_t                  rotationSize;
         std::string                    rotationTime;
         bool                           flush = false;
         std::shared_ptr<time_rotation> rotationTimeFunc;
         bool                           resetCollector = true;
         bool                           needsScan      = true;
         bool                           updateCounter  = true;
      };
      void to_json(const FileSinkConfig& obj, auto& stream)
      {
         if (!obj.filename.empty())
         {
            stream.write(',');
            psio::to_json("filename", stream);
            stream.write(':');
            psio::to_json(obj.filename.native(), stream);
         }
         if (!obj.target.empty())
         {
            stream.write(',');
            psio::to_json("target", stream);
            stream.write(':');
            psio::to_json(obj.target.native(), stream);
         }
         if (obj.rotationSize != std::numeric_limits<std::uint64_t>::max())
         {
            stream.write(',');
            psio::to_json("rotationSize", stream);
            stream.write(':');
            psio::to_json(obj.rotationSize, stream);
         }
         if (!obj.rotationTime.empty())
         {
            stream.write(',');
            psio::to_json("rotationTime", stream);
            stream.write(':');
            psio::to_json(obj.rotationTime, stream);
         }
         if (obj.maxFiles != std::numeric_limits<std::uint64_t>::max())
         {
            stream.write(',');
            psio::to_json("maxFiles", stream);
            stream.write(':');
            psio::to_json(obj.maxFiles, stream);
         }
         if (obj.maxSize != std::numeric_limits<std::uint64_t>::max())
         {
            stream.write(',');
            psio::to_json("maxSize", stream);
            stream.write(':');
            psio::to_json(obj.maxSize, stream);
         }
         stream.write(',');
         psio::to_json("flush", stream);
         stream.write(':');
         psio::to_json(obj.flush, stream);
      }

      struct LocalSocketBackend
          : public boost::log::sinks::
                basic_formatted_sink_backend<char, boost::log::sinks::synchronized_feeding>
      {
         explicit LocalSocketBackend() : socket(ctx, boost::asio::local::datagram_protocol())
         {
            std::random_device rng;
            for (int tries = 0; tries < 5; ++tries)
            {
               auto suffix = rng() % 1000000;
               auto tmp =
                   std::filesystem::temp_directory_path() / ("psibase" + std::to_string(suffix));
               boost::system::error_code ec;
               socket.bind(boost::asio::local::datagram_protocol::endpoint(tmp), ec);
               if (!ec)
               {
                  break;
               }
               else if (tries >= 5)
               {
                  throw std::system_error(ec);
               }
            }
         }
         ~LocalSocketBackend()
         {
            if (!mypath.empty())
            {
               std::filesystem::remove(mypath);
            }
         }
         void consume(const boost::log::record_view&, const string_type& message)
         {
            socket.send(boost::asio::buffer(message));
         }
         boost::asio::io_context                       ctx;
         std::filesystem::path                         mypath;
         boost::asio::local::datagram_protocol::socket socket;
      };

      // Write to a local (unix domain) socket
      struct LocalSocketSinkConfig
      {
         using backend_type = LocalSocketBackend;
         explicit LocalSocketSinkConfig(const sink_args_type& args)
         {
            auto as_string = [](const auto& value) -> const std::string&
            {
               if (auto* result = std::get_if<std::string>(&value.value()))
               {
                  return *result;
               }
               else
               {
                  throw std::runtime_error("Expected string");
               }
            };
            auto iter = args.find("path");
            if (iter == args.end())
            {
               throw std::runtime_error("Missing path for local socket");
            }
            path = log_file_path / as_string(iter->second);
         }
         static void init(LocalSocketBackend&) {}
         void        apply(LocalSocketBackend& backend) const
         {
            if (newPath)
            {
               backend.socket.connect(
                   boost::asio::local::datagram_protocol::endpoint(path.native()));
            }
         }
         void setPrevious(LocalSocketSinkConfig&& prev) { newPath = (prev.path != path); }
         std::filesystem::path path;
         bool                  newPath = true;
      };
      void to_json(const LocalSocketSinkConfig& obj, auto& stream)
      {
         stream.write(',');
         psio::to_json("path", stream);
         stream.write(':');
         psio::to_json(obj.path.native(), stream);
      }

      struct PipeBackend
          : public boost::log::sinks::
                basic_formatted_sink_backend<char, boost::log::sinks::synchronized_feeding>
      {
         explicit PipeBackend() {}
         void consume(const boost::log::record_view&, const string_type& message)
         {
            pipe << message;
            pipe.flush();
         }
         boost::process::opstream pipe;
         boost::process::child    active_child;
      };

      struct PipeSinkConfig
      {
         using backend_type = PipeBackend;
         explicit PipeSinkConfig(const sink_args_type& args)
         {
            auto as_string = [](const auto& value) -> const std::string&
            {
               if (auto* result = std::get_if<std::string>(&value.value()))
               {
                  return *result;
               }
               else
               {
                  throw std::runtime_error("Expected string");
               }
            };
            auto iter = args.find("command");
            if (iter == args.end())
            {
               throw std::runtime_error("Missing command");
            }
            command = as_string(iter->second);
         }
         static void init(PipeBackend&) {}
         void        apply(PipeBackend& backend) const
         {
            if (newCommand)
            {
               backend.pipe.close();
               backend.pipe = boost::process::opstream{};
               if (backend.active_child)
               {
                  if (!backend.active_child.wait_for(std::chrono::milliseconds(100)))
                  {
                     backend.active_child.terminate();
                  }
               }
               backend.active_child = boost::process::child(
                   "/bin/sh", "-c", command, boost::process::std_in = backend.pipe,
                   boost::process::start_dir = log_file_path.native());
            }
         }
         void        setPrevious(PipeSinkConfig&& prev) { newCommand = (prev.command != command); }
         std::string command;
         bool        newCommand = true;
      };

      void to_json(const PipeSinkConfig& obj, auto& stream)
      {
         stream.write(',');
         to_json("command", stream);
         stream.write(':');
         to_json(obj.command, stream);
      }

      struct sink_config
      {
         boost::log::formatter format;
         boost::log::filter    filter;
         std::string           format_str;
         std::string           filter_str;
         std::string           type;
         //
         std::variant<ConsoleSinkConfig, FileSinkConfig, LocalSocketSinkConfig, PipeSinkConfig>
             backend;
      };

      void from_json(sink_config& obj, auto& stream)
      {
         sink_args_type args;
         psio::from_json_object(stream,
                                [&](std::string_view key)
                                {
                                   if (key == "format")
                                   {
                                      auto s         = stream.get_string();
                                      obj.format_str = s;
                                      obj.format     = parse_formatter(s);
                                   }
                                   else if (key == "filter")
                                   {
                                      auto s         = stream.get_string();
                                      obj.filter_str = s;
                                      obj.filter     = parse_filter(s);
                                   }
                                   else if (key == "type")
                                   {
                                      obj.type = stream.get_string();
                                   }
                                   else
                                   {
                                      psio::json::any val;
                                      psio::json::from_json(val, stream);
                                      args.try_emplace(std::string(key), std::move(val));
                                   }
                                });
         if (obj.type == "console")
         {
            obj.backend.emplace<ConsoleSinkConfig>(args);
         }
         if (obj.type == "file")
         {
            obj.backend.emplace<FileSinkConfig>(args);
         }
         if (obj.type == "local")
         {
            obj.backend.emplace<LocalSocketSinkConfig>(args);
         }
         if (obj.type == "pipe")
         {
            obj.backend.emplace<PipeSinkConfig>(args);
         }
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
         psio::to_json(obj.format_str, stream);
         if (auto* backend = std::get_if<FileSinkConfig>(&obj.backend))
         {
            to_json(*backend, stream);
         }
         else if (auto* backend = std::get_if<LocalSocketSinkConfig>(&obj.backend))
         {
            to_json(*backend, stream);
         }
         stream.write('}');
      }

      template <typename Config>
      auto make_sink(const sink_config& cfg, Config& backendConfig)
      {
         auto backend = boost::make_shared<typename Config::backend_type>();
         Config::init(*backend);
         backendConfig.apply(*backend);
         auto result =
             boost::make_shared<boost::log::sinks::synchronous_sink<typename Config::backend_type>>(
                 backend);
         result->set_filter(cfg.filter);
         result->set_formatter(cfg.format);
         return result;
      }

      boost::shared_ptr<boost::log::sinks::sink> make_sink(const sink_config& cfg)
      {
         return std::visit(
             [&](auto& backend) {
                return static_cast<boost::shared_ptr<boost::log::sinks::sink>>(
                    make_sink(cfg, backend));
             },
             cfg.backend);
      }

      std::string translate_size(std::string_view s)
      {
         std::uint64_t v;
         auto          err = std::from_chars(s.begin(), s.end(), v);
         if (err.ec != std::errc())
         {
            throw std::runtime_error("Expected number");
         }
         s = {err.ptr, s.end()};
         s = s.substr(std::min(s.find_first_not_of(" \t"), s.size()));
         if (s.empty() || s == "B")
         {
         }
         else if (s == "KiB")
         {
            v <<= 10;
         }
         else if (s == "MiB")
         {
            v <<= 20;
         }
         else if (s == "GiB")
         {
            v <<= 30;
         }
         else if (s == "TiB")
         {
            v <<= 40;
         }
         else if (s == "PiB")
         {
            v <<= 50;
         }
         else if (s == "EiB")
         {
            v <<= 60;
         }
         // larger values don't fit in 64 bits
         else if (s == "KB")
         {
            v *= 1000;
         }
         else if (s == "MB")
         {
            v *= 1'000'000;
         }
         else if (s == "GB")
         {
            v *= 1'000'000'000;
         }
         else if (s == "TB")
         {
            v *= 1'000'000'000'000;
         }
         else if (s == "PB")
         {
            v *= 1'000'000'000'000'000;
         }
         else if (s == "EB")
         {
            v *= 1'000'000'000'000'000'000;
         }
         else
         {
            throw std::runtime_error("Unknown units: " + std::string(s));
         }
         return std::to_string(v);
      }

      bool translate_bool(std::string_view value)
      {
         if (value == "true" || value == "yes" || value == "on" || value == "1" || value == "")
         {
            return true;
         }
         else if (value == "false" || value == "no" || value == "off" || value == "0")
         {
            return false;
         }
         throw std::runtime_error("Expected a boolean value: " + std::string(value));
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
         else
         {
            std::visit(
                [&](auto& backendConfig)
                {
                   using BC = std::remove_cvref_t<decltype(backendConfig)>;
                   backendConfig.setPrevious(std::move(std::get<BC>(old_cfg.backend)));
                   auto frontend =
                       static_cast<boost::log::sinks::synchronous_sink<typename BC::backend_type>*>(
                           sink.get());
                   backendConfig.apply(*frontend->locked_backend());
                   frontend->set_formatter(new_cfg.format);
                   frontend->set_filter(new_cfg.filter);
                   old_cfg = std::move(new_cfg);
                },
                new_cfg.backend);
         }
      }

      struct formatter_list
      {
         void operator()(auto&& rec, auto&& stream) const
         {
            for (const auto& f : formatters)
            {
               f(rec, stream);
            }
         }
         std::vector<boost::log::formatter> formatters;
      };

      struct attr_set_filter
      {
         bool operator()(auto&& attr_set) const
         {
            for (auto attr : attrs)
            {
               if (!attr_set.count(attr))
               {
                  return false;
               }
            }
            return true;
         }
         std::vector<boost::log::attribute_name> attrs;
      };

      using filter_generator = std::function<
          boost::log::filter(boost::log::attribute_name, std::string_view, std::string_view)>;
      using formatter_generator =
          std::function<boost::log::formatter(boost::log::attribute_name, std::string_view)>;
      using filter_generator_ext =
          std::function<boost::log::filter(boost::log::attribute_name, std::string_view&)>;

      struct filter_parser
      {
         const char*                                                          begin;
         const char*                                                          end;
         std::vector<boost::log::filter>                                      result;
         std::vector<char>                                                    states;
         bool                                                                 not_ = false;
         static std::map<std::string_view, filter_generator, std::less<>>     global_filters;
         static std::map<std::string_view, filter_generator_ext, std::less<>> global_filters_ext;
         bool parse(bool in_format = false)
         {
            while (true)
            {
               parse_ws();
               if (*begin == '(')
               {
                  states.push_back('(');
                  ++begin;
               }
               else if (parse_not())
               {
                  if (states.empty() || states.back() != '!')
                  {
                     states.push_back('!');
                  }
                  else
                  {
                     states.pop_back();
                  }
                  not_ = !not_;
               }
               else
               {
                  if (!parse_attribute())
                  {
                     return false;
                  }
                  while (true)
                  {
                     if (!states.empty() && states.back() == '!')
                     {
                        states.pop_back();
                        not_ = !not_;
                     }
                     parse_ws();
                     if (begin == end || *begin != ')')
                     {
                        break;
                     }
                     collect_and();
                     collect_or();
                     if (states.empty() || states.back() != '(')
                     {
                        return false;
                     }
                     states.pop_back();
                     ++begin;
                  }
                  if (begin == end || (in_format && begin != end && *begin == ':'))
                  {
                     collect_and();
                     collect_or();
                     return states.empty();
                  }
                  else if (parse_and())
                  {
                     states.push_back('&');
                  }
                  else if (parse_or())
                  {
                     collect_and();
                     states.push_back('|');
                  }
                  else
                  {
                     return false;
                  }
               }
            }
         }
         void parse_ws()
         {
            while (begin != end && *begin == ' ' || *begin == '\t')
            {
               ++begin;
            }
         }
         bool parse_and()
         {
            if (end - begin >= 4 && begin[0] == 'a' && begin[1] == 'n' && begin[2] == 'd' &&
                (begin[3] == ' ' || begin[3] == '\t' || begin[3] == '('))
            {
               begin += 3;
               return true;
            }
            else if (begin != end && *begin == '&')
            {
               ++begin;
               return true;
            }
            return false;
         }
         bool parse_or()
         {
            if (end - begin >= 3 && begin[0] == 'o' && begin[1] == 'r' &&
                (begin[2] == ' ' || begin[2] == '\t' || begin[2] == '('))
            {
               begin += 2;
               return true;
            }
            else if (begin != end && *begin == '|')
            {
               ++begin;
               return true;
            }
            return false;
         }
         bool parse_not()
         {
            if (end - begin >= 4 && begin[0] == 'n' && begin[1] == 'o' && begin[2] == 't' &&
                (begin[3] == ' ' || begin[3] == '\t' || begin[3] == '('))
            {
               begin += 3;
               return true;
            }
            else if (begin != end && *begin == '!')
            {
               ++begin;
               return true;
            }
            return false;
         }
         void apply_andor(bool is_and)
         {
            auto rhs = std::move(result.back());
            result.pop_back();
            if (is_and)
            {
               result.back() = [lhs = std::move(result.back()), rhs = std::move(rhs)](auto& attrs)
               { return lhs(attrs) && rhs(attrs); };
            }
            else
            {
               result.back() = [lhs = std::move(result.back()), rhs = std::move(rhs)](auto& attrs)
               { return lhs(attrs) || rhs(attrs); };
            }
            states.pop_back();
         }
         void collect_and()
         {
            while (!states.empty() && states.back() == '&')
            {
               apply_andor(!not_);
            }
         }
         void collect_or()
         {
            while (!states.empty() && states.back() == '|')
            {
               apply_andor(not_);
            }
         }
         bool push_ext(std::string_view name)
         {
            if (auto iter = global_filters_ext.find(name); iter != global_filters_ext.end())
            {
               std::string_view trailing{begin, end};
               auto f = iter->second(boost::log::attribute_name{std::string(name)}, trailing);
               assert(trailing.data() + trailing.size() == end);
               begin = trailing.data();
               if (not_)
               {
                  f = [f = std::move(f)](auto& attrs) mutable { return !f(attrs); };
               }
               result.push_back(std::move(f));
               return true;
            }
            return false;
         }
         bool push_exists(std::string_view name)
         {
            if (global_filters.find(name) != global_filters.end())
            {
               if (!not_)
               {
                  result.push_back([name = boost::log::attribute_name{std::string(name)}](
                                       auto& attrs) { return attrs.count(name) != 0; });
               }
               else
               {
                  result.push_back([name = boost::log::attribute_name{std::string(name)}](
                                       auto& attrs) { return attrs.count(name) == 0; });
               }
               return true;
            }
            else
            {
               throw std::runtime_error("Unknown attribute " + std::string(name));
            }
         }
         bool push_op(std::string_view name, std::string_view op, std::string_view value)
         {
            if (auto iter = global_filters.find(name); iter != global_filters.end())
            {
               if (!not_)
               {
                  result.push_back(
                      iter->second(boost::log::attribute_name{std::string(name)}, op, value));
               }
               else
               {
                  result.push_back([f = iter->second(boost::log::attribute_name{std::string(name)},
                                                     op, value)](auto& attrs)
                                   { return !f(attrs); });
               }
               return true;
            }
            else
            {
               throw std::runtime_error("Unknown attribute " + std::string(name));
            }
         }
         void parse_attribute_name(std::string_view& out)
         {
            auto start = begin;
            while (begin != end)
            {
               if (!std::isalnum(*begin) && *begin != '_' && *begin != '.')
               {
                  break;
               }
               ++begin;
            }
            out = {start, begin};
         }
         bool parse_operand(std::string& out)
         {
            if (begin == end)
            {
               return false;
            }
            if (*begin == '"')
            {
               ++begin;
               while (begin != end)
               {
                  if (*begin == '"')
                  {
                     ++begin;
                     return true;
                  }
                  else if (*begin == '\\')
                  {
                     ++begin;
                     if (begin == end)
                     {
                        return false;
                     }
                  }
                  out.push_back(*begin);
                  ++begin;
               }
               return false;
            }
            while (begin != end)
            {
               if (*begin == ' ' || *begin == '\t' || *begin == '&' || *begin == '|' ||
                   *begin == ':' || *begin == '{' || *begin == '}' || *begin == '(' ||
                   *begin == ')' || *begin == '"')
               {
                  return true;
               }
               out.push_back(*begin);
               ++begin;
            }
            return true;
         }
         bool parse_attribute()
         {
            std::string_view name;
            parse_ws();
            parse_attribute_name(name);
            parse_ws();
            if (push_ext(name))
            {
               return true;
            }
            std::string_view op;
            if (parse_operator(op))
            {
               parse_ws();
               std::string arg;
               if (parse_operand(arg))
               {
                  return push_op(name, op, arg);
               }
               return false;
            }
            else
            {
               return push_exists(name);
            }
         }
         bool parse_operator(std::string_view& op)
         {
            if (begin != end)
            {
               if (*begin == '=')
               {
                  op = {begin, begin + 1};
                  ++begin;
                  return true;
               }
               else if (*begin == '>' || *begin == '<')
               {
                  if (begin + 1 != end && begin[1] == '=')
                  {
                     op = {begin, begin + 2};
                     begin += 2;
                     return true;
                  }
                  else
                  {
                     op = {begin, begin + 1};
                     ++begin;
                     return true;
                  }
               }
               else if (begin + 1 != end && begin[0] == '!' && begin[1] == '=')
               {
                  op = {begin, begin + 2};
                  begin += 2;
                  return true;
               }
            }
            return false;
         }
      };

      struct formatter_parser
      {
         const char*                        begin;
         const char*                        end;
         std::string                        text;
         std::vector<boost::log::formatter> result;
         static std::map<std::string_view,
                         std::pair<boost::log::attribute_name, formatter_generator>,
                         std::less<>>
             global_formatters;

         boost::log::formatter reduce(std::size_t pos = 0)
         {
            if (pos + 1 == result.size())
            {
               auto last = std::move(result.back());
               result.pop_back();
               return last;
            }
            else if (pos == result.size())
            {
               return [](auto&&, auto&&) {};
            }
            else if (pos == 0)
            {
               return formatter_list{std::move(result)};
            }
            else
            {
               formatter_list sub;
               sub.formatters.reserve(result.size() - pos);
               for (std::size_t i = pos; i < result.size(); ++i)
               {
                  sub.formatters.push_back(std::move(result[i]));
               }
               result.resize(pos);
               return sub;
            }
         }
         bool parse_expansion(attr_set_filter* condition)
         {
            if (begin == end)
            {
               return false;
            }
            else if (*begin == '{')
            {
               text.push_back('{');
               ++begin;
               return true;
            }
            else if (*begin == '?')
            {
               ++begin;
               end_text();
               return parse_conditional();
            }
            else
            {
               end_text();
               return parse_attribute(condition);
            }
         }
         void end_text()
         {
            if (!text.empty())
            {
               result.push_back([text = std::move(text)](auto&, auto& stream) { stream << text; });
               text.clear();
            }
         }
         bool push_attribute(std::string_view name,
                             std::string_view format_spec,
                             attr_set_filter* condition)
         {
            auto iter = global_formatters.find(name);
            if (iter == global_formatters.end())
            {
               return false;
            }
            boost::log::attribute_name attr = iter->second.first;
            result.push_back(iter->second.second(attr, format_spec));
            if (condition && attr != boost::log::attribute_name())
            {
               condition->attrs.push_back(attr);
            }
            return true;
         }
         bool parse_attribute(attr_set_filter* condition)
         {
            auto name_start = begin;
            while (begin != end)
            {
               if (*begin == ':')
               {
                  auto name_end = begin;
                  ++begin;
                  std::size_t count = 1;
                  for (; begin != end; ++begin)
                  {
                     if (*begin == '}')
                     {
                        if (--count == 0)
                        {
                           break;
                        }
                     }
                     else if (*begin == '{')
                     {
                        ++count;
                     }
                  }
                  if (begin == end)
                  {
                     return false;
                  }
                  auto spec_end = begin;
                  ++begin;
                  return push_attribute({name_start, name_end}, {name_end + 1, spec_end},
                                        condition);
               }
               else if (*begin == '}')
               {
                  auto name_end = begin;
                  ++begin;
                  return push_attribute({name_start, name_end}, {begin, begin}, condition);
               }
               ++begin;
            }
            return false;
         }
         bool parse_conditional()
         {
            if (begin == end)
            {
               return false;
            }
            else if (*begin == ':')
            {
               ++begin;
               attr_set_filter cond;
               auto            pos = result.size();
               if (!parse(true, &cond))
               {
                  return false;
               }
               if (begin == end || *begin != '}')
               {
                  return false;
               }
               ++begin;
               result.push_back(
                   [cond = std::move(cond), format = reduce(pos)](auto& rec, auto& stream)
                   {
                      if (cond(rec.attribute_values()))
                      {
                         format(rec, stream);
                      }
                   });
            }
            else
            {
               boost::log::filter filter;
               if (!parse_filter(filter))
               {
                  return false;
               }
               if (begin == end || *begin != ':')
               {
                  return false;
               }
               auto pos = result.size();
               ++begin;
               parse(true);
               if (begin == end || *begin != '}')
               {
                  return false;
               }
               ++begin;
               result.push_back(
                   [filter = std::move(filter), format = reduce(pos)](auto&& rec, auto&& stream)
                   {
                      if (filter(rec.attribute_values()))
                      {
                         format(rec, stream);
                      }
                   });
            }
            return true;
         }
         bool parse_filter(boost::log::filter& out)
         {
            filter_parser parser{begin, end};
            if (parser.parse(true))
            {
               // If there isn't exactly one, it's a bug in parse
               assert(parser.result.size() == 1);
               out   = parser.result.front();
               begin = parser.begin;
               return true;
            }
            return false;
         }
         bool parse(bool in_expansion = false, attr_set_filter* condition = nullptr)
         {
            bool prev_close = false;
            while (begin != end)
            {
               if (*begin == '{')
               {
                  prev_close = false;
                  ++begin;
                  if (!parse_expansion(condition))
                  {
                     return false;
                  }
               }
               else if (*begin == '}')
               {
                  if (in_expansion)
                  {
                     end_text();
                     return true;
                  }
                  else if (prev_close)
                  {
                     prev_close = false;
                  }
                  else
                  {
                     prev_close = true;
                     text.push_back('}');
                  }
                  ++begin;
               }
               else
               {
                  prev_close = false;
                  text.push_back(*begin);
                  ++begin;
               }
            }
            end_text();
            return true;
         }
      };

      std::map<std::string_view, filter_generator, std::less<>> filter_parser::global_filters;
      std::map<std::string_view, filter_generator_ext, std::less<>>
          filter_parser::global_filters_ext;
      std::map<std::string_view,
               std::pair<boost::log::attribute_name, formatter_generator>,
               std::less<>>
          formatter_parser::global_formatters;

      boost::log::filter parse_filter(std::string_view filter)
      {
         filter_parser parser{filter.begin(), filter.end()};
         if (!parser.parse())
         {
            throw std::runtime_error("Invalid filter");
         }
         assert(parser.result.size() == 1);
         return std::move(parser.result[0]);
      }

      boost::log::formatter parse_formatter(std::string_view formatter, bool in_expansion)
      {
         formatter_parser parser{formatter.begin(), formatter.end()};
         if (!parser.parse(in_expansion))
         {
            throw std::runtime_error("Invalid formatter");
         }
         return parser.reduce();
      }

      template <typename T>
      boost::log::filter make_filter_impl(boost::log::attribute_name name,
                                          std::string_view           op,
                                          const T&)
      {
         throw std::runtime_error(name.string() + " does not support " + std::string(op));
      }
      template <typename T, typename F, typename... U>
      boost::log::filter make_filter_impl(boost::log::attribute_name name,
                                          std::string_view           op,
                                          const T&                   value,
                                          std::string_view           op0,
                                          F                          f,
                                          U... u)
      {
         if (op == op0)
         {
            return [name, value, f](const auto& attrs)
            {
               if (auto attr = boost::log::extract<T>(name, attrs))
               {
                  return f(*attr, value);
               }
               return false;
            };
         }
         else
         {
            return make_filter_impl(name, op, value, u...);
         }
      }

      template <typename T>
      auto make_simple_filter_factory()
      {
         return [](boost::log::attribute_name name, std::string_view op, std::string_view value)
         {
            T v = boost::lexical_cast<T>(std::string(value));
            return make_filter_impl(name, op, v, "=", std::equal_to<>(),
                                    "!=", std::not_equal_to<>(), "<", std::less<>(), ">",
                                    std::greater<>(), "<=", std::less_equal<>(),
                                    ">=", std::greater_equal<>());
         };
      };

      template <>
      auto make_simple_filter_factory<std::chrono::system_clock::time_point>()
      {
         return [](boost::log::attribute_name name, std::string_view op, std::string_view value)
         {
            psio::input_stream                    stream(value);
            std::chrono::system_clock::time_point v;
            // TODO: allow optional subseconds
            if (!parse_timestamp(v, stream) || stream.remaining())
            {
               throw std::runtime_error("invalid timestamp value");
            }
            return make_filter_impl(name, op, v, "=", std::equal_to<>(),
                                    "!=", std::not_equal_to<>(), "<", std::less<>(), ">",
                                    std::greater<>(), "<=", std::less_equal<>(),
                                    ">=", std::greater_equal<>());
         };
      };

      template <>
      auto make_simple_filter_factory<Checksum256>()
      {
         return [](boost::log::attribute_name name, std::string_view op, std::string_view value)
         {
            Checksum256 v;
            if (value.size() != v.size() * 2 || !psio::unhex(v.begin(), value.begin(), value.end()))
            {
               throw std::runtime_error("Invalid value for " + name.string());
            }
            return make_filter_impl(name, op, v, "=", std::equal_to<>(),
                                    "!=", std::not_equal_to<>(), "<", std::less<>(), ">",
                                    std::greater<>(), "<=", std::less_equal<>(),
                                    ">=", std::greater_equal<>());
         };
      };

      template <>
      auto make_simple_filter_factory<BlockHeader>()
      {
         return [](boost::log::attribute_name name, std::string_view op,
                   std::string_view value) -> boost::log::filter
         { throw std::runtime_error(name.string() + " does not support " + std::string(op)); };
      };

      template <>
      auto make_simple_filter_factory<TransactionTrace>()
      {
         return [](boost::log::attribute_name name, std::string_view op,
                   std::string_view value) -> boost::log::filter
         { throw std::runtime_error(name.string() + " does not support " + std::string(op)); };
      };

      template <>
      auto make_simple_filter_factory<boost::log::process_id>()
      {
         return [](boost::log::attribute_name name, std::string_view op, std::string_view value)
         {
            boost::log::process_id v{
                boost::lexical_cast<boost::log::process_id::native_type>(value)};
            return make_filter_impl(name, op, v, "=", std::equal_to<>(),
                                    "!=", std::not_equal_to<>(), "<", std::less<>(), ">",
                                    std::greater<>(), "<=", std::less_equal<>(),
                                    ">=", std::greater_equal<>());
         };
      };

      template <>
      auto make_simple_filter_factory<std::chrono::microseconds>()
      {
         return [](boost::log::attribute_name name, std::string_view op, std::string_view value)
         {
            // TODO: interpret units
            std::chrono::microseconds v{boost::lexical_cast<std::chrono::microseconds::rep>(value)};
            return make_filter_impl(name, op, v, "=", std::equal_to<>(),
                                    "!=", std::not_equal_to<>(), "<", std::less<>(), ">",
                                    std::greater<>(), "<=", std::less_equal<>(),
                                    ">=", std::greater_equal<>());
         };
      };

      auto make_alias_filter_factory(boost::log::attribute_name name)
      {
         return [name](boost::log::attribute_name /*name*/, std::string_view& trailing)
         { return [name](const auto& attrs) { return attrs.count(name) != 0; }; };
      }

      template <typename T>
      auto make_simple_formatter_factory()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("std::format not supported yet");
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<T>(name, rec))
               {
                  stream << *attr;
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<level>()
      {
         return [](boost::log::attribute_name name, std::string_view spec) -> boost::log::formatter
         {
            if (spec == "d")
            {
               return [name](auto& rec, auto& stream)
               {
                  if (auto attr = boost::log::extract<level>(name, rec))
                  {
                     stream << to_syslog(*attr);
                  }
               };
            }
            else if (!spec.empty() && spec != "s")
            {
               throw std::runtime_error("std::format not supported yet");
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<level>(name, rec))
               {
                  stream << *attr;
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<std::chrono::system_clock::time_point>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("std::format not supported yet");
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr =
                       boost::log::extract<std::chrono::system_clock::time_point>(name, rec))
               {
                  format_timestamp(stream, *attr);
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<Checksum256>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("Unexpected format spec for " + name.string());
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<Checksum256>(name, rec))
               {
                  stream << loggers::to_string(*attr);
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<BlockHeader>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("Unexpected format spec for " + name.string());
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<BlockHeader>(name, rec))
               {
                  stream << psio::convert_to_json(*attr);
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<TransactionTrace>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("Unexpected format spec for " + name.string());
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<TransactionTrace>(name, rec))
               {
                  stream << psio::convert_to_json(*attr);
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<boost::log::process_id>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("std::format not supported yet");
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<boost::log::process_id>(name, rec))
               {
                  stream << attr->native_id();
               }
            };
         };
      }

      template <>
      auto make_simple_formatter_factory<std::chrono::microseconds>()
      {
         return [](boost::log::attribute_name name, std::string_view spec)
         {
            if (!spec.empty())
            {
               throw std::runtime_error("std::format not supported yet");
            }
            return [name](auto& rec, auto& stream)
            {
               if (auto attr = boost::log::extract<std::chrono::microseconds>(name, rec))
               {
                  stream << attr->count();
               }
            };
         };
      }

      // name must refer to a string with static storage duration
      template <typename T>
      void add_attribute(std::string_view name)
      {
         filter_parser::global_filters.try_emplace(name, make_simple_filter_factory<T>());
         formatter_parser::global_formatters.try_emplace(
             name, boost::log::attribute_name{std::string(name)},
             make_simple_formatter_factory<T>());
      }

      // An attribute whose value is derived from another attribute
      template <typename F>
      void add_derived_attribute(std::string_view name, std::string_view ref, F&& f)
      {
         boost::log::attribute_name attr{std::string(ref)};
         filter_parser::global_filters_ext.try_emplace(name, make_alias_filter_factory(attr));
         formatter_parser::global_formatters.try_emplace(name, attr, std::forward<F>(f));
      }

      template <typename F>
      void add_compound_format(std::string_view name, F&& f)
      {
         formatter_parser::global_formatters.try_emplace(name, boost::log::attribute_name(),
                                                         std::forward<F>(f));
      }

      auto make_escape_formatter = [](auto name, std::string_view spec)
      {
         auto pos = spec.find(':');
         if (pos == std::string_view::npos)
         {
            throw std::runtime_error("Escape: missing format");
         }
         std::string chars{spec.substr(0, pos)};
         auto        nested = parse_formatter(spec.substr(pos + 1), true);
         return [chars = std::move(chars), nested = std::move(nested)](
                    const boost::log::record_view& rec, boost::log::formatting_ostream& os) mutable
         {
            std::string data;
            {
               boost::log::formatting_ostream nested_os{data};
               nested(rec, nested_os);
            }
            for (auto ch : data)
            {
               if (chars.find(ch) != std::string::npos)
                  os << '\\';
               os << ch;
            }
         };
      };

      auto make_frame_dec_formatter = [](auto name, std::string_view spec)
      {
         auto nested = parse_formatter(spec, true);
         return [nested = std::move(nested)](const boost::log::record_view&  rec,
                                             boost::log::formatting_ostream& os) mutable
         {
            std::string data;
            {
               boost::log::formatting_ostream nested_os{data};
               nested(rec, nested_os);
            }
            os << data.size() << ' ' << data;
         };
      };

      auto make_indent_formatter = [](auto name, std::string_view spec)
      {
         auto pos = spec.find(':');
         if (pos == std::string_view::npos)
         {
            throw std::runtime_error("Indent: missing format");
         }
         unsigned    indent = 0;
         const char* p      = spec.data();
         const char* end    = spec.data() + pos;
         auto        res    = std::from_chars(p, end, indent);
         if (res.ec != std::errc{} || res.ptr != end)
            throw std::runtime_error("Indent: invalid width");
         auto nested = parse_formatter(spec.substr(pos + 1), true);
         return [indent, nested = std::move(nested)](const boost::log::record_view&  rec,
                                                     boost::log::formatting_ostream& os) mutable
         {
            std::string data;
            {
               boost::log::formatting_ostream nested_os{data};
               nested(rec, nested_os);
            }
            if (!data.empty() && !os.str().empty() && !os.str().back() != '\n')
               os << '\n';
            bool indenting = true;
            for (auto ch : data)
            {
               if (ch == '\n')
                  indenting = true;
               else
               {
                  if (indenting)
                     for (unsigned i = 0; i < indent; ++i)
                        os << ' ';
                  indenting = false;
               }
               os << ch;
            }
            if (!data.empty() && data.back() != '\n')
               os << '\n';
         };
      };

      void print_trace_console(boost::log::formatting_ostream& os, const EventTrace& trace) {}
      void print_trace_console(boost::log::formatting_ostream& os, const ConsoleTrace& trace)
      {
         os << trace.console;
      }
      void print_trace_console(boost::log::formatting_ostream& os, const ActionTrace& trace)
      {
         for (const auto& inner : trace.innerTraces)
         {
            std::visit([&os](const auto& x) { print_trace_console(os, x); }, inner.inner);
         }
      }

      auto make_trace_console_formatter = [](auto name, std::string_view spec)
      {
         if (!spec.empty())
         {
            throw std::runtime_error("No formats defined for TraceConsole");
         }
         return
             [name](const boost::log::record_view& rec, boost::log::formatting_ostream& os) mutable
         {
            // possible formats: raw, escaped string, quoted string
            if (auto attr = boost::log::extract<psibase::TransactionTrace>(name, rec))
            {
               for (const auto& action : attr->actionTraces)
               {
                  print_trace_console(os, action);
               }
            }
         };
      };

      void do_init()
      {
         auto core = boost::log::core::get();
         core->add_global_attribute(
             "TimeStamp", boost::log::attributes::function<std::chrono::system_clock::time_point>(
                              []() { return std::chrono::system_clock::now(); }));

#ifndef HOST_NAME_MAX
#define HOST_NAME_MAX 255  // not defined on mac
#endif
         char hostname[HOST_NAME_MAX + 1];
         if (gethostname(hostname, sizeof(hostname)))
         {
            throw std::system_error{errno, std::generic_category()};
         }
         hostname[HOST_NAME_MAX] = '\0';
         core->add_global_attribute("Host",
                                    boost::log::attributes::constant(std::string(hostname)));
         core->add_global_attribute("Process", boost::log::attributes::current_process_name());
         core->add_global_attribute("ProcessId", boost::log::attributes::current_process_id());

         add_attribute<std::string>("Message");
         add_attribute<level>("Severity");
         add_attribute<std::chrono::system_clock::time_point>("TimeStamp");
         add_attribute<std::string>("RemoteEndpoint");
         add_attribute<Checksum256>("BlockId");
         add_attribute<Checksum256>("TransactionId");
         add_attribute<std::string>("Process");
         add_attribute<std::string>("Channel");
         add_attribute<std::string>("Host");
         add_attribute<int>("PeerId");
         add_attribute<boost::log::process_id>("ProcessId");
         add_attribute<BlockHeader>("BlockHeader");
         add_attribute<TransactionTrace>("Trace");
         add_attribute<std::string>("RequestMethod");
         add_attribute<std::string>("RequestTarget");
         add_attribute<std::string>("RequestHost");
         add_attribute<unsigned>("ResponseStatus");
         add_attribute<std::uint64_t>("ResponseBytes");
         add_attribute<std::chrono::microseconds>("PackTime");
         add_attribute<std::chrono::microseconds>("ServiceLoadTime");
         add_attribute<std::chrono::microseconds>("DatabaseTime");
         add_attribute<std::chrono::microseconds>("WasmExecTime");
         add_attribute<std::chrono::microseconds>("ResponseTime");

         add_derived_attribute("TraceConsole", "Trace", make_trace_console_formatter);

         add_compound_format("Json",
                             [](auto name, std::string_view spec)
                             {
                                if (!spec.empty())
                                {
                                   throw std::runtime_error("Unexpected format spec for Json");
                                }
                                return json_formatter;
                             });
         add_compound_format("Syslog", make_syslog_formatter);
         add_compound_format("Escape", make_escape_formatter);
         add_compound_format("Indent", make_indent_formatter);
         add_compound_format("FrameDec", make_frame_dec_formatter);
      }

      struct log_config
      {
         std::map<std::string,
                  std::pair<sink_config, boost::shared_ptr<boost::log::sinks::sink>>,
                  std::less<>>
              sinks;
         void init(const boost::program_options::variables_map& variables)
         {
            auto split_name = [](std::string_view name)
            {
               auto pos = name.rfind('.');
               if (pos == std::string::npos)
               {
                  throw std::runtime_error("Unknown option: logger." + std::string(name));
               }
               return std::pair{name.substr(0, pos), name.substr(pos + 1)};
            };

            auto             core = boost::log::core::get();
            std::string_view current_name;
            sink_config      current_config;
            sink_args_type   current_args;
            auto             push_sink = [&]()
            {
               if (current_config.type == "file")
               {
                  current_config.backend.emplace<FileSinkConfig>(current_args);
               }
               if (current_config.type == "local")
               {
                  current_config.backend.emplace<LocalSocketSinkConfig>(current_args);
               }
               if (current_config.type == "pipe")
               {
                  current_config.backend.emplace<PipeSinkConfig>(current_args);
               }
               auto sink = make_sink(current_config);
               sinks.try_emplace(std::string(current_name), std::move(current_config), sink);
               core->add_sink(sink);
            };
            // loggers.sink.var
            for (const auto& [name, v] : variables)
            {
               if (!name.starts_with("logger."))
               {
                  continue;
               }
               auto [logger_name, var_name] = split_name(std::string_view(name).substr(7));
               // If this logger was already configured, ignore this configuration
               if (sinks.find(logger_name) != sinks.end())
               {
                  continue;
               }
               if (logger_name != current_name)
               {
                  if (!current_name.empty())
                  {
                     push_sink();
                  }
                  current_name   = logger_name;
                  current_config = sink_config();
                  current_args   = sink_args_type();
               }
               std::string_view value = v.as<std::string>();
               if (var_name == "type")
               {
                  current_config.type = value;
               }
               else if (var_name == "filter")
               {
                  current_config.filter_str = value;
                  current_config.filter     = parse_filter(value);
               }
               else if (var_name == "format")
               {
                  current_config.format_str = value;
                  current_config.format     = parse_formatter(value);
               }
               else
               {
                  if (var_name == "flush")
                  {
                     current_args.try_emplace(std::string(var_name), translate_bool(value));
                  }
                  else if (var_name == "maxSize" || var_name == "rotationSize")
                  {
                     current_args.try_emplace(std::string(var_name), translate_size(value));
                  }
                  else
                  {
                     current_args.try_emplace(std::string(var_name), std::string(value));
                  }
               }
            }
            if (!current_name.empty())
            {
               push_sink();
            }
            if (sinks.empty())
            {
               core->set_logging_enabled(false);
            }
         }
         void set_parsed(auto&& map)
         {
            auto core = boost::log::core::get();
            for (auto& [name, cfg] : map)
            {
               auto iter = sinks.find(name);
               if (iter == sinks.end())
               {
                  auto sink = make_sink(cfg);
                  sinks.try_emplace(std::string(name), cfg, sink);
                  core->add_sink(sink);
               }
               else
               {
                  update_sink(iter->second.second, iter->second.first, sink_config(cfg));
               }
            }
            core->set_logging_enabled(!map.empty());
            for (auto iter = sinks.begin(), end = sinks.end(); iter != end;)
            {
               if (map.find(iter->first) != map.end())
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

      void check_logger_name(std::string_view name)
      {
         // forbid characters that would cause problems in ini section names
         if (name.find_first_of(std::string_view{"#\n", 3}) != std::string_view::npos ||
             name.ends_with('.'))
         {
            throw std::runtime_error("Logger name not allowed: " + std::string(name));
         }
      }

   }  // namespace

   void set_path(std::string_view p)
   {
      log_file_path = std::filesystem::current_path() / p;
   }

   void configure(const boost::program_options::variables_map& map)
   {
      log_config::instance().init(map);
   }
   std::string get_config()
   {
      std::string         result;
      psio::string_stream stream{result};
      to_json(log_config::instance(), stream);
      return result;
   }

   struct Config::Impl
   {
      std::map<std::string, sink_config> sinks;
   };

   Config Config::get()
   {
      Config result;
      result.impl.reset(new Impl);
      for (const auto& [name, cfg] : log_config::instance().sinks)
      {
         result.impl->sinks.try_emplace(name, cfg.first);
      }
      return result;
   }

   void configure(const Config& cfg)
   {
      if (!cfg.impl)
      {
         Config::Impl tmp;
         log_config::instance().set_parsed(tmp.sinks);
      }
      else
      {
         log_config::instance().set_parsed(cfg.impl->sinks);
      }
   }

   void from_json(Config& obj, psio::json_token_stream& stream)
   {
      if (!obj.impl)
      {
         obj.impl.reset(new Config::Impl);
      }
      // Ensure that the format and filter parsers are initialized
      log_config::instance();
      from_json_object(stream,
                       [&](std::string_view key)
                       {
                          check_logger_name(key);
                          sink_config cfg;
                          from_json(cfg, stream);
                          auto [iter, inserted] =
                              obj.impl->sinks.try_emplace(std::string(key), std::move(cfg));
                          if (!inserted)
                          {
                             iter->second = std::move(cfg);
                          }
                       });
   }

   void to_json(const Config& obj, psio::vector_stream& stream)
   {
      if (!obj.impl)
      {
         stream.write("{}", 2);
      }
      else
      {
         bool first = true;
         stream.write('{');
         for (const auto& [key, value] : obj.impl->sinks)
         {
            if (first)
            {
               first = false;
            }
            else
            {
               stream.write(',');
            }
            to_json(key, stream);
            stream.write(':');
            to_json(value, stream);
         }
         stream.write('}');
      }
   }

   void to_config_impl(const std::string& section, const ConsoleSinkConfig, ConfigFile& file) {}

   void to_config_impl(const std::string& section, const FileSinkConfig& obj, ConfigFile& file)
   {
      if (!obj.filename.empty())
      {
         file.set(section, "filename", obj.filename.native(), "The log file pattern");
      }
      if (!obj.target.empty())
      {
         file.set(section, "target", obj.target.native(), "The pattern for rotated log files");
      }
      if (obj.rotationSize != std::numeric_limits<std::uint64_t>::max())
      {
         file.set(section, "rotationSize", std::to_string(obj.rotationSize),
                  "Rotate logs when they reach this size");
      }
      if (!obj.rotationTime.empty())
      {
         file.set(section, "rotationTime", obj.rotationTime, "Time when logs are rotated");
      }
      if (obj.maxFiles != std::numeric_limits<std::uint64_t>::max())
      {
         file.set(section, "maxFiles", std::to_string(obj.maxFiles),
                  "Maximum number of log files retained");
      }
      if (obj.maxSize != std::numeric_limits<std::uint64_t>::max())
      {
         file.set(section, "maxSize", std::to_string(obj.maxSize),
                  "Maximum total size of log files retained");
      }
      file.set(section, "flush", obj.flush ? "on" : "off", "Whether to flush every log record");
   }

   void to_config_impl(const std::string&           section,
                       const LocalSocketSinkConfig& obj,
                       ConfigFile&                  file)
   {
      file.set(section, "path", obj.path.native(), "");
   }

   void to_config_impl(const std::string& section, const PipeSinkConfig& obj, ConfigFile& file)
   {
      file.set(section, "command", obj.command, "");
   }

   void to_config(const Config& obj, ConfigFile& file)
   {
      if (obj.impl)
      {
         for (const auto& [name, sink] : obj.impl->sinks)
         {
            auto section = "logger." + name;
            file.set(section, "type", sink.type, "");
            file.set(section, "filter", sink.filter_str, "");
            file.set(section, "format", sink.format_str, "");
            std::visit([&](auto& v) { to_config_impl(section, v, file); }, sink.backend);
         }
      }
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
         case level::critical:
            os << "critical";
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
         else if (s == "critical")
         {
            l = level::critical;
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
