#include <psibase/LogQueue.hpp>
#include <psibase/log.hpp>

#include <psio/json/any.hpp>
#include <psio/to_json.hpp>

#include <boost/log/attributes/function.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/syslog_constants.hpp>
#include <boost/log/sinks/text_file_backend.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <boost/log/utility/setup/filter_parser.hpp>
#include <boost/log/utility/setup/formatter_parser.hpp>
#include <charconv>
#include <chrono>
#include <filesystem>
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

      // searchable with string_view
      using sink_args_type = std::map<std::string, psio::json::any, std::less<>>;

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
            auto get_int = [&](std::string_view key) -> std::uintmax_t
            {
               auto iter = args.find(key);
               if (iter != args.end())
               {
                  std::uintmax_t result;
                  const auto&    s   = as_string(iter->second);
                  auto           err = std::from_chars(s.data(), s.data() + s.size(), result);
                  if (err.ptr != s.data() + s.size() || err.ec != std::errc())
                  {
                     throw std::runtime_error("Expected an integer");
                  }
                  return result;
               }
               else
               {
                  return std::numeric_limits<std::uintmax_t>::max();
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
         void apply(boost::log::sinks::text_file_backend& backend) const
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
         std::uintmax_t                 maxFiles;
         std::uintmax_t                 maxSize;
         std::uintmax_t                 rotationSize;
         std::string                    rotationTime;
         bool                           flush = false;
         std::unique_ptr<time_rotation> rotationTimeFunc;
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
         if (obj.rotationSize != std::numeric_limits<std::uintmax_t>::max())
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
         if (obj.maxFiles != std::numeric_limits<std::uintmax_t>::max())
         {
            stream.write(',');
            psio::to_json("maxFiles", stream);
            stream.write(':');
            psio::to_json(obj.maxFiles, stream);
         }
         if (obj.maxSize != std::numeric_limits<std::uintmax_t>::max())
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

      struct sink_config
      {
         boost::log::formatter format;
         boost::log::filter    filter;
         std::string           format_str;
         std::string           filter_str;
         std::string           type;
         //
         std::variant<std::monostate, FileSinkConfig> backend;
      };

      void from_json(sink_config& obj, auto& stream)
      {
         sink_args_type args;
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
                                      psio::json::any val;
                                      psio::json::from_json(val, stream);
                                      args.try_emplace(std::string(key), std::move(val));
                                   }
                                });
         if (obj.type == "file")
         {
            obj.backend.emplace<FileSinkConfig>(args);
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
         stream.write(obj.format_str.data(), obj.format_str.size());
         if (auto* backend = std::get_if<FileSinkConfig>(&obj.backend))
         {
            to_json(*backend, stream);
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
            auto  backend       = boost::make_shared<boost::log::sinks::text_file_backend>();
            auto& backendConfig = std::get<FileSinkConfig>(cfg.backend);
            backendConfig.apply(*backend);
            auto result = boost::make_shared<
                boost::log::sinks::synchronous_sink<boost::log::sinks::text_file_backend>>(backend);
            result->set_filter(cfg.filter);
            result->set_formatter(cfg.format);
            return result;
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
         else if (old_cfg.type == "file")
         {
            auto& backendConfig = std::get<FileSinkConfig>(new_cfg.backend);
            backendConfig.setPrevious(std::move(std::get<FileSinkConfig>(old_cfg.backend)));
            auto frontend = static_cast<
                boost::log::sinks::synchronous_sink<boost::log::sinks::text_file_backend>*>(
                sink.get());
            backendConfig.apply(*frontend->locked_backend());
            frontend->set_formatter(new_cfg.format);
            frontend->set_filter(new_cfg.filter);
            old_cfg = std::move(new_cfg);
         }
         else
         {
            throw std::runtime_error("Unkown sink type: " + new_cfg.type);
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
                                         sinks.try_emplace(std::string(key), std::move(cfg), sink);
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

   void set_path(std::string_view p)
   {
      log_file_path = std::filesystem::current_path() / p;
   }

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
