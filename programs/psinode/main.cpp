#include <psibase/ConfigFile.hpp>
#include <psibase/LogSocket.hpp>
#include <psibase/Mount.hpp>
#include <psibase/OpenSSLProver.hpp>
#include <psibase/PKCS11Prover.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/RunQueue.hpp>
#include <psibase/Secrets.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/UsageMeter.hpp>
#include <psibase/fileUtil.hpp>
#include <psibase/finally.hpp>
#include <psibase/http.hpp>
#include <psibase/log.hpp>
#include <psibase/node.hpp>
#include <psibase/prefix.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/storageDiagnostics.hpp>
#include <psibase/version.hpp>
#include <psio/json.hpp>
#include <psio/json_value.hpp>
#include <psio/untagged.hpp>

#include "psinode.hpp"

#include <boost/algorithm/string/replace.hpp>
#include <boost/log/core/core.hpp>
#include <boost/preprocessor/stringize.hpp>
#include <psibase/VmEngine.hpp>
#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <boost/asio/ssl/host_name_verification.hpp>

#include <charconv>
#ifdef __APPLE__
#include <crt_externs.h>
#endif
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

struct MountArg
{
   std::string hostPath;
   std::string mountPath;
};

void validate(boost::any& v, const std::vector<std::string>& values, MountArg*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   const std::string& s = boost::program_options::validators::get_single_string(values);

   auto pos = s.find(':');
   if (pos == std::string::npos)
      v = MountArg{std::string(s), std::string(s)};
   else
      v = MountArg{s.substr(0, pos), s.substr(pos + 1)};
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

// In JSON a Timeout is its number of microseconds; no timeout is null (or
// the member left out).
std::optional<std::chrono::microseconds> toJson(const Timeout& obj)
{
   if (obj == Timeout::none())
      return std::nullopt;
   return obj.duration;
}

Timeout timeoutFromJson(const std::optional<std::chrono::microseconds>& us)
{
   if (us)
      return Timeout{*us};
   return Timeout::none();
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
#ifdef __APPLE__
   const char* const* environment = *_NSGetEnviron();
#else
   const char* const* environment = ::environ;
#endif
   for (const char* const* iter = environment; *iter; ++iter)
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
         auto                    key = psio::from_ijson<ClaimKey>(s);
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
   // The PKCS #11 token that holds the key; absent or empty: a key file
   std::optional<std::string> device;
};
PSIO_REFLECT(NewKeyRequest, service, rawData, device);

struct UnlockKeyringRequest
{
   // Absent: the empty PIN
   std::optional<std::string> pin;
   std::string                device;
};
PSIO_REFLECT(UnlockKeyringRequest, pin, device);

struct LockKeyringRequest
{
   std::string device;
};
PSIO_REFLECT(LockKeyringRequest, device);

std::vector<char> pkcs11TokenKey(const std::string& uri)
{
   return psio::to_key(std::tuple{std::uint16_t{0}, std::uint8_t{0}, uri});
}

std::vector<char> pkcs11TokenKey(const pkcs11::token_info& token)
{
   return pkcs11TokenKey(pkcs11::makeURI(token));
}

struct UnlockKeyringRow
{
   std::string device;
   std::string pin;
};
PSIO_REFLECT(UnlockKeyringRow, device, pin);

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
   std::optional<uint64_t> database;
   std::string             databaseAttribution = "unavailable";
   uint64_t                code;
   uint64_t                data;
   uint64_t                wasmMemory;
   uint64_t                wasmCode;
   uint64_t                unclassified;
};
PSIO_REFLECT(MemStats,
             database,
             databaseAttribution,
             code,
             data,
             wasmMemory,
             wasmCode,
             unclassified)

struct Perf
{
   std::int64_t                           timestamp;
   std::optional<MemStats>                memory;
   std::optional<std::vector<ThreadInfo>> tasks;
};
PSIO_REFLECT(Perf, timestamp, memory, tasks)

// The I-JSON of a reply body. It is written on an HTTP thread, where
// nothing catches: a value without a JSON text (a string that is not UTF-8,
// such as the label of a PKCS #11 token may be) is answered as null.
template <typename T>
std::vector<char> jsonBody(const T& value)
{
   std::vector<char> json;
   if (!psio::encode_json_checked(psio::ijson{}, value, json).ok())
      json = {'n', 'u', 'l', 'l'};
   return json;
}

// Appends text to a buffer
struct TextWriter
{
   std::vector<char>& out;
   void               write(char ch) { out.push_back(ch); }
   void write(const char* data, std::size_t size) { out.insert(out.end(), data, data + size); }
};

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

// A label value: a quoted string, escaped as a JSON string
void write_om_label(std::string_view value, auto& stream)
{
   auto text = psio::to_ijson(value);
   stream.write(text.data(), text.size());
}

void write_om_mem(std::string_view name, std::int64_t v, auto& stream)
{
   std::string_view prefix = "psinode_memory_bytes{category=";
   stream.write(prefix.data(), prefix.size());
   write_om_label(name, stream);
   stream.write("} ", 2);
   auto value = std::to_string(v);
   stream.write(value.data(), value.size());
   stream.write('\n');
}

void write_om_mem(const Perf& perf, auto& stream)
{
   if (!perf.memory)
      return;
   const auto& memory = *perf.memory;
   write_om_descriptor("psinode_memory_bytes", "gauge", "bytes", "Resident Memory", stream);
   if (memory.database)
      write_om_mem("database", *memory.database, stream);
   write_om_mem("code", memory.code, stream);
   write_om_mem("data", memory.data, stream);
   write_om_mem("wasm_code", memory.wasmCode, stream);
   write_om_mem("wasm_memory", memory.wasmMemory, stream);
   write_om_mem("unclassified", memory.unclassified, stream);
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
   write_om_label(task.group, stream);
   stream.write(",task=", 6);
   write_om_label(std::to_string(task.id), stream);
   stream.write("} ", 2);
   stream.write(value.data(), value.size());
   stream.write('\n');
}

void write_om_tasks(const Perf& perf, auto& stream)
{
   if (!perf.tasks)
      return;
   write_om_descriptor("psinode_cpu_user_seconds", "counter", "seconds", "CPU Time (User)", stream);
   for (const auto& task : *perf.tasks)
   {
      write_om_task_sample("psinode_cpu_user_seconds_total", task, usec_as_sec(task.user), stream);
   }
   write_om_descriptor("psinode_cpu_system_seconds", "counter", "seconds", "CPU Time (System)",
                       stream);
   for (const auto& task : *perf.tasks)
   {
      write_om_task_sample("psinode_cpu_system_seconds_total", task, usec_as_sec(task.system),
                           stream);
   }
   write_om_descriptor("psinode_page_faults", "counter", "", "Page Faults", stream);
   for (const auto& task : *perf.tasks)
   {
      write_om_task_sample("psinode_page_faults_total", task, std::to_string(task.pageFaults),
                           stream);
   }
   write_om_descriptor("psinode_read_bytes", "counter", "bytes", "Bytes Read", stream);
   for (const auto& task : *perf.tasks)
   {
      write_om_task_sample("psinode_read_bytes_total", task, std::to_string(task.read), stream);
   }
   write_om_descriptor("psinode_written_bytes", "counter", "bytes", "Bytes Written", stream);
   for (const auto& task : *perf.tasks)
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

// Usage metering (gofractally/psibase#2270): totals per kind of identity.
// No per-identity labels: their number is not bounded by anything the
// operator controls, and client addresses would leave the node.
void write_om_usage(const std::vector<psibase::UsageMeter::KindTotal>& totals, auto& stream)
{
   if (totals.empty())
      return;
   auto sample = [&](std::string_view name, psibase::UsageKind kind, const std::string& value)
   {
      std::string line{name};
      line += "{kind=\"";
      line += to_string(kind);
      line += "\"} ";
      line += value;
      line += '\n';
      stream.write(line.data(), line.size());
   };
   auto seconds = [](std::uint64_t ns) { return std::to_string(ns) + "e-9"; };
   using C      = psibase::UsageCounters;
   auto counter = [&](std::string_view name, std::string_view unit, std::string_view help,
                      std::uint64_t C::* member, bool time)
   {
      write_om_descriptor(name, "counter", unit, help, stream);
      for (const auto& item : totals)
         sample(std::string(name) + "_total", item.kind,
                time ? seconds(item.total.*member) : std::to_string(item.total.*member));
   };
   write_om_descriptor("psinode_usage_identities", "gauge", "", "Identities with a usage record",
                       stream);
   for (const auto& item : totals)
      sample("psinode_usage_identities", item.kind, std::to_string(item.records));
   counter("psinode_usage_requests", "", "HTTP requests", &C::requests, false);
   counter("psinode_usage_received_bytes", "bytes", "Bytes received", &C::bytesIn, false);
   counter("psinode_usage_sent_bytes", "bytes", "Bytes sent", &C::bytesOut, false);
   counter("psinode_usage_received_messages", "", "Websocket messages received", &C::messagesIn,
           false);
   counter("psinode_usage_sent_messages", "", "Websocket messages sent", &C::messagesOut, false);
   counter("psinode_usage_request_seconds", "seconds", "Wall clock of handling requests",
           &C::requestNs, true);
   counter("psinode_usage_pushed_transactions", "", "Trial runs started", &C::trxPushed, false);
   counter("psinode_usage_trial_seconds", "seconds", "Wall clock of trial runs", &C::trialNs,
           true);
   counter("psinode_usage_compile_seconds", "seconds", "Compile time started by trial runs",
           &C::compileNs, true);
   counter("psinode_usage_verify_seconds", "seconds", "Wall clock of signature checks",
           &C::verifyNs, true);
}

// Writes the usage counters to the node's storage every interval and once
// more when the node stops.
//
// The writing is done on the chain thread, the thread that owns `ctx`,
// which reads and writes the database already: the storage engine has a
// limited number of session slots and metering must not bring a thread of
// its own to the database (gofractally/psibase#2273). The chain thread also
// produces blocks, so it is given as little as possible: the thread here
// keeps time and prepares the rows (no storage), and the chain thread
// writes them one batch of 128 per task, with whatever else it has to do in
// between. Measured (UsageMeterTests "[.bench]"): a batch is well under a
// millisecond; every record of a full table dirty is about 85 batches.
struct UsageFlusher
{
   UsageFlusher(boost::asio::io_context&             ctx,
                psibase::SharedDatabase              db,
                std::shared_ptr<psibase::UsageMeter> meter)
       : ctx(ctx), db(std::move(db)), meter(std::move(meter))
   {
      if (!this->meter->enabled())
         return;
      auto interval =
          std::chrono::seconds(std::max<std::uint64_t>(this->meter->settings().flushSeconds, 1));
      ticker = std::jthread{[this, interval]
                            {
                               std::unique_lock l{mutex};
                               while (!cond.wait_for(l, interval, [this] { return done; }))
                               {
                                  // One flush at a time: a busy chain thread
                                  // is not given a queue of them.
                                  if (writing.exchange(true))
                                     continue;
                                  if (this->meter->prepareFlush())
                                     boost::asio::post(this->ctx, [this] { writeBatch(); });
                                  else
                                     writing = false;
                               }
                            }};
   }
   // Runs on the thread that ran `ctx`, after it has stopped running it and
   // before `ctx` is destroyed.
   ~UsageFlusher()
   {
      {
         std::lock_guard l{mutex};
         done = true;
      }
      cond.notify_one();
      if (ticker.joinable())
         ticker.join();
      if (!meter->enabled())
         return;
      try
      {
         auto writer = db.createWriter();
         // What was prepared and not written, then what was counted since
         meter->writeFlush(db, *writer);
         meter->flush(db, *writer);
      }
      catch (std::exception& e)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), warning)
             << "Usage counters not written: " << e.what();
      }
   }
   // On the chain thread
   void writeBatch()
   {
      try
      {
         auto writer = db.createWriter();
         if (meter->writeFlush(db, *writer, psibase::UsageMeter::batchRows).remaining)
         {
            boost::asio::post(ctx, [this] { writeBatch(); });
            return;
         }
      }
      catch (std::exception& e)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), warning)
             << "Usage counters not written: " << e.what();
      }
      writing = false;
   }
   boost::asio::io_context&             ctx;
   psibase::SharedDatabase              db;
   std::shared_ptr<psibase::UsageMeter> meter;
   std::condition_variable              cond;
   std::mutex                           mutex;
   bool                                 done = false;
   std::atomic<bool>                    writing{false};
   std::jthread                         ticker;
};

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
   std::string    pathname;
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
   while (begin != end && *begin == ' ')
      ++begin;
   const auto pathname = std::string_view(begin, end);
   mapping.pathname    = pathname;
   mapping.anonymous   = pathname == "";
   mapping.special     = pathname.starts_with('[') && pathname.ends_with(']');
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

std::optional<MemStats> getMemStats(const SharedState& state)
{
   RegionInfo regions;
   const auto directory = std::filesystem::weakly_canonical(state.databaseDirectory());
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
      if (!in)
         return std::nullopt;
      result.database            = 0;
      result.databaseAttribution = "file-backed";
      MappingInfo info;
      while (in >> info)
      {
         auto group = regions.get(info.begin, info.end);
         if (group == RegionGroup::unknown &&
             psibase::storage::databaseMapping(info.pathname, directory))
            group = RegionGroup::database;
         switch (group)
         {
            case RegionGroup::database:
               if (result.database)
                  *result.database += info.rss;
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
   result.memory    = getMemStats(state);
   std::error_code                     error;
   std::filesystem::directory_iterator tasks("/proc/self/task", error);
   if (!error)
   {
      result.tasks.emplace();
      for (const auto& entry : tasks)
         result.tasks->push_back(getThreadInfo(entry, clk_tck));
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
   static psibase::storage::durability parseSync(const std::string& sync)
   {
      if (sync == "none")
         return psibase::storage::durability::none;
      if (sync == "flush")
         return psibase::storage::durability::flush;
      if (sync == "full")
         return psibase::storage::durability::full;
      throw std::runtime_error("Unsupported database-sync; expected none, flush, or full");
   }
   DbConfig(const std::string& policy, const std::string& syncName)
       : sync(parseSync(syncName)), syncName(syncName)
   {
      if (policy != "disabled")
         throw std::runtime_error(
             "Unsupported database-cache-policy; this candidate supports only disabled");
   }
   // Compatibility sizing arguments for the tester-era SharedDatabase API.
   // They do not reserve RAM or configure independent psitri storage tiers.
   uint64_t hot_bytes  = 32 * 1024 * 1024;
   uint64_t warm_bytes = 32 * 1024 * 1024;
   uint64_t cool_bytes = 32 * 1024 * 1024;
   uint64_t cold_bytes = 32 * 1024 * 1024;
   psibase::storage::durability sync;
   std::string                  syncName;
};

struct TLSConfig
{
   std::string              certificate;
   std::string              key;
   std::vector<std::string> trustfiles;
};
PSIO_REFLECT(TLSConfig, certificate, key, trustfiles)

// The value of a service-defined option: a string, or a list of strings for
// an option that was given more than once. Its JSON is the bare string or
// the bare array (an untagged variant).
using ExtraConfigField = std::variant<std::string, std::vector<std::string>>;
namespace psio
{
   constexpr bool psio_is_untagged(const ::ExtraConfigField*)
   {
      return true;
   }
}  // namespace psio

using ExtraConfigFields = std::map<std::string, ExtraConfigField>;

ExtraConfigFields extraConfig(const std::vector<boost::program_options::option>& opts)
{
   ExtraConfigFields result;
   for (const auto& option : opts)
   {
      if (!option.unregistered || option.value.empty())
         continue;
      std::string_view prefix{"service."};
      std::string_view key{option.string_key};
      if (key.starts_with(prefix))
         key.remove_prefix(prefix.size());
      auto [pos, inserted] = result.try_emplace(std::string(key), option.value);
      if (!inserted)
      {
         auto& value = std::get<std::vector<std::string>>(pos->second);
         value.insert(value.end(), option.value.begin(), option.value.end());
      }
   }
   return result;
}

struct PsinodeServiceConfig
{
   // The command line arguments that psinode did not recognize. A
   // configuration written through x-admin does not carry them.
   std::optional<std::vector<std::string>> argv;
   ExtraConfigFields                       config;
   PSIO_REFLECT(PsinodeServiceConfig, argv, config)
};

struct PsinodeConfig
{
   AccountNumber            producer;
   std::vector<std::string> pkcs11_modules;
   std::vector<listen_spec> listen;
   TLSConfig                tls;
   Timeout                  http_timeout;
   std::uint64_t            service_threads;
   psibase::loggers::Config loggers;

   static bool isNative(std::string_view name)
   {
      constexpr std::string_view opts[] = {
          "producer", "pkcs11-modules",        "listen",       "tls-key",
          "tls-cert", "tls-trustfile",         "http-timeout", "service-threads",
          "key",      "database-cache-policy", "mount",        "passphrase-file",
          "database-sync"};
      return std::ranges::find(opts, name) != std::end(opts) || name.starts_with("logger.") ||
             name.starts_with("service.");
   }
};
// The JSON of a PsinodeConfig: the "host" member of the configuration
// document in HostConfigRow::config.
struct PsinodeConfigJson
{
   AccountNumber                            producer;
   std::vector<std::string>                 pkcs11_modules;
   std::vector<http::any_listen_spec>       listen;
   TLSConfig                                tls;
   std::optional<std::chrono::microseconds> http_timeout;
   std::uint64_t                            service_threads;
   psio::json_value                         loggers;
};
PSIO_REFLECT(PsinodeConfigJson,
             producer,
             pkcs11_modules,
             listen,
#ifdef PSIBASE_ENABLE_SSL
             tls,
#endif
             http_timeout,
             service_threads,
             loggers);

PsinodeConfigJson toJson(const PsinodeConfig& config)
{
   PsinodeConfigJson result{
       .producer        = config.producer,
       .pkcs11_modules  = config.pkcs11_modules,
       .tls             = config.tls,
       .http_timeout    = toJson(config.http_timeout),
       .service_threads = config.service_threads,
       .loggers         = config.loggers.toJson(),
   };
   for (const auto& l : config.listen)
      result.listen.push_back(http::to_any_listen_spec(l));
   return result;
}

// Throws std::runtime_error for a listen entry or a logger configuration
// that is not valid.
PsinodeConfig fromJson(PsinodeConfigJson&& config)
{
   PsinodeConfig result{
       .producer        = config.producer,
       .pkcs11_modules  = std::move(config.pkcs11_modules),
       .tls             = std::move(config.tls),
       .http_timeout    = timeoutFromJson(config.http_timeout),
       .service_threads = config.service_threads,
       .loggers         = psibase::loggers::Config::fromJson(config.loggers),
   };
   for (const auto& l : config.listen)
      result.listen.push_back(http::from_any_listen_spec(l));
   return result;
}

void to_config(const PsinodeConfig& config, ConfigFile& file)
{
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
   if (config.http_timeout != Timeout::none())
   {
      file.set("", "http-timeout", to_string(config.http_timeout),
               "The maximum time for HTTP clients to send or receive a message");
   }
   file.set("", "service-threads", std::to_string(config.service_threads),
            "The number of threads that run async actions posted by services");

   // TODO: Not implemented yet.  Sign needs some thought,
   // because it's probably a bad idea to reveal the
   // private keys.
   file.keep("", "key");
   file.keep("", "database-cache-policy");
   file.keep("", "database-sync");
   file.keep("", "mount");
   file.keep("", "passphrase-file");
   //
   to_config(config.loggers, file);
}

struct PsinodeCombinedConfig
{
   PsinodeConfig        host;
   PsinodeServiceConfig service;
};

// The configuration document in HostConfigRow::config:
// {"host": PsinodeConfigJson, "service": PsinodeServiceConfig}
struct PsinodeCombinedConfigJson
{
   PsinodeConfigJson    host;
   PsinodeServiceConfig service;
   PSIO_REFLECT(PsinodeCombinedConfigJson, host, service)
};

// Reads the configuration document. Throws std::runtime_error with the
// reason when `text` is not one.
PsinodeCombinedConfig parseCombinedConfig(std::string_view text)
{
   PsinodeCombinedConfigJson json;
   if (auto status = psio::decode_json_checked(
           psio::ijson{}, std::span<const char>{text.data(), text.size()}, json);
       !status.ok())
      throw std::runtime_error("host config: " + std::string(status.error().what));
   return {.host = fromJson(std::move(json.host)), .service = std::move(json.service)};
}

void to_config(const PsinodeCombinedConfig& config, ConfigFile& file)
{
   to_config(config.host, file);
   for (const auto& [key, value] : config.service.config)
   {
      std::string_view section = PsinodeConfig::isNative(key) ? "service" : "";
      if (auto* s = std::get_if<std::string>(&value))
         file.set(section, key, *s, "Service defined option");
      else if (auto* v = std::get_if<std::vector<std::string>>(&value))
         file.set(
             section, key, *v, [](std::string_view text) { return std::string(text); },
             "Service defined option");
   }
}

HostConfigRow toHostConfig(const PsinodeConfig& config, const PsinodeServiceConfig& extra)
{
   HostConfigRow result{
       .hostVersion = "psinode-" PSIBASE_VERSION_STRING,
   };
   result.config = psio::to_ijson(PsinodeCombinedConfigJson{toJson(config), extra});
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
         std::string_view                passphrase,
         std::vector<std::string>&       pkcs11_modules,
         std::vector<listen_spec>        listen,
         std::vector<MountArg>&          mountpoints,
         Timeout&                        http_timeout,
         std::size_t&                    service_threads,
         std::uint64_t                   proof_timeout_ms,
         std::vector<std::string>        root_ca,
         std::string                     tls_cert,
         std::string                     tls_key,
         const PsinodeServiceConfig&     extra_options,
         const psibase::UsageSettings&   usage_settings,
         RestartInfo&                    runResult)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   SharedDatabase database{
       db_path,
       {db_conf.hot_bytes, db_conf.warm_bytes, db_conf.cool_bytes, db_conf.cold_bytes,
        db_conf.sync},
       psibase::storage::open_mode::resize};
   // Compiled modules are kept under a root of the node's database that is
   // no part of the chain (PsizamPolicy.hpp).
   WasmCache wasmCache{128, psibase::nodeNativeAotCache(database.cacheRoot())};
   // What this run compiled and what it found compiled. Declared before the
   // node's state, so it is reported after everything that executes has gone.
   auto reportModules = psibase::finally{
       [wasmCache]
       {
          auto stats = wasmCache.stats();
          PSIBASE_LOG(psibase::loggers::generic::get(), info)
              << "Service modules: " << stats.compiled << " compiled, " << stats.loaded
              << " loaded from the cache, " << stats.discarded << " cache entries discarded, "
              << stats.compilesAbandoned << " compiles abandoned, " << stats.compilesNotRetried
              << " speculative runs not compiled for";
       }};
   auto sharedState = std::make_shared<psibase::SharedState>(std::move(database), wasmCache);
   auto system      = sharedState->getSystemContext();
   auto proofSystem = sharedState->getSystemContext();

   // Usage metering: continue from the stored counters and tell the
   // reporting service how the meter is configured.
   auto usageMeter = sharedState->usage();
   usageMeter->configure(usage_settings);
   {
      auto writer = system->sharedDatabase.createWriter();
      usageMeter->load(system->sharedDatabase, *writer);
      usageMeter->publishSettings(system->sharedDatabase, *writer);
   }

   PSIBASE_LOG(psibase::loggers::generic::get(), info)
       << "Storage engine=psitri.big sync=" << db_conf.syncName
       << " read-cache=false pinned-cache-MiB=0 "
          "cache-policy=disabled (performance qualification pending)";

   Secrets secrets{std::filesystem::path(db_path) / "secrets", passphrase};

   const auto storagePressure = system->sharedDatabase.isSlow();
   if (!storagePressure)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), info)
          << "Storage pressure diagnostics are unavailable for the generic psitri engine";
   }
   else if (*storagePressure)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), warning)
          << "unable to lock memory for " << db_path
          << ". Try upgrading your shell's limits using \"sudo prlimit --memlock=-1 --pid "
             "$$\". "
             "If that doesn't work, try running psinode with \"sudo\".";
   }

   {
      for (const auto& [hostpath, mountpath] : mountpoints)
      {
         PSIBASE_LOG(psibase::loggers::generic::get(), info)
             << "Mounting " << hostpath << " at " << mountpath;
         system->mountpoints->mount(hostpath, mountpath);
      }
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
      auto writer = system->sharedDatabase.createWriter();
      system->sockets->set(*writer, SocketRow::log, makeLogSocket());

      Database           db{system->sharedDatabase, system->sharedDatabase.emptyRevision()};
      SocketAutoCloseSet autoClose;
      auto               session = db.startWrite(std::move(writer));
      db.checkoutSubjective();
      load_environment(db);
      HostConfigRow hostConfig = toHostConfig(
          PsinodeConfig{
              .producer       = producer,
              .pkcs11_modules = pkcs11_modules,
              .listen         = listen,
#ifdef PSIBASE_ENABLE_SSL
              .tls =
                  {
                      .certificate = tls_cert,
                      .key         = tls_key,
                      .trustfiles  = root_ca,
                  },
#endif
              .http_timeout    = http_timeout,
              .service_threads = service_threads,
              .loggers         = loggers::Config::get(),
          },
          extra_options);
      db.kvPut(hostConfig.db, hostConfig.key(), hostConfig);
      if (!db.commitSubjective(*system->sockets, autoClose))
      {
         throw std::runtime_error("Failed to initialize database");
      }
   }
   // If this is a new database, initialize subjective services
   initialize_database(*system, db_template);

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

   // Unlock cryptographic devices that we have known keys for
   for (auto& [k, v] : pkcs11Libs)
   {
      auto& [lib, sessions] = v;
      for (auto slot : lib->GetSlotList(true))
      {
         auto key = pkcs11TokenKey(lib->GetTokenInfo(slot));
         if (auto row = secrets.get(key))
         {
            psibase::check(psio::validate_pssz<UnlockKeyringRow>(*row).ok(),
                           "UnlockKeyringRow has invalid format");
            auto pin = psio::pssz_view<UnlockKeyringRow>(*row).pin();

            auto pos = sessions.try_emplace(slot, lib, slot).first;
            pos->second->Login(std::string_view{pin.data(), pin.size()});
            loadSessionKeys(pos->second);
         }
      }
   }

   // http_config must live until server shutdown which happens when chainContext
   // is destroyed.
   auto http_config = std::make_shared<http::http_config>();

   RunQueue                runQueue{sharedState, std::chrono::milliseconds(proof_timeout_ms)};
   boost::asio::io_context chainContext;

   // Usage metering: write the counters as the node runs, on this thread.
   // Declared after chainContext so that it stops, and writes once more,
   // before chainContext goes.
   UsageFlusher usageFlusher{chainContext, system->sharedDatabase, usageMeter};

   auto shutdown_sockets = psibase::finally{[&system] { system->sockets->shutdown(); }};

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
   // A transaction the producer deferred because its code was being
   // compiled is offered again as soon as the compiles have finished.
   // Cleared before the node goes: compile threads outlive it.
   wasmCache.onCompilesFinished(
       [&chainContext, &node]
       { boost::asio::post(chainContext, [&node] { node.retry_deferred_transactions(); }); });
   auto clearCompilesFinished = psibase::finally{[&wasmCache] { wasmCache.onCompilesFinished({}); }};
   node.chain().setProofWatchdogLimit(std::chrono::milliseconds(proof_timeout_ms));
   node.set_producer_id(producer);
   node.load_producers();

   // The callback is *not* posted to chainContext. It can run concurrently.
   node.chain().onChangeRunQueue([&] { runQueue.notify(); });

   // This needs to be declared so the host config change handler can reference it,
   // but we can't safely start any threads until after all the node state
   // is initialized.
   WasmThreadPool tpool{runQueue, 0};

   ShutdownTimer shutdownTimer;

   // Used for outgoing connections
   boost::asio::ip::tcp::resolver resolver(chainContext);

   node.chain().onValidateHostConfig(
       [](std::span<const char> value)
       {
          psibase::check(psio::validate_pssz<HostConfigRow>(value).ok(),
                         "HostConfigRow has invalid format");
          auto view = psio::pssz_view<HostConfigRow>(value);
          // The document the change handler reads: the write is refused
          // (the exception reaches the writer) when it is not one.
          parseCombinedConfig(view.config().unpack());
       });
   node.chain().onChangeHostConfig(
       [&chainContext, &node, &db_path, &runResult, &http_config, &http_timeout, &service_threads,
        &tpool, &tls_cert, &tls_key, &root_ca, &pkcs11_modules, &system, setPKCS11Libs]
       {
          boost::asio::post(
              chainContext,
              [&chainContext, &node, &db_path, &runResult, &http_config, &http_timeout,
               &service_threads, &tpool, &tls_cert, &tls_key, &root_ca, &pkcs11_modules, &system,
               setPKCS11Libs]
              {
                 auto writer = system->sharedDatabase.createWriter();
                 auto row = system->sharedDatabase.kvGetSubjective(*writer, HostConfigRow::db,
                                                                   psio::to_key(hostConfigKey()));
                 auto hostConfig = psio::from_pssz<HostConfigRow>(row.value());
                 auto  combinedConfig = parseCombinedConfig(hostConfig.config);
                 auto& config = combinedConfig.host;

                 setPKCS11Libs(config.pkcs11_modules);
                 node.set_producer_id(config.producer);
                 pkcs11_modules  = config.pkcs11_modules;
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
                    http_config->listen          = config.listen;
                    http_config->idle_timeout_us = http_timeout.duration.count();
                 }
                 tpool.setNumThreads(service_threads);
                 {
                    auto       path = std::filesystem::path(db_path) / "config";
                    ConfigFile file{config_options};
                    {
                       std::ifstream in(path);
                       file.parse(in);
                    }
                    to_config(combinedConfig, file);
                    {
                       std::ofstream out(path);
                       file.write(out);
                    }
                    runResult.configChanged = true;
                 }
              });
       });

   node.chain().onChangeShutdown(
       [&chainContext, &node, &system, &http_config, &shutdownTimer, &runResult, &server_work]
       {
          boost::asio::post(
              chainContext,
              [&chainContext, &node, &system, &http_config, &shutdownTimer, &runResult,
               &server_work]
              {
                 auto writer = system->sharedDatabase.createWriter();
                 auto row    = system->sharedDatabase.kvGetSubjective(
                     *writer, PendingShutdownRow::db, psio::to_key(pendingShutdownKey()));
                 if (!row)
                    return;
                 auto         shutdown = psio::from_pssz<PendingShutdownRow>(row.value());
                 ShutdownArgs args;
                 if (auto status = psio::decode_json_checked(
                         psio::ijson{}, std::span<const char>{shutdown.args}, args);
                     !status.ok())
                 {
                    PSIBASE_LOG(psibase::loggers::generic::get(), error)
                        << "Ignoring shutdown request with invalid arguments: "
                        << status.error().what;
                    return;
                 }
                 runResult.args = std::move(args);

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
                 // No speculative run is worth waiting for any more: the
                 // compiles they started are stopped, so that neither a run
                 // waiting for one nor its compile thread holds up the exit.
                 system->wasmCache.abandonSpeculativeCompiles();
              });
       });

   auto stop_threads =
       psibase::finally{[&chainContext, &tpool]
                     {
                        tpool.setNumThreads(0);
                        auto& ectx = static_cast<boost::asio::execution_context&>(chainContext);
                        if (boost::asio::has_service<http::server_service>(ectx))
                           boost::asio::use_service<http::server_service>(ectx).stop();
                     }};

   if (!listen.empty())
   {
      // TODO: command-line options
      http_config->num_threads      = 4;
      http_config->max_request_size = 20 * 1024 * 1024;
      http_config->idle_timeout_us  = http_timeout.duration.count();
      http_config->listen           = listen;
      http_config->status           = http::http_status{
          .slow = system->sharedDatabase.isSlow(), .startup = 1, .needgenesis = 1};

      http_config->push_boot_async =
          [&chainContext, &node](std::vector<char>               packed_signed_transactions,
                                 http::push_transaction_callback callback)
      {
         boost::asio::post(chainContext,
                           [&node, callback = std::move(callback),
                            transactions = psio::from_pssz<std::vector<SignedTransaction>>(
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

      http_config->get_perf = [sharedState](auto callback)
      { callback([result = get_perf(*sharedState)]() mutable { return jsonBody(result); }); };

      http_config->get_metrics = [sharedState](auto callback)
      {
         callback(
             [result = get_perf(*sharedState),
              usage  = sharedState->usage()->totals()]() mutable
             {
                std::vector<char> data;
                TextWriter        stream{data};
                write_om_mem(result, stream);
                write_om_tasks(result, stream);
                write_om_usage(usage, stream);
                stream.write("# EOF\n", 6);
                return data;
             });
      };

      http_config->get_keys = [&chainContext, &prover](auto callback)
      {
         boost::asio::post(chainContext,
                           [&prover, callback = std::move(callback)]()
                           {
                              std::vector<Claim> result;
                              prover->get(result);
                              callback([result = std::move(result)]() mutable
                                       { return jsonBody(result); });
                           });
      };

      http_config->new_key = [&chainContext, &node, &prover, &db_path, &runResult, getPKCS11Slot](
                                 std::vector<char> json, auto callback)
      {
         NewKeyRequest key;
         if (auto status = psio::decode_json_checked(psio::ijson{}, json, key); !status.ok())
            return callback(std::string(status.error().what));
         if (key.service.str() != "verify-sig")
            return callback("Not implemented for native signing: " + key.service.str());
         boost::asio::post(
             chainContext,
             [&node, &prover, &db_path, &runResult, getPKCS11Slot, callback = std::move(callback),
              key = std::move(key)]() mutable
             {
                try
                {
                   std::shared_ptr<Prover> result;
                   bool                    storeConfig = true;
                   if (key.device && !key.device->empty())
                   {
                      auto [lib, slot, sessions] = getPKCS11Slot(*key.device);
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
                         stringKeys.push_back(psio::to_ijson(k));
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
                   callback([result = std::move(claim)]() mutable { return jsonBody(result); });
                }
                catch (std::exception& e)
                {
                   callback(e.what());
                }
             });
      };

      http_config->unlock_keyring = [&chainContext, &node, loadSessionKeys, getPKCS11Slot,
                                     &secrets](std::vector<char> json, auto callback)
      {
         UnlockKeyringRequest pin;
         if (auto status = psio::decode_json_checked(psio::ijson{}, json, pin); !status.ok())
            return callback(std::string(status.error().what));
         boost::asio::post(chainContext,
                           [&node, getPKCS11Slot, &secrets, loadSessionKeys,
                            callback = std::move(callback), pin = std::move(pin)]() mutable
                           {
                              try
                              {
                                 auto [lib, slot, sessions] = getPKCS11Slot(pin.device);
                                 auto pos = sessions->try_emplace(slot, lib, slot).first;
                                 auto userPin = std::move(pin.pin).value_or(std::string());
                                 pos->second->Login(userPin);
                                 loadSessionKeys(pos->second);
                                 node.on_key_update();
                                 UnlockKeyringRow row{
                                     .device = pkcs11::makeURI(lib->GetTokenInfo(slot)),
                                     .pin    = std::move(userPin)};
                                 secrets.put(pkcs11TokenKey(row.device), psio::to_pssz(row));
                                 callback(std::nullopt);
                              }
                              catch (std::exception& e)
                              {
                                 callback(e.what());
                              }
                           });
      };

      http_config->lock_keyring =
          [&chainContext, getPKCS11Slot, &secrets](std::vector<char> json, auto callback)
      {
         LockKeyringRequest id;
         if (auto status = psio::decode_json_checked(psio::ijson{}, json, id); !status.ok())
            return callback(std::string(status.error().what));
         boost::asio::post(
             chainContext,
             [getPKCS11Slot, &secrets, callback = std::move(callback), id = std::move(id)]() mutable
             {
                try
                {
                   auto [lib, slot, sessions] = getPKCS11Slot(id.device);
                   auto pos                   = sessions->find(slot);
                   check(pos != sessions->end(), "Not logged in");
                   pos->second->Logout();
                   pos->second.clear();
                   secrets.remove(pkcs11TokenKey(lib->GetTokenInfo(slot)));
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
                                 callback([result = std::move(result)]() mutable
                                          { return jsonBody(result); });
                              }
                              catch (std::exception& e)
                              {
                                 callback(e.what());
                              }
                           });
      };

      auto& service =
          boost::asio::make_service<http::server_service>(chainContext, http_config, sharedState);
      node.chain().onSocketOpen(service.get_connector());
      node.chain().onSocketP2P(
          [&node, &chainContext](const std::shared_ptr<psibase::net::connection_base>& conn)
          { boost::asio::post(chainContext, [&node, conn] { node.add_connection(conn); }); });

      // startSession should run after all callbacks are set up
      // so that it can safely call anything, but before any other
      // threads are started, so that it is guaranteed to happen
      // before http requests or queued actions.
      {
         Action act{.service = proxyServiceNum,
                    .method  = MethodNumber{"startSession"},
                    .rawData = psio::to_pssz(std::tuple())};

         BlockContext bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};

         bc.execAsyncAction(std::move(act));
      }

      // This starts threads that can run wasm, so it isn't safe to run
      // until after all the node.chain().onXXX callbacks are set up.
      service.start();
   }
   else
   {
      PSIBASE_LOG(loggers::generic::get(), notice)
          << "The server is not configured to accept connections on any interface. Use --listen "
             "<port> to add a listener.";
      boost::asio::post(chainContext, [&server_work] { server_work.reset(); });
   }

   tpool.setNumThreads(service_threads);

   node.set_producer_id(producer);
   {
      atomic_set_field(http_config->status, [](auto& status) { status.startup = false; });
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

   std::string              db_template;
   std::string              producer = {};
   auto                     keys     = std::make_shared<CompoundProver>();
   std::string              passphrase;
   std::vector<std::string> pkcs11_modules;
   std::vector<listen_spec> listen;
   std::vector<MountArg>    mountpoints;
   std::vector<std::string> root_ca;
   std::string              tls_cert;
   std::string              tls_key;
   std::string              db_cache_policy;
   std::string              db_sync;
   byte_size                db_size;
   Timeout                  http_timeout;
   std::size_t              service_threads;
   psibase::UsageSettings   usage_settings;
   std::vector<std::string> usage_trusted_proxies;
   std::uint64_t            proof_timeout_ms;
   PsinodeServiceConfig     extra_options;

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   po::options_description common_opts("Options");
   auto                    opt = common_opts.add_options();
   opt("proof-timeout-ms",
       po::value(&proof_timeout_ms)
           ->default_value(200)
           ->notifier(
               [](std::uint64_t value)
               {
                  if (value == 0 || value > 60000)
                     throw std::runtime_error("proof-timeout-ms must be between 1 and 60000");
               }),
       "Maximum proof-admission CPU time in milliseconds (default 200; independent of objective "
       "block CPU)");
   opt("producer,p", po::value<std::string>(&producer)->default_value("")->value_name("name"),
       "Name of this producer");
   opt("key,k", po::value(&keys->provers)->default_value({}, ""),
       "A private key to use for block production");
   opt("passphrase-file",
       po::value<std::string>()->default_value("")->notifier(
           [&](const std::string& filename)
           {
              if (filename != "")
              {
                 auto                       contents = readWholeFile(filename);
                 constexpr std::string_view nl_chars{"\r\n"};
                 while (!contents.empty() && nl_chars.contains(contents.back()))
                    contents.pop_back();
                 passphrase = std::string(contents.data(), contents.size());
              }
              else
              {
                 if (const char* var = std::getenv("PSIBASE_PASSPHRASE"))
                 {
                    passphrase = var;
                 }
                 else
                 {
                    passphrase = "";
                 }
              }
           }),
       "A file containing a passphrase used to encrypt secrets");
   opt("listen,l", po::value(&listen)->default_value({}, "")->value_name("endpoint"),
       "TCP or local socket endpoint on which the server accepts connections");
   opt("mount",
       po::value(&mountpoints)
           ->composing()
           ->default_value({}, "")
           ->value_name("hostpath[:mountpath]"),
       "Makes files available to services");
   opt("database-template", po::value(&db_template)->default_value("XDefault", ""),
       "Template to install when initializing a new database");
   opt("database-cache-policy",
       po::value(&db_cache_policy)
           ->default_value("disabled")
           ->notifier(
               [](const std::string& policy)
               {
                  if (policy != "disabled")
                     throw std::runtime_error(
                         "Unsupported database-cache-policy; this candidate supports only "
                         "disabled");
               }),
       "Generic psitri cache policy. This candidate supports disabled: read promotion off, "
       "pinned-cache budget 0 MiB. Performance qualification is pending.");
   opt("database-sync",
       po::value(&db_sync)->default_value("none")->notifier(
           [](const std::string& sync) { DbConfig::parseSync(sync); }),
       "What a block's state publication waits for. none: never flush; state survives a "
       "process crash but not a power loss or kernel crash, which is recovered from peers. "
       "flush: fsync every publication and rebuild from flushed state after a power loss. "
       "full: also flush the drive cache.");
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
   // Usage metering (gofractally/psibase#2270). Read when the node starts.
   opt("usage-metering", po::value(&usage_settings.enabled)->default_value(true, "on"),
       "Record how much each connection identity (account, client address, peer) uses of this "
       "node. Node-local; nothing is refused");
   opt("usage-trusted-proxy",
       po::value(&usage_trusted_proxies)->composing()->default_value({}, "")->value_name("prefix"),
       "An address or prefix (10.0.0.0/8) of a reverse proxy whose Forwarded and "
       "X-Forwarded-For headers name the client. Loopback and unix sockets are always trusted; "
       "from anyone else the headers are ignored");
   opt("usage-max-records",
       po::value(&usage_settings.maxRecords)->default_value(4096, "4096")->value_name("num"),
       "The most identities of one kind that have a usage record. When a kind is full the "
       "records that would expire soonest are folded into its overflow record");
   opt("usage-retention-base",
       po::value(&usage_settings.retention.base)->default_value(3600, "3600")->value_name("seconds"),
       "How long a usage record that used nothing is kept after it was last seen");
   opt("usage-retention-per-unit",
       po::value(&usage_settings.retention.perUnit)->default_value(60, "60")->value_name("seconds"),
       "How much longer a usage record is kept for each unit it used (a request, a websocket "
       "message, a pushed transaction, a millisecond of node time, 64 KiB transferred)");
   opt("usage-retention-max",
       po::value(&usage_settings.retention.max)
           ->default_value(30 * 24 * 3600, "2592000")
           ->value_name("seconds"),
       "The longest a usage record is kept after it was last seen");
   opt("usage-window",
       po::value(&usage_settings.windowSeconds)->default_value(3600, "3600")->value_name("seconds"),
       "The length of the window that recent use is reported for");
   opt("usage-flush-interval",
       po::value(&usage_settings.flushSeconds)->default_value(10, "10")->value_name("seconds"),
       "How often the usage counters are written to the node's storage");
   desc.add(common_opts);
   opt = desc.add_options();
   // These should be usable on the command line and shown in help
   auto add_cmdonly = [](auto& opts)
   { opts.add_options()("help,h", "Show this message")("version,V", "Print version information"); };
   add_cmdonly(desc);
   po::options_description engine_opts("Execution engine");
   {
      std::string engines;
      for (auto* engine : psibase::vm::engines())
         engines += (engines.empty() ? "" : ", ") + std::string(engine->name);
      // A property of this node, not of the chain: every engine computes the
      // same results, so it is not something a config file should pin.
      engine_opts.add_options()(
          "vm-engine",
          po::value<std::string>()->value_name("name")->notifier(
              [](const std::string& name) { psibase::vm::select(name); }),
          ("Execution engine for services. This build has: " + engines +
           ". Default: the first, or PSIBASE_VM_ENGINE")
              .c_str());
      // Also of this node only: a node that debugs computes what the others
      // compute, so one node of a live network can debug while the rest do not.
      engine_opts.add_options()(
          "debug-services",
          po::bool_switch()->notifier(
              [](bool enabled)
              {
                 // Absent, the option leaves PSIBASE_DEBUG_SERVICES in charge.
                 if (enabled)
                    psibase::vm::setServiceDebugging(true);
              }),
          "Run services with debugging support: log where in a service a failed call was, and "
          "register compiled services with an attached debugger (gdb, lldb). Slower. Needs the "
          "wasmtime engine. Default: off, or PSIBASE_DEBUG_SERVICES");
   }
   desc.add(engine_opts);

   // Options that are only allowed in the config file
   po::options_description cfg_opts("psinode");
   cfg_opts.add(common_opts);
   cfg_opts.add_options()("logger.*", po::value<std::string>(), "Log configuration");
   // Parse removed controls only to give existing configuration files a useful
   // migration error. They are not advertised as functioning psitri settings.
   po::options_description legacy_opts;
   legacy_opts.add_options()("database-cache-size",
                             po::value<std::string>()->notifier(
                                 [](const std::string&)
                                 {
                                    throw std::runtime_error(
                                        "database-cache-size is a removed control; "
                                        "replace it with database-cache-policy=disabled (psitri "
                                        "read promotion off, pinned-cache budget 0 MiB)");
                                 }));
   desc.add(legacy_opts);
   cfg_opts.add(legacy_opts);

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

   auto parse_args = [&desc, &cfg_opts, &extra_options, &database, &usage_settings,
                      &usage_trusted_proxies](
                         const std::vector<std::string>& args, po::variables_map& vm)
   {
      option_path        = std::filesystem::current_path();
      auto parsed        = po::command_line_parser(args).options(desc).allow_unregistered().run();
      extra_options.argv = po::collect_unrecognized(parsed.options, po::include_positional);
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
            extra_options.config = extraConfig(parsed.options);
            po::store(parsed, vm);
         }
         else if (!exists(config_path))
         {
            auto template_path = config_template_path();
            if (std::filesystem::is_regular_file(template_path))
            {
               std::ifstream in(template_path);
               auto parsed = psibase::parse_config_file(in, cfg_opts, config_options, config_path);
               extra_options.config = extraConfig(parsed.options);
               po::store(parsed, vm);
            }
         }
      }
      else
      {
         throw std::runtime_error("database is required");
      }
      po::notify(vm);
      usage_settings.trustedProxies.clear();
      for (const auto& text : usage_trusted_proxies)
      {
         if (auto prefix = psibase::parseIPAddressPrefix(text))
            usage_settings.trustedProxies.push_back(std::move(*prefix));
         else
            throw std::runtime_error("usage-trusted-proxy: not an address prefix: " + text);
      }
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
      std::cerr << common_opts << "\n" << engine_opts << "\n";
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
         run(db_path, db_template, DbConfig{db_cache_policy, db_sync}, AccountNumber{producer}, keys,
             passphrase, pkcs11_modules, listen, mountpoints, http_timeout, service_threads,
             proof_timeout_ms, root_ca, tls_cert, tls_key, extra_options, usage_settings,
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
