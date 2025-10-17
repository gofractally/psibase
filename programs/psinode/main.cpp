#include <psibase/ConfigFile.hpp>
#include <psibase/OpenSSLProver.hpp>
#include <psibase/PKCS11Prover.hpp>
#include <psibase/RunQueue.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/http.hpp>
#include <psibase/log.hpp>
#include <psibase/node.hpp>
#include <psibase/prefix.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/version.hpp>
#include <psibase/websocket.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include "connect.hpp"
#include "connection.hpp"
#include "psinode.hpp"

#include <boost/algorithm/string/replace.hpp>
#include <boost/log/core/core.hpp>
#include <boost/preprocessor/stringize.hpp>
#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <boost/asio/ssl/host_name_verification.hpp>

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;
using namespace psibase::net;

using http::listen_spec;

#define PSIBASE_VERSION_STRING \
   BOOST_PP_STRINGIZE(PSIBASE_VERSION_MAJOR) "." BOOST_PP_STRINGIZE(PSIBASE_VERSION_MINOR) "." BOOST_PP_STRINGIZE(PSIBASE_VERSION_PATCH)

struct native_service
{
   std::string           host;
   std::filesystem::path root;
   friend auto           operator<=>(const native_service&, const native_service&) = default;
};
PSIO_REFLECT(native_service, host, root)

void to_json(const native_service& obj, auto& stream)
{
   stream.write('{');
   to_json("host", stream);
   stream.write(':');
   to_json(obj.host, stream);
   stream.write(',');
   to_json("root", stream);
   stream.write(':');
   to_json(obj.root.native(), stream);
   stream.write('}');
}

void from_json(native_service& obj, auto& stream)
{
   psio::from_json_object(stream,
                          [&](std::string_view key)
                          {
                             if (key == "host")
                             {
                                obj.host = stream.get_string();
                             }
                             else if (key == "root")
                             {
                                obj.root = stream.get_string();
                             }
                             else
                             {
                                psio::from_json_skip_value(stream);
                             }
                          });
}

std::string to_string(const native_service& obj)
{
   return obj.host + ":" + obj.root.native();
}

struct autoconnect_t
{
   static constexpr std::uint64_t max   = std::numeric_limits<std::size_t>::max();
   uint64_t                       value = max;
};

void to_json(const autoconnect_t& obj, auto& stream)
{
   if (obj.value == autoconnect_t::max)
   {
      to_json(true, stream);
   }
   else
   {
      to_json(obj.value, stream);
   }
}

void from_json(autoconnect_t& obj, auto& stream)
{
   auto t = stream.peek_token();
   if (t.get().type == psio::json_token_type::type_bool)
   {
      if (stream.get_bool())
      {
         obj.value = autoconnect_t::max;
      }
      else
      {
         obj.value = 0;
      }
   }
   else
   {
      from_json(obj.value, stream);
   }
}

void validate(boost::any& v, const std::vector<std::string>& values, autoconnect_t*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   auto s = boost::program_options::validators::get_single_string(values);
   if (s == "on" || s == "true")
   {
      v = autoconnect_t{};
   }
   else if (s == "off" || s == "false")
   {
      v = autoconnect_t{0};
   }
   else
   {
      try
      {
         v = autoconnect_t{boost::lexical_cast<std::size_t>(s)};
      }
      catch (boost::bad_lexical_cast&)
      {
         throw boost::program_options::invalid_option_value(s);
      }
   }
}

struct byte_size
{
   std::size_t value;
};

void validate(boost::any& v, const std::vector<std::string>& values, byte_size*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   std::string_view s = boost::program_options::validators::get_single_string(values);

   byte_size result;
   auto      err = std::from_chars(s.begin(), s.end(), result.value);
   if (err.ec != std::errc())
   {
      throw boost::program_options::invalid_option_value(std::string(s));
   }
   s = {err.ptr, s.end()};
   if (!s.empty())
   {
      s = s.substr(std::min(s.find_first_not_of(" \t"), s.size()));
      if (s == "B")
      {
      }
      else if (s == "KiB" || s == "K")
      {
         result.value <<= 10;
      }
      else if (s == "MiB" || s == "M")
      {
         result.value <<= 20;
      }
      else if (s == "GiB" || s == "G")
      {
         result.value <<= 30;
      }
      else if (s == "TiB" || s == "T")
      {
         result.value <<= 40;
      }
      else if (s == "KB")
      {
         result.value *= 1000;
      }
      else if (s == "MB")
      {
         result.value *= 1000000;
      }
      else if (s == "GB")
      {
         result.value *= 1000000000;
      }
      else if (s == "TB")
      {
         result.value *= 1000000000000;
      }
      else
      {
         throw boost::program_options::invalid_option_value(std::string(s));
      }
   }
   v = result;
};

struct Timeout
{
   std::chrono::microseconds duration = std::chrono::seconds(-1);
   static Timeout            none() { return {}; }
   friend bool               operator==(const Timeout&, const Timeout&) = default;
};

void validate(boost::any& v, const std::vector<std::string>& values, Timeout*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   std::string_view s = boost::program_options::validators::get_single_string(values);

   if (s == "" || s == "inf" || s == "off" || s == "no" || s == "false")
   {
      v = Timeout::none();
      return;
   }

   std::uint64_t value   = 0;
   bool          frac    = false;
   std::uint64_t divisor = 1;
   auto          iter    = s.begin();
   auto          end     = s.end();
   for (; iter != end; ++iter)
   {
      char ch = *iter;
      if (ch == '.' && !frac)
      {
         frac = true;
      }
      else if (ch >= '0' && ch <= '9')
      {
         value = value * 10 + (ch - '0');
         if (frac)
            divisor *= 10;
      }
      else
      {
         break;
      }
   }
   s = {iter, end};
   if (!s.empty())
   {
      s = s.substr(std::min(s.find_first_not_of(" \t"), s.size()));
      if (s == "s")
      {
      }
      else if (s == "ms")
      {
         divisor *= 1000;
      }
      else if (s == "us" || s == "µs" || s == "μs")
      {
         divisor *= 1000000;
      }
      else if (s == "ns")
      {
         divisor *= 1000000000;
      }
      else
      {
         throw boost::program_options::invalid_option_value(std::string(s));
      }
   }
   v = Timeout{std::chrono::microseconds{value * 1000000 / divisor}};
};

std::string to_string(const Timeout& timeout)
{
   if (timeout == Timeout::none())
   {
      return "inf";
   }
   auto us = std::chrono::duration_cast<std::chrono::microseconds>(timeout.duration).count();
   if (us % 1000000 == 0)
   {
      return std::to_string(us / 1000000) + " s";
   }
   else if (us % 1000 == 0)
   {
      return std::to_string(us / 1000) + " ms";
   }
   else
   {
      return std::to_string(us) + " us";
   }
}

void to_json(const Timeout& obj, auto& stream)
{
   if (obj != Timeout::none())
   {
      std::int64_t us = std::chrono::duration_cast<std::chrono::microseconds>(obj.duration).count();
      to_json(us, stream);
   }
   else
   {
      stream.write("null", 4);
   }
}

void from_json(Timeout& obj, auto& stream)
{
   std::optional<std::int64_t> us;
   from_json(us, stream);
   if (us)
   {
      obj.duration = std::chrono::microseconds{*us};
   }
   else
   {
      obj = Timeout::none();
   }
}

std::filesystem::path option_path;
ConfigFileOptions     config_options{.expandValue =
                                     [](std::string_view key)
                                 {
                                    // shell commands are processed by the shell. They should not go
                                    // through another round of expansion.
                                    return !key.ends_with(".command");
                                 },
                                     .allowUnregistered = true};
std::filesystem::path parse_path(std::string_view             s,
                                 const std::filesystem::path& context = option_path)
{
   if (s.empty())
   {
      return std::filesystem::path();
   }
   else
   {
      return context / s;
   }
}

void parse_config(native_service&              service,
                  std::string_view             str,
                  const std::filesystem::path& context = option_path)
{
   auto pos = str.starts_with('[') ? str.find("]:") : str.find(':');
   if (pos == std::string_view::npos)
   {
      service.root = parse_path(str, context);
      service.host = (service.root.has_filename() ? service.root.filename()
                                                  : service.root.parent_path().filename())
                         .native() +
                     ".";
   }
   else
   {
      pos          = str.find(':', pos);
      service.host = str.substr(0, pos);
      service.root = parse_path(str.substr(pos + 1), context);
   }
}

native_service service_from_string(std::string_view s)
{
   native_service result;
   parse_config(result, s);
   return result;
}

void validate(boost::any& v, const std::vector<std::string>& values, native_service*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   native_service result;
   std::string    s = boost::program_options::validators::get_single_string(values);
   try
   {
      parse_config(result, s);
   }
   catch (std::exception&)
   {
      throw boost::program_options::invalid_option_value(s);
   }
   v = std::move(result);
}

std::filesystem::path config_template_path()
{
   return installPrefix() / "share" / "psibase" / "config.in";
}

std::filesystem::path database_template_path()
{
   return installPrefix() / "share" / "psibase" / "services";
}

std::filesystem::path package_path()
{
   return installPrefix() / "share" / "psibase" / "packages";
}

void initialize_database(SystemContext& context, const std::string& template_);

void load_environment(Database& db)
{
   for (const char* const* iter = ::environ; *iter; ++iter)
   {
      std::string_view entry{*iter};
      auto             pos = entry.find('=');
      if (pos != std::string_view::npos)
      {
         EnvRow row{.name  = std::string(entry.substr(0, pos)),
                    .value = std::string{entry.substr(pos + 1)}};
         db.kvPut(EnvRow::db, row.key(), row);
      }
   }
}

void load_service(const native_service& config,
                  http::services_t&     services,
                  const std::string&    root_host)
{
   auto  host    = config.host.ends_with('.') ? config.host + root_host : config.host;
   auto& service = services[host];
   if (config.root.empty())
      return;
   for (const auto& entry : std::filesystem::recursive_directory_iterator{
            config.root, std::filesystem::directory_options::follow_directory_symlink})
   {
      auto                 extension = entry.path().filename().extension().native();
      http::native_content result;
      if (extension == ".html")
      {
         result.content_type = "text/html";
      }
      else if (extension == ".svg")
      {
         result.content_type = "image/svg+xml";
      }
      else if (extension == ".js" || extension == ".mjs")
      {
         result.content_type = "text/javascript";
      }
      else if (extension == ".css")
      {
         result.content_type = "text/css";
      }
      else if (extension == ".ttf")
      {
         result.content_type = "font/ttf";
      }
      else if (extension == ".wasm")
      {
         result.content_type = "application/wasm";
      }
      else if (extension == ".json")
      {
         result.content_type = "application/json";
      }
      else if (extension == ".psi")
      {
         result.content_type = "application/zip";
      }
      if (!result.content_type.empty() && entry.is_regular_file())
      {
         result.path = entry.path();
         auto path   = "/" + entry.path().lexically_relative(config.root).generic_string();
         service.try_emplace(path, result);
         if (path.ends_with("/index.html"))
         {
            service.try_emplace(path.substr(0, path.size() - 10), result);
            if (path.size() > 11)
            {
               service.try_emplace(path.substr(0, path.size() - 11), result);
            }
         }
      }
   }
}

namespace psibase
{
   void validate(boost::any&                     v,
                 const std::vector<std::string>& values,
                 std::shared_ptr<Prover>*,
                 int)
   {
      boost::program_options::validators::check_first_occurrence(v);
      const auto& s = boost::program_options::validators::get_single_string(values);
      if (s.starts_with('{'))
      {
         auto                    key = psio::convert_from_json<ClaimKey>(s);
         std::shared_ptr<Prover> result;

         if (key.service.str() == "verify-sig")
         {
            result = std::make_shared<OpenSSLProver>(key.service, key.rawData);
         }
         else
         {
            throw std::runtime_error("Not implemented: keys from service " + key.service.str());
         }
         v = result;
      }
      else
      {
         throw std::runtime_error("Not implemented: Key must be specified using a ClaimKey object");
      }
   }

   namespace http
   {
      void validate(boost::any& v, const std::vector<std::string>& values, listen_spec*, int)
      {
         boost::program_options::validators::check_first_occurrence(v);
         const auto& s = boost::program_options::validators::get_single_string(values);
         try
         {
            v = parse_listen(s);
         }
         catch (std::exception& e)
         {
            throw boost::program_options::invalid_option_value(s);
         }
      }
   }  // namespace http

   namespace pkcs11
   {
      void validate(boost::any& v, const std::vector<std::string>& values, URI*, int)
      {
         boost::program_options::validators::check_first_occurrence(v);
         const auto& s = boost::program_options::validators::get_single_string(values);
         try
         {
            v = URI(s);
         }
         catch (std::exception& e)
         {
            throw boost::program_options::invalid_option_value(s);
         }
      }
   }  // namespace pkcs11
}  // namespace psibase

#define RETHROW_BAD_ALLOC  \
   catch (std::bad_alloc&) \
   {                       \
      throw;               \
   }

#define CATCH_IGNORE \
   catch (...) {}

std::vector<std::string> translate_endpoints(std::vector<std::string> urls)
{
   for (auto& url : urls)
   {
      if (url.find('/') == std::string::npos)
      {
         url = "http://" + url + "/";
      }
   }
   return urls;
}

struct ShutdownArgs
{
   std::optional<std::vector<std::string>> restart;
   bool                                    soft = false;
   std::optional<std::int64_t>             deadline;
};
PSIO_REFLECT(ShutdownArgs, restart, soft, deadline)

// connect,disconnect

struct ConnectRequest
{
   std::string url;
};
PSIO_REFLECT(ConnectRequest, url);

struct DisconnectRequest
{
   peer_id id;
};
PSIO_REFLECT(DisconnectRequest, id);

struct NewKeyRequest
{
   AccountNumber                    service;
   std::optional<std::vector<char>> rawData;
   std::string                      device;
};
PSIO_REFLECT(NewKeyRequest, service, rawData, device);

struct UnlockKeyringRequest
{
   std::string pin;
   std::string device;
};
PSIO_REFLECT(UnlockKeyringRequest, pin, device);

struct LockKeyringRequest
{
   std::string device;
};
PSIO_REFLECT(LockKeyringRequest, device);

struct PKCS11TokenInfo
{
   std::string name;
   std::string id;
   bool        unlocked;
};
PSIO_REFLECT(PKCS11TokenInfo, name, id, unlocked);

struct RestartInfo
{
   // If the server stops for any reason other than an explicit
   // shutdown request, then all the other parameters should be ignored.
   std::optional<ShutdownArgs> args;
   // We need to track these to filter command line arguments on restart
   bool keysChanged   = false;
   bool configChanged = false;
};
PSIO_REFLECT(RestartInfo, shouldRestart);

struct ThreadInfo
{
   pid_t       id;
   std::string group;
   uint64_t    user;
   uint64_t    system;
   uint64_t    pageFaults;
   uint64_t    read;
   uint64_t    written;
};
PSIO_REFLECT(ThreadInfo, id, group, user, system, pageFaults, read, written)

struct MemStats
{
   uint64_t database;
   uint64_t code;
   uint64_t data;
   uint64_t wasmMemory;
   uint64_t wasmCode;
   uint64_t unclassified;
};
PSIO_REFLECT(MemStats, database, code, data, wasmMemory, wasmCode, unclassified)

struct Perf
{
   std::int64_t            timestamp;
   MemStats                memory;
   std::vector<ThreadInfo> tasks;
};
PSIO_REFLECT(Perf, timestamp, memory, tasks)

void write_om_descriptor(std::string_view name,
                         std::string_view type,
                         std::string_view unit,
                         std::string_view help,
                         auto&            stream)
{
   stream.write("# TYPE ", 7);
   stream.write(name.data(), name.size());
   stream.write(' ');
   stream.write(type.data(), type.size());
   stream.write('\n');

   if (!unit.empty())
   {
      stream.write("# UNIT ", 7);
      stream.write(name.data(), name.size());
      stream.write(' ');
      stream.write(unit.data(), unit.size());
      stream.write('\n');
   }

   stream.write("# HELP ", 7);
   stream.write(name.data(), name.size());
   stream.write(' ');
   stream.write(help.data(), help.size());
   stream.write('\n');
}

void write_om_mem(std::string_view name, std::int64_t v, auto& stream)
{
   std::string_view prefix = "psinode_memory_bytes{category=";
   stream.write(prefix.data(), prefix.size());
   to_json(name, stream);
   stream.write("} ", 2);
   auto value = std::to_string(v);
   stream.write(value.data(), value.size());
   stream.write('\n');
}

void write_om_mem(const Perf& perf, auto& stream)
{
   write_om_descriptor("psinode_memory_bytes", "gauge", "bytes", "Resident Memory", stream);
   write_om_mem("database", perf.memory.database, stream);
   write_om_mem("code", perf.memory.code, stream);
   write_om_mem("data", perf.memory.data, stream);
   write_om_mem("wasm_code", perf.memory.wasmCode, stream);
   write_om_mem("wasm_memory", perf.memory.wasmMemory, stream);
   write_om_mem("unclassified", perf.memory.unclassified, stream);
}

std::string usec_as_sec(std::int64_t time)
{
   return std::to_string(time) + "e-6";
}

void write_om_sample(std::string_view name, std::string_view value, auto& stream)
{
   stream.write(name.data(), name.size());
   stream.write(' ');
   stream.write(value.data(), value.size());
   stream.write('\n');
}

void write_om_task_sample(std::string_view  name,
                          const ThreadInfo& task,
                          std::string_view  value,
                          auto&             stream)
{
   stream.write(name.data(), name.size());
   stream.write("{group=", 7);
   to_json(task.group, stream);
   stream.write(",task=", 6);
   to_json(std::to_string(task.id), stream);
   stream.write("} ", 2);
   stream.write(value.data(), value.size());
   stream.write('\n');
}

void write_om_tasks(const Perf& perf, auto& stream)
{
   write_om_descriptor("psinode_cpu_user_seconds", "counter", "seconds", "CPU Time (User)", stream);
   for (const auto& task : perf.tasks)
   {
      write_om_task_sample("psinode_cpu_user_seconds_total", task, usec_as_sec(task.user), stream);
   }
   write_om_descriptor("psinode_cpu_system_seconds", "counter", "seconds", "CPU Time (System)",
                       stream);
   for (const auto& task : perf.tasks)
   {
      write_om_task_sample("psinode_cpu_system_seconds_total", task, usec_as_sec(task.system),
                           stream);
   }
   write_om_descriptor("psinode_page_faults", "counter", "", "Page Faults", stream);
   for (const auto& task : perf.tasks)
   {
      write_om_task_sample("psinode_page_faults_total", task, std::to_string(task.pageFaults),
                           stream);
   }
   write_om_descriptor("psinode_read_bytes", "counter", "bytes", "Bytes Read", stream);
   for (const auto& task : perf.tasks)
   {
      write_om_task_sample("psinode_read_bytes_total", task, std::to_string(task.read), stream);
   }
   write_om_descriptor("psinode_written_bytes", "counter", "bytes", "Bytes Written", stream);
   for (const auto& task : perf.tasks)
   {
      write_om_task_sample("psinode_written_bytes_total", task, std::to_string(task.written),
                           stream);
   }
}

template <typename S>
void to_openmetrics_text(const Perf& perf, S& stream)
{
   write_om_mem(perf, stream);
   write_om_tasks(perf, stream);
   stream.write("# EOF\n", 6);
}

std::int64_t read_as_microseconds(std::istream& is, long clk_tck)
{
   std::int64_t value;
   is >> value;
   return value / clk_tck * 1000000 + (value % clk_tck) * 1000000 / clk_tck;
}

ThreadInfo getThreadInfo(const std::filesystem::path& name, long clk_tck)
{
   ThreadInfo result = {};
   {
      std::ifstream in(name / "stat");
      in >> result.id;
      std::string tmp;
      for (int i = 0; i < 10; ++i)
      {
         in >> tmp;
      }
      // (12) majflt
      in >> result.pageFaults;
      in >> tmp;
      // (14) utime
      result.user = read_as_microseconds(in, clk_tck);
      // (15) stime
      result.system = read_as_microseconds(in, clk_tck);
   }
   if (result.id == getpid())
   {
      result.group = "chain";
   }
   else
   {
      std::ifstream in(name / "comm");
      char          buf[17] = {};
      in.read(buf, 16);
      std::string_view thread_name(buf);
      if (thread_name.starts_with("http"))
      {
         result.group = "http";
      }
      else if (thread_name.starts_with("swap"))
      {
         result.group = "database";
      }
   }
   {
      std::ifstream in(name / "io");
      std::string   line;
      auto          split = [](std::string_view line)
      {
         auto pos = line.find(": ");
         if (pos == std::string_view::npos)
         {
            return std::pair{std::string_view{}, std::string_view{}};
         }
         else
         {
            return std::pair{line.substr(0, pos), line.substr(pos + 2)};
         }
      };
      auto parse_int = [](std::string_view s)
      {
         std::int64_t result = 0;
         std::from_chars(s.begin(), s.end(), result);
         return result;
      };
      while (std::getline(in, line))
      {
         auto [key, value] = split(line);
         if (key == "read_bytes")
         {
            result.read = parse_int(value);
         }
         else if (key == "write_bytes")
         {
            result.written = parse_int(value);
         }
      }
   }
   return result;
}

struct MappingInfo
{
   std::uintptr_t begin;
   std::uintptr_t end;
   std::size_t    rss;
   bool           executable;
   bool           anonymous;
   bool           special;
};

bool parse_map_line(const char* begin, const char* end, MappingInfo& mapping)
{
   auto res = std::from_chars(begin, end, mapping.begin, 16);
   if (res.ec != std::errc())
      return false;
   begin = res.ptr;
   if (begin == end || *begin != '-')
      return false;
   ++begin;
   res = std::from_chars(begin, end, mapping.end, 16);
   if (res.ec != std::errc())
      return false;
   begin = res.ptr;

   auto read_field = [&]
   {
      while (begin != end && *begin == ' ')
      {
         ++begin;
      }
      const char* start = begin;
      while (begin != end && *begin != ' ')
      {
         ++begin;
      }
      return std::string_view{start, begin};
   };
   auto flags         = read_field();
   mapping.executable = flags.find('x') != std::string_view::npos;
   auto offset        = read_field();
   auto dev           = read_field();
   auto inode         = read_field();
   auto pathname      = read_field();
   mapping.anonymous  = pathname == "";
   mapping.special    = pathname.starts_with('[') && pathname.ends_with(']');
   return true;
}

bool parse_mapping_field(std::string_view line, std::size_t& value)
{
   auto pos = line.find(':');
   if (pos == std::string_view::npos)
      return false;
   pos      = line.find_first_not_of(' ', pos + 1);
   auto res = std::from_chars(line.begin() + pos, line.end(), value);
   if (res.ec != std::errc())
      return false;
   if (std::string_view(res.ptr, line.end()) != " kB")
      return false;
   value *= 1024;
   return true;
}

std::istream& operator>>(std::istream& is, MappingInfo& info)
{
   std::string line;
   if (!std::getline(is, line))
      return is;
   if (!parse_map_line(line.data(), line.data() + line.size(), info))
      throw std::runtime_error("Failed to parse mapping");
   info.rss = 0;
   while (std::getline(is, line))
   {
      if (line.starts_with("VmFlags:"))
         break;
      else if (line.starts_with("Rss:"))
      {
         if (!parse_mapping_field(line, info.rss))
            throw std::runtime_error("Failed to parse Rss");
      }
   }
   return is;
}

enum class RegionGroup
{
   unknown,
   database,
   wasmMemory,
   wasmCode,
};

struct RegionInfo
{
   struct Region
   {
      std::uintptr_t begin;
      std::uintptr_t end;
      RegionGroup    group;
   };
   // Returns the first region that intersects the given range
   RegionGroup get(std::uintptr_t begin, std::uintptr_t end)
   {
      auto pos = std::partition_point(regions.begin(), regions.end(),
                                      [begin](const auto& r) { return r.end <= begin; });
      if (pos != regions.end() && pos->begin < end)
         return pos->group;
      return RegionGroup::unknown;
   }
   void add(std::span<const char> range, RegionGroup group)
   {
      regions.push_back({reinterpret_cast<std::uintptr_t>(range.data()),
                         reinterpret_cast<std::uintptr_t>(range.data() + range.size()), group});
   }
   void prepare()
   {
      std::sort(regions.begin(), regions.end(),
                [](const auto& lhs, const auto& rhs) { return lhs.begin < rhs.begin; });
   }
   std::vector<Region> regions;
};

MemStats getMemStats(const SharedState& state)
{
   RegionInfo regions;
   for (auto span : state.dbSpan())
   {
      regions.add(span, RegionGroup::database);
   }
   for (auto span : state.codeSpan())
   {
      regions.add(span, RegionGroup::wasmCode);
   }
   for (auto span : state.linearMemorySpan())
   {
      regions.add(span, RegionGroup::wasmMemory);
   }
   regions.prepare();
   MemStats result = {};
   {
      std::ifstream in("/proc/self/smaps");
      MappingInfo   info;
      while (in >> info)
      {
         switch (regions.get(info.begin, info.end))
         {
            case RegionGroup::database:
               result.database += info.rss;
               break;
            case RegionGroup::wasmCode:
               result.wasmCode += info.rss;
               break;
            case RegionGroup::wasmMemory:
               result.wasmMemory += info.rss;
               break;
            default:
            {
               if (info.executable)
               {
                  result.code += info.rss;
               }
               else if (!info.anonymous && !info.special)
               {
                  result.data += info.rss;
               }
               else
               {
                  result.unclassified += info.rss;
               }
               break;
            }
         }
      }
   }
   return result;
}

Perf get_perf(const SharedState& state)
{
   long clk_tck = ::sysconf(_SC_CLK_TCK);
   Perf result;
   result.timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                          std::chrono::steady_clock::now().time_since_epoch())
                          .count();
   result.memory = getMemStats(state);
   for (const auto& entry : std::filesystem::directory_iterator("/proc/self/task"))
   {
      result.tasks.push_back(getThreadInfo(entry, clk_tck));
   }
   return result;
}

inline constexpr std::size_t ceil_log2(std::size_t v)
{
   std::size_t result = 0;
   while ((std::size_t(1) << result) < v)
   {
      ++result;
   }
   return result;
}

struct DbConfig
{
   DbConfig(byte_size cache)
   {
      cool_bytes = warm_bytes = hot_bytes = cache.value / 2;
      cold_bytes                          = 64 * 1024 * 1024;
   }
   uint64_t hot_bytes;
   uint64_t warm_bytes;
   uint64_t cool_bytes;
   uint64_t cold_bytes;
};

struct TLSConfig
{
   std::string              certificate;
   std::string              key;
   std::vector<std::string> trustfiles;
};
PSIO_REFLECT(TLSConfig, certificate, key, trustfiles)

using ExtraConfigFields =
    std::map<std::string, std::variant<std::string, std::vector<std::string>>>;

ExtraConfigFields extraConfig(const std::vector<boost::program_options::option>& opts)
{
   ExtraConfigFields result;
   for (const auto& option : opts)
   {
      if (!option.unregistered || option.value.empty())
         continue;
      auto [pos, inserted] = result.try_emplace(option.string_key, option.value);
      if (!inserted)
      {
         auto& value = std::get<std::vector<std::string>>(pos->second);
         value.insert(value.end(), option.value.begin(), option.value.end());
      }
   }
   return result;
}

struct PsinodeConfig
{
   std::vector<std::string>    peers;
   autoconnect_t               autoconnect;
   AccountNumber               producer;
   std::vector<std::string>    pkcs11_modules;
   std::vector<std::string>    hosts;
   std::vector<listen_spec>    listen;
   TLSConfig                   tls;
   std::vector<native_service> services;
   Timeout                     http_timeout;
   std::size_t                 service_threads;
   psibase::loggers::Config    loggers;
   std::vector<std::string>    argv;
   ExtraConfigFields           extra;

   static bool isNative(std::string_view name)
   {
      constexpr std::string_view opts[] = {
          "peers",        "autoconnect",     "producer", "pkcs11-modules",     "host",
          "listen",       "tls-key",         "tls-cert", "tls-trustfile",      "service",
          "http-timeout", "service-threads", "key",      "database-cache-size"};
      return std::ranges::find(opts, name) != std::end(opts) || name.starts_with("logger.");
   }
};
PSIO_REFLECT(PsinodeConfig,
             peers,
             autoconnect,
             producer,
             pkcs11_modules,
             hosts,
             listen,
#ifdef PSIBASE_ENABLE_SSL
             tls,
#endif
             services,
             http_timeout,
             service_threads,
             loggers,
             argv);

void from_json(PsinodeConfig& obj, auto& stream)
{
   from_json_object(stream,
                    [&](std::string_view key) -> void
                    {
                       bool found = psio::get_data_member<PsinodeConfig>(
                           key, [&](auto member) { from_json(obj.*member, stream); });
                       if (!found)
                       {
                          if (PsinodeConfig::isNative(key))
                             from_json_skip_value(stream);
                          else
                          {
                             auto t = stream.peek_token();
                             switch (t.get().type)
                             {
                                case psio::json_token_type::type_bool:
                                   obj.extra[std::string(key)] =
                                       stream.get_bool() ? "true" : "false";
                                   break;
                                case psio::json_token_type::type_string:
                                   obj.extra[std::string(key)] = std::string(stream.get_string());
                                   break;
                                case psio::json_token_type::type_start_array:
                                {
                                   std::vector<std::string> values;
                                   while (!stream.get_end_array_pred())
                                   {
                                      // bool or string
                                      auto t = stream.peek_token();
                                      if (t.get().type == psio::json_token_type::type_bool)
                                      {
                                         values.push_back(stream.get_bool() ? "true" : "false");
                                      }
                                      else
                                      {
                                         values.push_back(std::string(stream.get_string()));
                                      }
                                   }
                                   obj.extra[std::string(key)] = std::move(values);
                                   break;
                                }
                                default:
                                   from_json_skip_value(stream);
                                   break;
                             }
                          }
                       }
                    });
}

void to_json(const PsinodeConfig& obj, auto& stream)
{
   stream.write('{');
   std::size_t i = 0;
   psio::for_each_member(&obj, (typename psio::reflect<PsinodeConfig>::data_members*)nullptr,
                         [&](const auto& member)
                         {
                            if (i == 0)
                               increase_indent(stream);
                            else
                               stream.write(',');
                            to_json(psio::reflect<PsinodeConfig>::data_member_names[i], stream);
                            write_colon(stream);
                            to_json(member, stream);
                            ++i;
                         });
   for (const auto& [key, value] : obj.extra)
   {
      if (i == 0)
         increase_indent(stream);
      else
         stream.write(',');
      to_json(key, stream);
      write_colon(stream);
      std::visit([&](auto& v) { to_json(v, stream); }, value);
      ++i;
   }
   if (i != 0)
   {
      decrease_indent(stream);
      write_newline(stream);
   }
   stream.write('}');
}

void to_config(const PsinodeConfig& config, ConfigFile& file)
{
   if (!config.peers.empty())
   {
      file.set(
          "", "peer", config.peers, [](std::string_view text) { return std::string(text); },
          "Peer URL's");
   }
   if (config.autoconnect.value != autoconnect_t::max)
   {
      file.set("", "autoconnect", std::to_string(config.autoconnect.value),
               "The preferred number of outgoing peer connections.");
   }
   if (config.producer != AccountNumber())
   {
      file.set("", "producer", config.producer.str(), "The name to use for block production");
   }
   if (!config.pkcs11_modules.empty())
   {
      file.set(
          "", "pkcs11-module", config.pkcs11_modules,
          [](std::string_view text) { return std::string(text); }, "PKCS #11 modules to load");
   }
   if (!config.hosts.empty())
   {
      file.set(
          "", "host", config.hosts, [](std::string_view text) { return std::string(text); },
          "The HTTP server's host name");
   }
   if (!config.listen.empty())
   {
      std::vector<std::string> listen;
      for (const auto& l : config.listen)
      {
         listen.push_back(to_string(l));
      }
      file.set(
          "", "listen", listen, [](std::string_view text) { return std::string(text); },
          "TCP or local socket endpoint on which the server accepts connections");
   }
#ifdef PSIBASE_ENABLE_SSL
   if (!config.tls.certificate.empty())
   {
      file.set("", "tls-cert", config.tls.certificate,
               "A file containing the server's certificate chain");
   }
   if (!config.tls.key.empty())
   {
      file.set("", "tls-key", config.tls.key,
               "A file containing the key corresponding to tls-cert");
   }
   if (!config.tls.trustfiles.empty())
   {
      file.set(
          "", "tls-trustfile", config.tls.trustfiles, [](std::string_view text)
          { return std::string(text); }, "A file containing trusted certificate authorities");
   }
#endif
   if (!config.services.empty())
   {
      std::vector<std::string> services;
      for (const auto& service : config.services)
      {
         services.push_back(to_string(service));
      }
      file.set(
          "", "service", services, [](std::string_view text)
          { return service_from_string(text).host; }, "Native service root directory");
   }
   if (config.http_timeout != Timeout::none())
   {
      file.set("", "http-timeout", to_string(config.http_timeout),
               "The maximum time for HTTP clients to send or receive a message");
   }
   file.set("", "service-threads", std::to_string(config.service_threads),
            "The number of threads that run async actions posted by services");

   for (const auto& [key, value] : config.extra)
   {
      if (auto* s = std::get_if<std::string>(&value))
         file.set("", key, *s, "Service defined option");
      else if (auto* v = std::get_if<std::vector<std::string>>(&value))
         file.set(
             "", key, *v, [](std::string_view text) { return std::string(text); },
             "Service defined option");
   }

   // TODO: Not implemented yet.  Sign needs some thought,
   // because it's probably a bad idea to reveal the
   // private keys.
   file.keep("", "key");
   file.keep("", "database-cache-size");
   //
   to_config(config.loggers, file);
}

HostConfigRow toHostConfig(const PsinodeConfig& config)
{
   HostConfigRow result{
       .hostVersion = "psinode-" PSIBASE_VERSION_STRING,
   };
   std::vector<char>   configText;
   psio::vector_stream stream(configText);
   psio::to_json(config, stream);
   result.config = std::string(configText.begin(), configText.end());
   return result;
}

// Asio's timers are not usable for shutdown because they keep the io_context alive
struct ShutdownTimer
{
   void setDeadline(boost::asio::io_context& ctx, const std::optional<std::int64_t>& newDeadline)
   {
      {
         std::lock_guard l{mutex};
         if (newDeadline)
         {
            auto tp = std::chrono::steady_clock::time_point(MicroSeconds{*newDeadline});
            if (!deadline || tp < *deadline)
               cond.notify_one();
            deadline = tp;
         }
         else
         {
            deadline.reset();
         }
      }
      if (!worker.joinable())
      {
         worker = std::jthread{
             [this, &ctx]
             {
                while (!done && (!deadline || std::chrono::steady_clock::now() < *deadline))
                {
                   std::unique_lock l{mutex};
                   if (deadline)
                      cond.wait_until(l, *deadline);
                   else
                      cond.wait(l);
                }
                ctx.stop();
             }};
      }
   }
   ~ShutdownTimer()
   {
      std::lock_guard l{mutex};
      done = true;
      cond.notify_one();
   }
   std::condition_variable                              cond;
   std::mutex                                           mutex;
   bool                                                 done = false;
   std::optional<std::chrono::steady_clock::time_point> deadline;
   std::jthread                                         worker;
};

void run(const std::string&              db_path,
         const std::string&              db_template,
         const DbConfig&                 db_conf,
         AccountNumber                   producer,
         std::shared_ptr<CompoundProver> prover,
         std::vector<std::string>&       pkcs11_modules,
         const std::vector<std::string>& peers,
         autoconnect_t                   autoconnect,
         std::vector<std::string>&       hosts,
         std::vector<listen_spec>        listen,
         std::vector<native_service>&    services,
         Timeout&                        http_timeout,
         std::size_t&                    service_threads,
         std::vector<std::string>        root_ca,
         std::string                     tls_cert,
         std::string                     tls_key,
         const std::vector<std::string>& extra_options,
         const ExtraConfigFields&        extra_config_file_options,
         RestartInfo&                    runResult)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   auto sharedState = std::make_shared<psibase::SharedState>(
       SharedDatabase{
           db_path,
           {db_conf.hot_bytes, db_conf.warm_bytes, db_conf.cool_bytes, db_conf.cold_bytes},
           triedent::open_mode::resize},
       WasmCache{128});
   auto system      = sharedState->getSystemContext();
   auto proofSystem = sharedState->getSystemContext();

   if (system->sharedDatabase.isSlow())
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), warning)
          << "unable to lock memory for " << db_path
          << ". Try upgrading your shell's limits using \"sudo prlimit --memlock=-1 --pid "
             "$$\". "
             "If that doesn't work, try running psinode with \"sudo\".";
   }

   // If the server's config file doesn't exist yet, create it
   {
      auto config_path = std::filesystem::path(db_path) / "config";
      if (!std::filesystem::exists(config_path))
      {
         auto template_path = config_template_path();
         if (std::filesystem::is_regular_file(template_path))
         {
            std::filesystem::copy_file(template_path, config_path);
         }
      }
   }

   {
      Database           db{system->sharedDatabase, system->sharedDatabase.emptyRevision()};
      SocketAutoCloseSet autoClose;
      auto               session = db.startWrite(system->sharedDatabase.createWriter());
      db.checkoutSubjective();
      load_environment(db);
      HostConfigRow hostConfig = toHostConfig(PsinodeConfig{
          .peers          = peers,
          .autoconnect    = autoconnect,
          .producer       = producer,
          .pkcs11_modules = pkcs11_modules,
          .hosts          = hosts,
          .listen         = listen,
#ifdef PSIBASE_ENABLE_SSL
          .tls =
              {
                  .certificate = tls_cert,
                  .key         = tls_key,
                  .trustfiles  = root_ca,
              },
#endif
          .services        = services,
          .http_timeout    = http_timeout,
          .service_threads = service_threads,
          .loggers         = loggers::Config::get(),
          .argv            = extra_options,
          .extra           = extra_config_file_options,
      });
      db.kvPut(hostConfig.db, hostConfig.key(), hostConfig);
      if (!db.commitSubjective(*system->sockets, autoClose))
      {
         throw std::runtime_error("Failed to initialize database");
      }
   }
   // If this is a new database, initialize subjective services
   initialize_database(*system, db_template);
   {
      Action act{.service = proxyServiceNum, .rawData = psio::to_frac(std::tuple())};

      BlockContext bc{*system, system->sharedDatabase.getHead(),
                      system->sharedDatabase.createWriter(), true};

      TransactionTrace trace;
      bc.execAsyncExport("startSession", std::move(act), trace);
   }

   // Manages the session and and unlinks all keys from prover on destruction
   struct PKCS11SessionManager
   {
      PKCS11SessionManager(const std::shared_ptr<pkcs11::pkcs11_library>& lib,
                           pkcs11::slot_id_t                              slot)
          : session(std::make_shared<pkcs11::session>(lib, slot)),
            sessionProver(std::make_shared<CompoundProver>())
      {
      }
      ~PKCS11SessionManager() { unlink(); }
      void unlink()
      {
         if (baseProver)
         {
            baseProver->remove(sessionProver);
            baseProver.reset();
         }
      }
      void clear()
      {
         sessionProver->provers.clear();
         unlink();
      }
      pkcs11::session*                 operator->() const { return session.get(); }
      std::shared_ptr<pkcs11::session> session;
      std::shared_ptr<CompoundProver>  baseProver;
      std::shared_ptr<CompoundProver>  sessionProver;
   };
   auto loadSessionKeys = [&prover](PKCS11SessionManager& session)
   {
      loadPKCS11Keys(session.session, *session.sessionProver);
      session.unlink();
      prover->add(session.sessionProver);
      session.baseProver = prover;
   };

   using PKCS11LibInfo = std::pair<std::shared_ptr<pkcs11::pkcs11_library>,
                                   std::map<pkcs11::slot_id_t, PKCS11SessionManager>>;

   std::map<std::string, PKCS11LibInfo> pkcs11Libs;
   auto setPKCS11Libs = [&pkcs11Libs](const std::vector<std::string>& new_modules)
   {
      std::map<std::string, PKCS11LibInfo> newLibs;
      std::vector<std::string>             added;
      for (const std::string& path : new_modules)
      {
         if (auto node = pkcs11Libs.extract(path))
         {
            newLibs.insert(std::move(node));
         }
         else
         {
            added.push_back(path);
         }
      }
      // Unload modules first to avoid issues if the old configuration and the
      // new configuration include the same module under different names. Loading
      // the same module more than once is a Bad Idea (TM). Note that deduplicating
      // on the handle before calling C_Initialize is not sufficient, because
      // some modules (p11-kit-proxy) can load others.
      for (auto& [path, module] : pkcs11Libs)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), info)
             << "Unloading PKCS #11 module: " << path;
         module.second.clear();
         module.first.reset();
      }
      pkcs11Libs = std::move(newLibs);
      for (const std::string& path : added)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Loading PKCS #11 module: " << path;
         try
         {
            pkcs11Libs.insert({path, {std::make_shared<pkcs11::pkcs11_library>(path.c_str()), {}}});
         }
         catch (std::exception& e)
         {
            PSIBASE_LOG(psibase::loggers::generic::get(), warning) << e.what();
         }
      }
   };
   setPKCS11Libs(pkcs11_modules);

   auto getPKCS11Slot = [&pkcs11Libs](std::string_view uri)
   {
      pkcs11::URI                              token(uri);
      std::optional<pkcs11::slot_id_t>         found;
      std::shared_ptr<pkcs11::pkcs11_library>* foundLib      = nullptr;
      PKCS11LibInfo::second_type*              foundSessions = nullptr;
      for (auto& [k, v] : pkcs11Libs)
      {
         auto& [lib, sessions] = v;
         if (token.matches(lib->GetInfo()))
         {
            for (auto slot : lib->GetSlotList(true))
            {
               if (token.matches(slot, lib->GetSlotInfo(slot)) &&
                   token.matches(lib->GetTokenInfo(slot)))
               {
                  check(!found, "Multiple tokens match URI");
                  found         = slot;
                  foundLib      = &lib;
                  foundSessions = &sessions;
               }
            }
         }
      }
      check(!!found, "No token matches URI");
      return std::tuple{*foundLib, *found, foundSessions};
   };

   // http_config must live until server shutdown which happens when chainContext
   // is destroyed.
   auto http_config = std::make_shared<http::http_config>();

   // The runQueue needs to out-live the chainContext, so
   // that notify is safe.
   RunQueue runQueue{sharedState};

   boost::asio::io_context chainContext;

   auto server_work = boost::asio::make_work_guard(chainContext);

#ifdef PSIBASE_ENABLE_SSL
   http_config->tls_context =
       std::make_shared<boost::asio::ssl::context>(boost::asio::ssl::context::tlsv13);
   boost::asio::ssl::context& sslContext(*http_config->tls_context);
   if (root_ca.empty())
   {
      sslContext.set_default_verify_paths();
   }
   else
   {
      for (const auto& ca : root_ca)
      {
         sslContext.load_verify_file(ca);
      }
   }
   if (!tls_cert.empty())
   {
      sslContext.use_certificate_chain_file(tls_cert);
      sslContext.use_private_key_file(tls_key, boost::asio::ssl::context::pem);
   }
#endif

   using node_type = psinode;
   node_type node(chainContext, system.get(), prover);
   node.set_producer_id(producer);
   node.load_producers();
   node.set_hostnames(hosts);

   // The callback is *not* posted to chainContext. It can run concurrently.
   node.chain().onChangeRunQueue([&] { runQueue.notify(); });

   // This needs to be declared so the host config change handler can reference it,
   // but we can't safely start any threads until after all the node state
   // is initialized.
   WasmThreadPool tpool{runQueue, 0};

   ShutdownTimer shutdownTimer;

   // Used for outgoing connections
   boost::asio::ip::tcp::resolver resolver(chainContext);

   auto connect_one =
       make_connect_one(resolver, chainContext, http_config,
                        [&http_config, &node, &runResult](auto&& conn) -> std::error_code
                        {
                           if (http_config->status.load().shutdown)
                           {
                              conn->close(runResult.args && runResult.args->restart
                                              ? connection_base::close_code::restart
                                              : connection_base::close_code::shutdown);
                              return make_error_code(boost::asio::error::operation_aborted);
                           }
                           node.add_connection(std::move(conn));
                           return {};
                        });

   node.chain().onValidateHostConfig(
       [](std::span<const char> value)
       {
          auto view   = psio::view<const HostConfigRow>(value);
          auto config = psio::convert_from_json<PsinodeConfig>(view.config().unpack());
       });
   node.chain().onChangeHostConfig(
       [&chainContext, &node, &db_path, &runResult, &http_config, &hosts, &http_timeout,
        &service_threads, &tpool, &services, &tls_cert, &tls_key, &root_ca, &pkcs11_modules,
        &connect_one, &system, setPKCS11Libs]
       {
          boost::asio::post(
              chainContext,
              [&chainContext, &node, &db_path, &runResult, &http_config, &hosts, &services,
               &http_timeout, &service_threads, &tpool, &tls_cert, &tls_key, &root_ca,
               &pkcs11_modules, &connect_one, &system, setPKCS11Libs]
              {
                 auto writer = system->sharedDatabase.createWriter();
                 auto row    = system->sharedDatabase.kvGetSubjective(
                     *writer, HostConfigRow::db, psio::convert_to_key(hostConfigKey()));
                 auto hostConfig = psio::from_frac<HostConfigRow>(row.value());
                 auto config     = psio::convert_from_json<PsinodeConfig>(hostConfig.config);

                 std::optional<http::services_t> new_services;
                 for (auto& entry : config.services)
                 {
                    entry.root =
                        parse_path(entry.root.native(), std::filesystem::current_path() / db_path);
                 }
                 if (services != config.services || hosts != config.hosts)
                 {
                    new_services.emplace();
                    for (const auto& entry : config.services)
                    {
                       for (const auto& host : config.hosts)
                       {
                          load_service(entry, *new_services, host);
                       }
                    }
                 }
                 setPKCS11Libs(config.pkcs11_modules);
                 node.set_producer_id(config.producer);
                 node.set_hostnames(config.hosts);
                 if (!http_config->status.load().shutdown)
                 {
                    node.autoconnect(std::vector(config.peers), config.autoconnect.value,
                                     connect_one);
                 }
                 pkcs11_modules  = config.pkcs11_modules;
                 hosts           = config.hosts;
                 services        = config.services;
                 http_timeout    = config.http_timeout;
                 service_threads = config.service_threads;
#ifdef PSIBASE_ENABLE_SSL
                 tls_cert = config.tls.certificate;
                 tls_key  = config.tls.key;
                 root_ca  = config.tls.trustfiles;
#endif
                 loggers::configure(config.loggers);
                 {
                    std::lock_guard l{http_config->mutex};
                    http_config->hosts               = hosts;
                    http_config->listen              = config.listen;
                    http_config->enable_transactions = !hosts.empty();
                    http_config->idle_timeout_us     = http_timeout.duration.count();
                    if (new_services)
                    {
                       // Use swap instead of move to delay freeing the old
                       // services until after releasing the mutex
                       http_config->services.swap(*new_services);
                    }
                 }
                 tpool.setNumThreads(service_threads);
                 {
                    auto       path = std::filesystem::path(db_path) / "config";
                    ConfigFile file{config_options};
                    {
                       std::ifstream in(path);
                       file.parse(in);
                    }
                    to_config(config, file);
                    {
                       std::ofstream out(path);
                       file.write(out);
                    }
                    runResult.configChanged = true;
                 }
              });
       });

   node.chain().onChangeShutdown(
       [&chainContext, &node, &system, &connect_one, &http_config, &shutdownTimer, &runResult,
        &server_work]
       {
          boost::asio::post(
              chainContext,
              [&chainContext, &node, &system, &connect_one, &http_config, &shutdownTimer,
               &runResult, &server_work]
              {
                 auto writer = system->sharedDatabase.createWriter();
                 auto row    = system->sharedDatabase.kvGetSubjective(
                     *writer, PendingShutdownRow::db, psio::convert_to_key(pendingShutdownKey()));
                 if (!row)
                    return;
                 auto shutdown  = psio::from_frac<PendingShutdownRow>(row.value());
                 runResult.args = psio::convert_from_json<ShutdownArgs>(shutdown.args);

                 shutdownTimer.setDeadline(chainContext, runResult.args->deadline);

                 atomic_set_field(http_config->status,
                                  [](auto& status) { status.shutdown = true; });
                 boost::asio::use_service<http::server_service>(
                     static_cast<boost::asio::execution_context&>(chainContext))
                     .async_close(runResult.args->restart.has_value(),
                                  [&chainContext, &server_work]()
                                  {
                                     boost::asio::post(chainContext,
                                                       [&server_work]() { server_work.reset(); });
                                  });
                 node.consensus().async_shutdown();
                 node.peers().autoconnect({}, 0, connect_one);
                 node.peers().disconnect_all(runResult.args->restart.has_value());
              });
       });

   tpool.setNumThreads(service_threads);

   if (!listen.empty())
   {
      // TODO: command-line options
      http_config->num_threads         = 4;
      http_config->max_request_size    = 20 * 1024 * 1024;
      http_config->idle_timeout_us     = http_timeout.duration.count();
      http_config->listen              = listen;
      http_config->hosts               = hosts;
      http_config->enable_transactions = !hosts.empty();
      http_config->status              = http::http_status{
                       .slow = system->sharedDatabase.isSlow(), .startup = 1, .needgenesis = 1};

      for (const auto& entry : services)
      {
         for (const auto& host : hosts)
         {
            load_service(entry, http_config->services, host);
         }
      }

      // TODO: speculative execution on non-producers
      http_config->push_boot_async =
          [&chainContext, &node](std::vector<char>               packed_signed_transactions,
                                 http::push_transaction_callback callback)
      {
         boost::asio::post(chainContext,
                           [&node, callback = std::move(callback),
                            transactions = psio::from_frac<std::vector<SignedTransaction>>(
                                packed_signed_transactions)] mutable
                           {
                              TransactionTrace trace;
                              try
                              {
                                 node.push_boot(std::move(transactions), trace);
                              }
                              RETHROW_BAD_ALLOC
                              catch (std::exception& e)
                              {
                                 callback(e.what());
                                 return;
                              }
                              callback(std::move(trace));
                           });
      };

      http_config->accept_p2p_websocket = [&chainContext, &node](auto&& stream)
      {
         boost::asio::post(
             chainContext,
             [&node, stream = std::move(stream)]() mutable
             {
                node.add_connection(
                    std::make_shared<websocket_connection<
                        typename std::remove_cv_t<decltype(stream)>::next_layer_type>>(
                        std::move(stream)));
             });
      };

      http_config->get_perf = [sharedState](auto callback)
      {
         callback(
             [result = get_perf(*sharedState)]() mutable
             {
                std::vector<char>   json;
                psio::vector_stream stream(json);
                to_json(result, stream);
                return json;
             });
      };

      http_config->get_metrics = [sharedState](auto callback)
      {
         callback(
             [result = get_perf(*sharedState)]() mutable
             {
                std::vector<char>   data;
                psio::vector_stream stream(data);
                to_openmetrics_text(result, stream);
                return data;
             });
      };

      http_config->get_peers = [&chainContext, &node](http::get_peers_callback callback)
      {
         boost::asio::post(
             chainContext,
             [&chainContext, &node, callback = std::move(callback)]
             {
                http::get_peers_result result;
                for (const auto& [id, conn] : node.peers().connections())
                {
                   result.push_back(
                       {id, conn->endpoint(),
                        conn->urls.empty() ? std::nullopt : std::optional{conn->urls.front()}});
                }
                callback(std::move(result));
             });
      };

      http_config->connect = [&chainContext, &node, &resolver, &connect_one](
                                 std::vector<char> peer, http::connect_callback callback)
      {
         peer.push_back('\0');
         psio::json_token_stream stream(peer.data());

         boost::asio::post(chainContext,
                           [&chainContext, &node, &resolver, &connect_one,
                            peer     = psio::from_json<ConnectRequest>(stream),
                            callback = std::move(callback)]() mutable
                           {
                              // TODO: This is currently fire-and-forget, do we want
                              // to try to report errors establishing the connection?
                              // If so, when do we consider it successful? TCP connection?
                              // websocket handshake? Initial sync negotiation?
                              node.peers().connect(peer.url, connect_one);
                              callback(std::nullopt);
                           });
      };

      http_config->disconnect =
          [&chainContext, &node, &resolver](std::vector<char> peer, http::connect_callback callback)
      {
         peer.push_back('\0');
         psio::json_token_stream stream(peer.data());

         boost::asio::post(
             chainContext,
             [&chainContext, &node, &resolver, peer = psio::from_json<DisconnectRequest>(stream),
              callback = std::move(callback)]() mutable
             {
                if (!node.peers().disconnect(peer.id, connection_base::close_code::normal))
                {
                   callback("Unknown peer");
                }
                else
                {
                   callback(std::nullopt);
                }
             });
      };

      http_config->get_keys = [&chainContext, &prover](auto callback)
      {
         boost::asio::post(chainContext,
                           [&prover, callback = std::move(callback)]()
                           {
                              std::vector<Claim> result;
                              prover->get(result);
                              callback(
                                  [result = std::move(result)]() mutable
                                  {
                                     std::vector<char>   json;
                                     psio::vector_stream stream(json);
                                     to_json(result, stream);
                                     return json;
                                  });
                           });
      };

      http_config->new_key = [&chainContext, &node, &prover, &db_path, &runResult, getPKCS11Slot](
                                 std::vector<char> json, auto callback)
      {
         json.push_back('\0');
         psio::json_token_stream stream(json.data());
         auto                    key = psio::from_json<NewKeyRequest>(stream);
         if (key.service.str() != "verify-sig")
         {
            throw std::runtime_error("Not implemented for native signing: " + key.service.str());
         }
         boost::asio::post(
             chainContext,
             [&node, &prover, &db_path, &runResult, getPKCS11Slot, callback = std::move(callback),
              key = std::move(key)]() mutable
             {
                try
                {
                   std::shared_ptr<Prover> result;
                   bool                    storeConfig = true;
                   if (!key.device.empty())
                   {
                      auto [lib, slot, sessions] = getPKCS11Slot(key.device);
                      auto pos                   = sessions->find(slot);
                      check(pos != sessions->end(), "Device locked");
                      if (key.rawData)
                      {
                         result = std::make_shared<PKCS11Prover>(pos->second.session, key.service,
                                                                 *key.rawData);
                      }
                      else
                      {
                         result = std::make_shared<PKCS11Prover>(pos->second.session, key.service);
                      }
                      pos->second.sessionProver->add(result);
                      node.on_key_update();
                      storeConfig = false;
                   }
                   else if (key.service == AccountNumber{"verify-sig"})
                   {
                      if (key.rawData)
                      {
                         result = std::make_shared<OpenSSLProver>(key.service, *key.rawData);
                      }
                      else
                      {
                         result = std::make_shared<OpenSSLProver>(key.service);
                      }
                   }
                   else
                   {
                      check(false,
                            "should not get here, because service should have been checked "
                            "already");
                   }
                   std::vector<Claim> claim;
                   result->get(claim);
                   // Check for duplicates
                   if (storeConfig)
                   {
                      std::vector<Claim> existing;
                      prover->get(existing);
                      if (claim.empty() || std::ranges::find(existing, claim[0]) != existing.end())
                      {
                         storeConfig = false;
                      }
                   }
                   if (storeConfig)
                   {
                      prover->add(std::move(result));

                      auto       path = std::filesystem::path(db_path) / "config";
                      ConfigFile file{config_options};
                      {
                         std::ifstream in(path);
                         file.parse(in);
                      }
                      std::vector<ClaimKey> allKeys;
                      prover->get(allKeys);
                      std::vector<std::string> stringKeys;
                      for (const auto& k : allKeys)
                      {
                         stringKeys.push_back(psio::convert_to_json(k));
                      }
                      file.set(
                          "", "key", stringKeys, [](std::string_view s) { return std::string(s); },
                          "");
                      {
                         std::ofstream out(path);
                         file.write(out, true);
                      }
                      node.on_key_update();
                      runResult.keysChanged = true;
                   }
                   callback(
                       [result = std::move(claim)]() mutable
                       {
                          std::vector<char>   json;
                          psio::vector_stream stream(json);
                          to_json(result, stream);
                          return json;
                       });
                }
                catch (std::exception& e)
                {
                   callback(e.what());
                }
             });
      };

      http_config->unlock_keyring = [&chainContext, &node, loadSessionKeys, getPKCS11Slot](
                                        std::vector<char> json, auto callback)
      {
         json.push_back('\0');
         psio::json_token_stream stream(json.data());
         auto                    pin = psio::from_json<UnlockKeyringRequest>(stream);
         boost::asio::post(chainContext,
                           [&node, getPKCS11Slot, loadSessionKeys, callback = std::move(callback),
                            pin = std::move(pin)]() mutable
                           {
                              try
                              {
                                 auto [lib, slot, sessions] = getPKCS11Slot(pin.device);
                                 auto pos = sessions->try_emplace(slot, lib, slot).first;
                                 pos->second->Login(pin.pin);
                                 loadSessionKeys(pos->second);
                                 node.on_key_update();
                                 callback(std::nullopt);
                              }
                              catch (std::exception& e)
                              {
                                 callback(e.what());
                              }
                           });
      };

      http_config->lock_keyring =
          [&chainContext, getPKCS11Slot](std::vector<char> json, auto callback)
      {
         json.push_back('\0');
         psio::json_token_stream stream(json.data());
         auto                    id = psio::from_json<LockKeyringRequest>(stream);
         boost::asio::post(
             chainContext,
             [getPKCS11Slot, callback = std::move(callback), id = std::move(id)]() mutable
             {
                try
                {
                   auto [lib, slot, sessions] = getPKCS11Slot(id.device);
                   auto pos                   = sessions->find(slot);
                   check(pos != sessions->end(), "Not logged in");
                   pos->second->Logout();
                   pos->second.clear();
                   callback(std::nullopt);
                }
                catch (std::exception& e)
                {
                   callback(e.what());
                }
             });
      };

      http_config->get_pkcs11_tokens = [&chainContext, &pkcs11Libs](auto callback)
      {
         boost::asio::post(chainContext,
                           [&pkcs11Libs, callback = std::move(callback)]() mutable
                           {
                              try
                              {
                                 std::vector<PKCS11TokenInfo> result;
                                 for (const auto& [k, v] : pkcs11Libs)
                                 {
                                    const auto& [lib, sessions] = v;
                                    for (const auto& slot : lib->GetSlotList(true))
                                    {
                                       auto tinfo = lib->GetTokenInfo(slot);
                                       // We don't provide initialization, so skip uninitialized
                                       // tokens.
                                       if (!(tinfo.flags & pkcs11::token_initialized))
                                          continue;
                                       std::string_view label = pkcs11::getString(tinfo.label);
                                       std::string      id    = pkcs11::makeURI(tinfo);
                                       auto             session_pos = sessions.find(slot);
                                       bool             unlocked =
                                           session_pos != sessions.end() &&
                                           session_pos->second->GetSessionInfo().state ==
                                               pkcs11::state_t::rw_user_functions;
                                       result.push_back({.name     = std::string(label),
                                                         .id       = std::move(id),
                                                         .unlocked = unlocked});
                                    }
                                 }
                                 callback(
                                     [result = std::move(result)]() mutable
                                     {
                                        std::vector<char>   json;
                                        psio::vector_stream stream(json);
                                        to_json(result, stream);
                                        return json;
                                     });
                              }
                              catch (std::exception& e)
                              {
                                 callback(e.what());
                              }
                           });
      };

      boost::asio::make_service<http::server_service>(chainContext, http_config, sharedState);
   }
   else
   {
      PSIBASE_LOG(loggers::generic::get(), notice)
          << "The server is not configured to accept connections on any interface. Use --listen "
             "<port> to add a listener.";
      boost::asio::post(chainContext, [&server_work] { server_work.reset(); });
   }

   auto remove_http_handlers = psio::finally{[&http_config, &system]
                                             {
                                                {
                                                   std::lock_guard l{http_config->mutex};
                                                   http_config->push_boot_async = nullptr;
                                                }
                                                {
                                                   system->sockets->shutdown();
                                                }
                                             }};

   node.set_producer_id(producer);
   {
      atomic_set_field(http_config->status, [](auto& status) { status.startup = false; });
   }

   node.autoconnect(translate_endpoints(peers), autoconnect.value, connect_one);

   if (node.chain().get_head_state()->blockId() == Checksum256{} && peers.empty())
   {
      std::string xAdminSubdomain;
      for (const auto& service : services)
      {
         if (service.root.string().find("services/x-admin") != std::string::npos)
         {
            if (service.host.ends_with('.'))
            {
               if (!hosts.empty())
               {
                  xAdminSubdomain = service.host + hosts.front();
                  break;
               }
            }
            else if (xAdminSubdomain.empty())
            {
               xAdminSubdomain = service.host;
            }
         }
      }

      if (!xAdminSubdomain.empty())
      {
         std::string protocol;
         std::string port;
         for (const auto& listen : http_config->listen)
         {
            if (const auto* spec = std::get_if<psibase::http::tcp_listen_spec<true>>(&listen))
            {
               protocol = "https://";
               port     = std::to_string(spec->endpoint.port());
               break;
            }
            else if (const auto* spec = std::get_if<psibase::http::tcp_listen_spec<false>>(&listen))
            {
               protocol = "http://";
               port     = std::to_string(spec->endpoint.port());
            }
         }
         xAdminSubdomain = protocol + xAdminSubdomain + ":" + port;
      }

      std::string message = "Node is not connected to any psibase network.";
      if (!xAdminSubdomain.empty())
      {
         message += " Visit '" + xAdminSubdomain + "' for node setup.";
      }

      PSIBASE_LOG(node.chain().getLogger(), notice) << message;
   }

   chainContext.run();
}

const char usage[] = "USAGE: psinode database [OPTIONS]";

int main(int argc, char* argv[])
{
   // Must run before any additional threads are started
   {
      auto prefix = installPrefix();
      ::setenv("PREFIX", prefix.c_str(), 1);
      ::setenv("PSIBASE_DATADIR", (prefix / "share" / "psibase").c_str(), 1);
   }

   std::string                 db_template;
   std::string                 producer = {};
   auto                        keys     = std::make_shared<CompoundProver>();
   std::vector<std::string>    pkcs11_modules;
   std::vector<std::string>    hosts = {};
   std::vector<listen_spec>    listen;
   std::vector<std::string>    peers;
   autoconnect_t               autoconnect;
   std::vector<native_service> services;
   std::vector<std::string>    root_ca;
   std::string                 tls_cert;
   std::string                 tls_key;
   byte_size                   db_cache_size;
   byte_size                   db_size;
   Timeout                     http_timeout;
   std::size_t                 service_threads;
   std::vector<std::string>    extra_options;
   ExtraConfigFields           extra_config_file_options;

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   po::options_description common_opts("Options");
   auto                    opt = common_opts.add_options();
   opt("producer,p", po::value<std::string>(&producer)->default_value("")->value_name("name"),
       "Name of this producer");
   opt("key,k", po::value(&keys->provers)->default_value({}, ""),
       "A private key to use for block production");
   opt("host,o", po::value(&hosts)->value_name("name")->default_value({}, ""),
       "Root host name for the http server");
   opt("listen,l", po::value(&listen)->default_value({}, "")->value_name("endpoint"),
       "TCP or local socket endpoint on which the server accepts connections");
   opt("peer", po::value(&peers)->default_value({}, "")->value_name("URL"), "Peer endpoint");
   opt("autoconnect", po::value(&autoconnect)->default_value({}, "")->value_name("num"),
       "Limits the number of peers to be connected automatically");
   opt("service", po::value(&services)->default_value({}, "")->value_name("host:directory"),
       "Serve static content from directory using the specified virtual host name");
   opt("database-template", po::value(&db_template)->default_value("XDefault", ""),
       "Template to install when initializing a new database");
   opt("database-cache-size",
       po::value(&db_cache_size)->default_value({std::size_t(1) << 33}, "8 GiB"),
       "The amount of RAM reserved for the database cache. Must be at least 64 MiB. Warning: "
       "If this is reduced, it may cause a significant delay on startup as the database is "
       "reorganized. This option is subject to change.");
#ifdef PSIBASE_ENABLE_SSL
   opt("tls-trustfile", po::value(&root_ca)->default_value({}, "")->value_name("path"),
       "A list of trusted Certification Authorities in PEM format");
   opt("tls-cert", po::value(&tls_cert)->default_value("")->value_name("path"),
       "The file containing the server's certificate in PEM format");
   opt("tls-key", po::value(&tls_key)->default_value("")->value_name("path"),
       "The file containing the private key corresponding to --tls-cert in PEM format");
#endif
   opt("pkcs11-module",
       po::value(&pkcs11_modules)->composing()->default_value({}, "")->value_name("path"),
       "Path to a PKCS #11 module to load");
   opt("http-timeout", po::value(&http_timeout)->default_value({}, "")->value_name("seconds"),
       "The maximum time for HTTP clients to send or receive a message");
   opt("service-threads", po::value(&service_threads)->default_value(1, "")->value_name("num"),
       "The number of threads that run async actions posted by services");
   desc.add(common_opts);
   opt = desc.add_options();
   // These should be usable on the command line and shown in help
   auto add_cmdonly = [](auto& opts)
   { opts.add_options()("help,h", "Show this message")("version,V", "Print version information"); };
   add_cmdonly(desc);

   // Options that are only allowed in the config file
   po::options_description cfg_opts("psinode");
   cfg_opts.add(common_opts);
   cfg_opts.add_options()("logger.*", po::value<std::string>(), "Log configuration");

   std::optional<std::string_view> database;
   std::vector<std::string>        args;
   if (argc >= 2 && argv[1][0] != '-')
   {
      database = argv[1];
      args     = {argv + 2, argv + argc};
   }
   else
   {
      args = {argv + 1, argv + argc};
   }

   auto parse_args = [&desc, &cfg_opts, &extra_options, &extra_config_file_options, &database](
                         const std::vector<std::string>& args, po::variables_map& vm)
   {
      option_path   = std::filesystem::current_path();
      auto parsed   = po::command_line_parser(args).options(desc).allow_unregistered().run();
      extra_options = po::collect_unrecognized(parsed.options, po::include_positional);
      po::store(parsed, vm);
      if (database)
      {
         auto db_root     = std::filesystem::path(*database);
         option_path      = option_path / db_root;
         auto config_path = db_root / "config";
         if (std::filesystem::is_regular_file(config_path))
         {
            std::ifstream in(config_path);
            auto parsed = psibase::parse_config_file(in, cfg_opts, config_options, config_path);
            extra_config_file_options = extraConfig(parsed.options);
            po::store(parsed, vm);
         }
         else if (!exists(config_path))
         {
            auto template_path = config_template_path();
            if (std::filesystem::is_regular_file(template_path))
            {
               std::ifstream in(template_path);
               auto parsed = psibase::parse_config_file(in, cfg_opts, config_options, config_path);
               extra_config_file_options = extraConfig(parsed.options);
               po::store(parsed, vm);
            }
         }
      }
      else
      {
         throw std::runtime_error("database is required");
      }
      po::notify(vm);
   };

   po::variables_map vm;
   try
   {
      parse_args(args, vm);
   }
   catch (std::exception& e)
   {
      if (!vm.count("help") && !vm.count("version"))
      {
         std::cerr << e.what() << "\n";
         return 1;
      }
   }

   if (vm.count("help"))
   {
      add_cmdonly(common_opts);
      std::cerr << usage << "\n\n";
      std::cerr << common_opts << "\n";
      return 1;
   }

   if (vm.count("version"))
   {
      std::cerr << "psinode " << PSIBASE_VERSION_MAJOR << "." << PSIBASE_VERSION_MINOR << "."
                << PSIBASE_VERSION_PATCH << "\n";
      return 1;
   }

   std::string db_path{*database};

   try
   {
      psibase::loggers::set_path(db_path);
      psibase::loggers::configure(vm);
      RestartInfo restart;
      while (true)
      {
         restart.args.reset();
         run(db_path, db_template, DbConfig{db_cache_size}, AccountNumber{producer}, keys,
             pkcs11_modules, peers, autoconnect, hosts, listen, services, http_timeout,
             service_threads, root_ca, tls_cert, tls_key, extra_options, extra_config_file_options,
             restart);
         if (!restart.args || !restart.args->restart)
         {
            PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Shutdown";
            break;
         }
         else
         {
            // Forward the command line, but remove any arguments that were
            // written to the config file.
            std::vector<std::string> newArgs;
            auto                     original_args =
                po::command_line_parser(args).options(desc).allow_unregistered().run();
            auto keep_opt = [&restart](const auto& opt)
            {
               if (opt.string_key == "key")
                  return !restart.keysChanged;
               else
                  return !restart.configChanged && !opt.unregistered;
            };
            for (const auto& opt : original_args.options)
            {
               if (keep_opt(opt))
               {
                  for (const auto& s : opt.original_tokens)
                  {
                     newArgs.push_back(s);
                  }
               }
            }

            if (restart.args && restart.args->restart)
            {
               newArgs.insert(newArgs.end(), restart.args->restart->begin(),
                              restart.args->restart->end());
            }

            if (restart.args && restart.args->soft)
            {
               PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Soft restart";
               po::variables_map tmp;
               // Reload the config file
               parse_args(newArgs, tmp);
            }
            else
            {
               std::vector<const char*> cArgs;
               cArgs.push_back(argv[0]);
               cArgs.push_back(db_path.c_str());
               for (const std::string& s : newArgs)
                  cArgs.push_back(s.c_str());
               cArgs.push_back(nullptr);
               PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Restart";
               // Cleanup that would normally happen in exit()
               boost::log::core::get()->remove_all_sinks();
               std::fflush(stdout);
               std::fflush(stderr);
               ::execvp(argv[0], const_cast<char**>(cArgs.data()));
               break;
            }
         }
      }
      return 0;
   }
   catch (consensus_failure&)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), critical)
          << "Exiting because of consensus failure";
   }
   catch (std::exception& e)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), error) << e.what();
   }
   return 1;
}
