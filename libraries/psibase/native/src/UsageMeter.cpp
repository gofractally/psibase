#include <psibase/UsageMeter.hpp>

#include <psio/key.hpp>
#include <psio/pssz.hpp>

#include <algorithm>

namespace psibase
{
   namespace
   {
      constexpr UsageKind baseKinds[] = {UsageKind::local, UsageKind::ip, UsageKind::account,
                                         UsageKind::peer};

      // Rows written under one acquisition of the subjective write lock.
      constexpr std::size_t flushBatch = 128;

      std::uint64_t saturatingAdd(std::uint64_t a, std::uint64_t b)
      {
         return a > ~std::uint64_t{0} - b ? ~std::uint64_t{0} : a + b;
      }
   }  // namespace

   UsageCounters UsageRecord::snapshot() const noexcept
   {
      UsageCounters result;
      for (std::size_t i = 0; i < numUsageFields; ++i)
         result.*usageFieldMembers[i] = counters[i].load(std::memory_order_relaxed);
      return result;
   }

   UsageMeter::UsageMeter(UsageSettings settings)
       : clock([] {
            return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::seconds>(
                                                  std::chrono::system_clock::now().time_since_epoch())
                                                  .count());
         }),
         settings_(std::move(settings))
   {
   }

   std::size_t& UsageMeter::liveCount(UsageKind kind)
   {
      return liveCounts_[kind];
   }

   UsageHandle UsageMeter::aggregateLocked(UsageKind aggregateKind, UsageKind of)
   {
      auto identity = UsageIdentity::aggregate(aggregateKind, of);
      auto pos      = records_.find(identity);
      if (pos != records_.end())
         return pos->second;
      auto record       = std::make_shared<UsageRecord>(identity);
      record->firstSeen = record->lastSeen = clock();
      records_.emplace(std::move(identity), record);
      return record;
   }

   UsageHandle UsageMeter::findLocked(const UsageIdentity& identity)
   {
      auto pos = records_.find(identity);
      if (pos != records_.end())
         return pos->second;
      if (isAggregate(identity.kind))
         return aggregateLocked(identity.kind, *parseUsageKind(identity.id));
      auto& count = liveCount(identity.kind);
      if (count >= settings_.maxRecords)
         return aggregateLocked(UsageKind::overflow, identity.kind);
      auto record       = std::make_shared<UsageRecord>(identity);
      record->firstSeen = record->lastSeen = clock();
      records_.emplace(identity, record);
      ++count;
      return record;
   }

   UsageHandle UsageMeter::find(const UsageIdentity& identity)
   {
      if (!settings_.enabled)
         return nullptr;
      if (!isValid(identity))
      {
         std::lock_guard l{mutex_};
         return findLocked(UsageIdentity::local("unknown"));
      }
      std::lock_guard l{mutex_};
      return findLocked(identity);
   }

   UsageHandle UsageMeter::find(const UsageIdentity& identity, const UsageHandle& cached)
   {
      if (cached && !cached->detached() && cached->identity == identity)
         return cached;
      return find(identity);
   }

   void UsageMeter::setRunOrigin(std::uint64_t run, const UsageHandle& origin)
   {
      if (!origin)
         return;
      std::lock_guard l{runMutex_};
      auto            pos = runOrigins_.find(run);
      if (pos != runOrigins_.end())
      {
         pos->second = origin;
         return;
      }
      if (runOrigins_.size() >= maxRunOrigins)
         runOrigins_.erase(runOrigins_.begin());
      runOrigins_.emplace(run, origin);
   }

   void UsageMeter::clearRunOrigin(std::uint64_t run)
   {
      std::lock_guard l{runMutex_};
      runOrigins_.erase(run);
   }

   UsageHandle UsageMeter::runOrigin(std::uint64_t run)
   {
      if (!settings_.enabled)
         return nullptr;
      {
         std::lock_guard l{runMutex_};
         auto            pos = runOrigins_.find(run);
         if (pos != runOrigins_.end())
            return pos->second;
      }
      return find(UsageIdentity::local("unknown"));
   }

   UsageRow UsageMeter::toRow(const UsageRecord& record, const UsageCounters& total) const
   {
      UsageRow row;
      row.kind      = static_cast<std::uint8_t>(record.identity.kind);
      row.id        = record.identity.id;
      row.firstSeen = record.firstSeen;
      row.lastSeen  = record.lastSeen;
      row.keepUntil = isAggregate(record.identity.kind)
                          ? 0
                          : saturatingAdd(record.lastSeen, settings_.retention.seconds(total));
      row.total     = total;
      row.window    = record.window;
      row.current   = record.current;
      row.previous  = record.previous;
      return row;
   }

   // Caller holds flushMutex_
   void UsageMeter::detach(const UsageHandle& record, UsageKind into, Changes& changes)
   {
      UsageHandle target;
      {
         std::lock_guard l{mutex_};
         auto            pos = records_.find(record->identity);
         if (pos == records_.end() || pos->second != record)
            return;
         records_.erase(pos);
         --liveCount(record->identity.kind);
         target = aggregateLocked(into, record->identity.kind);
      }
      record->detachedFlag.store(true, std::memory_order_relaxed);
      record->foldInto = target;
      // What the record had is old use: it joins the aggregate's totals but
      // not its recent windows.
      for (std::size_t i = 0; i < numUsageFields; ++i)
         target->counters[i].fetch_add(record->flushed.*usageFieldMembers[i],
                                       std::memory_order_relaxed);
      target->flushed += record->flushed;
      target->dirty = true;
      // A record that never counted anything was never written
      if (!isZero(record->flushed))
         changes.removed.push_back(record->identity);
      // Someone may still hold the record and add to it.
      detached_.push_back(record);
   }

   UsageMeter::Changes UsageMeter::collect()
   {
      Changes changes;
      if (!settings_.enabled)
         return changes;
      std::lock_guard fl{flushMutex_};
      const auto      now    = clock();
      const auto      window = now / std::max<std::uint64_t>(settings_.windowSeconds, 1);

      // Counts that reached a record after it was detached go to the
      // aggregate it was folded into, as new use of that aggregate.
      std::erase_if(detached_,
                    [](const UsageHandle& record)
                    {
                       // Checked before the snapshot: once we are the only
                       // holder nothing can be added any more.
                       bool last  = record.use_count() == 1;
                       auto snap  = record->snapshot();
                       auto delta = snap - record->flushed;
                       for (std::size_t i = 0; i < numUsageFields; ++i)
                          record->foldInto->counters[i].fetch_add(delta.*usageFieldMembers[i],
                                                                  std::memory_order_relaxed);
                       record->flushed = snap;
                       return last;
                    });

      std::vector<UsageHandle> all;
      {
         std::lock_guard l{mutex_};
         all.reserve(records_.size());
         for (const auto& [_, record] : records_)
            all.push_back(record);
      }

      // What was counted since the last flush is use of the current window.
      for (const auto& record : all)
      {
         auto snap  = record->snapshot();
         auto delta = snap - record->flushed;
         if (record->window != window)
         {
            record->previous = window == record->window + 1 ? record->current : UsageCounters{};
            record->current  = {};
            record->window   = window;
         }
         if (!isZero(delta))
         {
            record->current += delta;
            record->flushed  = snap;
            record->lastSeen = std::max(record->lastSeen, now);
            record->dirty    = true;
         }
      }

      // Retention: a record that was not seen for as long as its use earns
      // is dropped.
      struct Candidate
      {
         std::uint64_t keepUntil;
         std::uint64_t units;
         UsageHandle   record;
      };
      std::map<UsageKind, std::vector<Candidate>> live;
      for (const auto& record : all)
      {
         if (isAggregate(record->identity.kind))
            continue;
         auto keepUntil =
             saturatingAdd(record->lastSeen, settings_.retention.seconds(record->flushed));
         // A record that counted nothing and that nobody holds any more (the
         // map and `all` do) is not kept: the address of a client whose
         // requests all turned out to be authenticated leaves no trace.
         bool unused = isZero(record->flushed) && record.use_count() <= 2;
         if (unused || keepUntil <= now)
            detach(record, UsageKind::expired, changes);
         else
            live[record->identity.kind].push_back(
                {keepUntil, usageUnits(record->flushed), record});
      }

      // The hard bound: a kind that is full gives up the records that would
      // expire soonest (of those, the smallest first), so that an eighth of
      // it is free for newcomers until the next flush.
      for (auto& [kind, candidates] : live)
      {
         if (candidates.size() < settings_.maxRecords)
            continue;
         auto keep = settings_.maxRecords - std::max<std::size_t>(settings_.maxRecords / 8, 1);
         std::ranges::sort(candidates,
                           [](const Candidate& a, const Candidate& b)
                           {
                              return std::tie(a.keepUntil, a.units, a.record->identity) <
                                     std::tie(b.keepUntil, b.units, b.record->identity);
                           });
         for (std::size_t i = 0; i + keep < candidates.size(); ++i)
            detach(candidates[i].record, UsageKind::overflow, changes);
      }

      {
         std::lock_guard l{mutex_};
         all.clear();
         for (const auto& [_, record] : records_)
            all.push_back(record);
      }
      for (const auto& record : all)
      {
         if (record->dirty)
         {
            // Nothing is written for a record until it has counted something
            if (!isZero(record->flushed))
               changes.rows.push_back(toRow(*record, record->flushed));
            record->dirty = false;
         }
      }
      return changes;
   }

   std::vector<UsageRow> UsageMeter::rows()
   {
      std::vector<UsageRow> result;
      if (!settings_.enabled)
         return result;
      std::lock_guard          fl{flushMutex_};
      std::vector<UsageHandle> all;
      {
         std::lock_guard l{mutex_};
         for (const auto& [_, record] : records_)
            all.push_back(record);
      }
      // Detached records still hold counts that no aggregate has yet.
      for (const auto& record : detached_)
      {
         auto delta = record->snapshot() - record->flushed;
         if (!isZero(delta))
         {
            auto row = toRow(*record->foldInto, delta);
            row.current = row.previous = {};
            result.push_back(std::move(row));
         }
      }
      for (const auto& record : all)
         result.push_back(toRow(*record, record->snapshot()));
      return result;
   }

   std::vector<UsageMeter::KindTotal> UsageMeter::totals()
   {
      std::vector<KindTotal> result;
      for (auto kind : baseKinds)
         result.push_back({kind});
      for (const auto& row : rows())
      {
         auto kind = static_cast<UsageKind>(row.kind);
         bool agg  = isAggregate(kind);
         if (agg)
            kind = *parseUsageKind(row.id);
         for (auto& item : result)
         {
            if (item.kind == kind)
            {
               item.total += row.total;
               if (!agg)
                  ++item.records;
            }
         }
      }
      return result;
   }

   void UsageMeter::load(SharedDatabase& db, Writer& writer)
   {
      if (!settings_.enabled)
         return;
      std::vector<SharedDatabase::SubjectiveWrite> invalid;
      std::scoped_lock                             l{flushMutex_, mutex_};
      db.kvScanSubjective(
          writer, UsageRow::db, psio::to_key(usagePrefix()),
          [&](std::span<const char> key, std::span<const char> value)
          {
             std::optional<UsageRow> row;
             if (psio::validate_strict<UsageRow>(psio::pssz{}, value).ok())
                row = psio::from_pssz<UsageRow>(psio::trusted{value});
             bool ok = row && isValid(row->identity());
             if (ok)
             {
                auto expected = psio::to_key(row->key());
                ok = std::ranges::equal(expected, key) && !records_.contains(row->identity());
             }
             if (!ok)
             {
                invalid.push_back({std::vector<char>(key.begin(), key.end()), std::nullopt});
                return;
             }
             auto record = std::make_shared<UsageRecord>(row->identity());
             for (std::size_t i = 0; i < numUsageFields; ++i)
                record->counters[i].store(row->total.*usageFieldMembers[i],
                                          std::memory_order_relaxed);
             record->firstSeen = row->firstSeen;
             record->lastSeen  = row->lastSeen;
             record->window    = row->window;
             record->flushed   = row->total;
             record->current   = row->current;
             record->previous  = row->previous;
             record->dirty     = false;
             if (!isAggregate(record->identity.kind))
                ++liveCount(record->identity.kind);
             records_.emplace(record->identity, std::move(record));
          });
      db.kvWriteSubjective(writer, UsageRow::db, invalid);
   }

   void UsageMeter::publishSettings(SharedDatabase& db, Writer& writer)
   {
      if (!settings_.enabled)
         return;
      UsageConfigRow row;
      row.maxRecords       = settings_.maxRecords;
      row.windowSeconds    = settings_.windowSeconds;
      row.flushSeconds     = settings_.flushSeconds;
      row.retentionBase    = settings_.retention.base;
      row.retentionPerUnit = settings_.retention.perUnit;
      row.retentionMax     = settings_.retention.max;
      for (const auto& prefix : settings_.trustedProxies)
         row.trustedProxies.push_back(to_string(prefix.address) + "/" +
                                      std::to_string(prefix.prefixLen));
      db.kvPutSubjective(writer, UsageConfigRow::db, psio::to_key(row.key()), psio::to_pssz(row));
   }

   void UsageMeter::flush(SharedDatabase& db, Writer& writer)
   {
      auto changes = collect();
      std::vector<SharedDatabase::SubjectiveWrite> writes;
      auto                                         send = [&]
      {
         db.kvWriteSubjective(writer, UsageRow::db, writes);
         writes.clear();
      };
      // Removals first: an identity that was dropped and came back within
      // one flush has both, and its new row must be the one that stays.
      for (const auto& identity : changes.removed)
      {
         writes.push_back({psio::to_key(usageKey(identity)), std::nullopt});
         if (writes.size() >= flushBatch)
            send();
      }
      for (const auto& row : changes.rows)
      {
         writes.push_back({psio::to_key(row.key()), psio::to_pssz(row)});
         if (writes.size() >= flushBatch)
            send();
      }
      send();
   }
}  // namespace psibase
