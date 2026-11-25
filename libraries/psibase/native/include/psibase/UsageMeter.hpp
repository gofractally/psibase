#pragma once

// The node's usage meter (gofractally/psibase#2270): how much each identity
// used of this node. Phase 1 measures and reports; nothing is refused.
//
// Nothing here is consensus. The counters live in memory; a single thread
// writes them every few seconds to a native table of the node's own
// (subjective) storage, and loads them again when the node starts.
//
// Cost on the paths that already exist:
//  - find(): one hash lookup under the meter's own mutex, once per request
//    or per run. The mutex is shared with nothing else.
//  - UsageRecord::add(): one relaxed atomic add.
//  - No database access and no wasm call outside flush().
//
// See psibase/usage.hpp for identities, counters and the retention rule.

#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/usage.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace psibase
{
   // The live record of one identity. Measuring points hold a
   // shared_ptr to it and add to its counters; everything else in it
   // belongs to the meter.
   struct UsageRecord
   {
      explicit UsageRecord(UsageIdentity identity) : identity(std::move(identity)) {}
      UsageRecord(const UsageRecord&)            = delete;
      UsageRecord& operator=(const UsageRecord&) = delete;

      const UsageIdentity identity;

      void add(UsageField field, std::uint64_t n) noexcept
      {
         counters[static_cast<std::size_t>(field)].fetch_add(n, std::memory_order_relaxed);
      }
      void add(UsageField field, std::chrono::nanoseconds time) noexcept
      {
         if (time.count() > 0)
            add(field, static_cast<std::uint64_t>(time.count()));
      }
      UsageCounters snapshot() const noexcept;

      // True once the meter no longer lists this record (it expired or was
      // evicted). Counts added to it afterwards are not lost, they go to
      // the aggregate it was folded into; but a holder that can look its
      // identity up again should.
      bool detached() const noexcept { return detachedFlag.load(std::memory_order_relaxed); }

     private:
      friend class UsageMeter;
      std::array<std::atomic<std::uint64_t>, numUsageFields> counters{};
      std::atomic<bool>                                      detachedFlag{false};

      // Owned by the meter (flushMutex)
      std::uint64_t firstSeen = 0;
      std::uint64_t lastSeen  = 0;
      std::uint64_t window    = 0;
      UsageCounters flushed;   // the totals at the last flush
      UsageCounters current;
      UsageCounters previous;
      bool          dirty = true;
      // Where this record's later counts go once it is detached
      std::shared_ptr<UsageRecord> foldInto;
   };
   using UsageHandle = std::shared_ptr<UsageRecord>;

   struct UsageSettings
   {
      // usage-metering. When off, find() returns null and every measuring
      // point does nothing.
      bool enabled = true;
      // usage-max-records: the hard bound on live records, per kind. The
      // anonymous tier is unauthenticated, so the table must not grow with
      // the number of addresses someone can use.
      std::size_t maxRecords = 4096;
      // usage-window: the length of the "recent use" windows.
      std::uint64_t windowSeconds = 3600;
      // usage-flush-interval: used by whoever calls flush(); published.
      std::uint64_t flushSeconds = 10;
      // usage-retention-base, usage-retention-per-unit, usage-retention-max
      UsageRetention retention;
      // usage-trusted-proxy
      std::vector<IPAddressPrefix> trustedProxies;
   };

   class UsageMeter
   {
     public:
      explicit UsageMeter(UsageSettings settings = {});
      // Replaces the settings. Only before the meter is used (the node
      // applies its configuration to the meter its shared state created).
      void configure(UsageSettings settings) { settings_ = std::move(settings); }

      bool                 enabled() const { return settings_.enabled; }
      const UsageSettings& settings() const { return settings_; }

      // The record to charge for this identity; null if metering is off.
      // If the identity's kind already has maxRecords records, the result is
      // that kind's overflow record until a flush has made room. An invalid
      // identity is charged to `local:unknown`.
      UsageHandle find(const UsageIdentity& identity);
      // find(), keeping `cached` if it is still the live record of `identity`.
      UsageHandle find(const UsageIdentity& identity, const UsageHandle& cached);
      // Work that no connection caused.
      UsageHandle node() { return find(UsageIdentity::local("node")); }

      // The identity that posted a run, remembered in memory from the write
      // of its row until the row is removed. At most maxRunOrigins are
      // remembered; beyond that the oldest is forgotten. A run with no
      // remembered origin (posted before a restart, or forgotten) is
      // charged to `local:unknown`; a run posted by work that had no
      // identity to `local:node`.
      static constexpr std::size_t maxRunOrigins = 65536;
      void                         setRunOrigin(std::uint64_t run, const UsageHandle& origin);
      void                         clearRunOrigin(std::uint64_t run);
      UsageHandle                  runOrigin(std::uint64_t run);

      // PHASE 2 HOOK. Called where work for an identity is about to start
      // (a request before it is served, a posted run before it executes).
      // Phase 1 never refuses: quotas are stored settings of the x-usage
      // service that nothing reads here. Enforcement goes in this function.
      void enforceQuota(const UsageHandle& /*who*/) {}

      // Storage. All three must run on the thread that owns `writer`, and
      // flush() on one thread at a time (psinode has one thread for it).
      //
      // load: reads the stored records; call once, before use.
      // publishSettings: writes UsageConfigRow for the reporting service.
      // flush: applies what was counted since the last flush to the windows,
      //   drops expired records, evicts down to the bound, and writes every
      //   changed row (absolute values, so a repeated or interrupted flush
      //   is harmless and a crash loses at most one interval).
      void load(SharedDatabase& db, Writer& writer);
      void publishSettings(SharedDatabase& db, Writer& writer);
      void flush(SharedDatabase& db, Writer& writer);

      // The same without storage (tests): returns the rows a flush would
      // write and the identities it would remove.
      struct Changes
      {
         std::vector<UsageRow>      rows;
         std::vector<UsageIdentity> removed;
      };
      Changes collect();

      // The current rows, including what has not been flushed yet. An
      // aggregate appears a second time for counts that are still on their
      // way to it; add the rows of one identity together.
      std::vector<UsageRow> rows();
      // Per kind (aggregates added to the kind they belong to): what the
      // metrics endpoint exports.
      struct KindTotal
      {
         UsageKind     kind;
         std::size_t   records = 0;
         UsageCounters total;
      };
      std::vector<KindTotal> totals();

      // Seconds since the Unix epoch. Replaceable in tests.
      std::function<std::uint64_t()> clock;

     private:
      struct IdentityHash
      {
         std::size_t operator()(const UsageIdentity& id) const noexcept
         {
            return std::hash<std::string>{}(id.id) * 31 + static_cast<std::size_t>(id.kind);
         }
      };
      using Map = std::unordered_map<UsageIdentity, UsageHandle, IdentityHash>;

      UsageHandle  findLocked(const UsageIdentity& identity);
      UsageHandle  aggregateLocked(UsageKind aggregateKind, UsageKind of);
      std::size_t& liveCount(UsageKind kind);
      UsageRow     toRow(const UsageRecord& record, const UsageCounters& total) const;
      void         detach(const UsageHandle& record, UsageKind into, Changes& changes);

      UsageSettings settings_;

      // Guards records_, liveCounts_. Never held while storage is used.
      std::mutex                       mutex_;
      Map                              records_;
      std::map<UsageKind, std::size_t> liveCounts_;

      // Guards the flush state of every record and detached_.
      std::mutex               flushMutex_;
      std::vector<UsageHandle> detached_;

      std::mutex                                     runMutex_;
      // Ordered: run ids grow, so the first entry is the oldest.
      std::map<std::uint64_t, UsageHandle> runOrigins_;
   };
}  // namespace psibase
