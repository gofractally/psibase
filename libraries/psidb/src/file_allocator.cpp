#include <limits>
#include <psidb/file_allocator.hpp>
#include <psidb/page_header.hpp>
#include <psidb/page_manager.hpp>

using namespace psidb;

// maintain free page index

void psidb::file_allocator::initialize(std::uint32_t reserved_pages)
{
   freelist.push_back({static_cast<page_id>(max_memory_pages + reserved_pages),
                       static_cast<page_id>(std::numeric_limits<page_id>::max() - max_memory_pages -
                                            reserved_pages + 1)});
   // Guarantee that flush can deallocate the free list without resizing
   next_freelist.reserve(1);
}

page_id psidb::file_allocator::allocate(std::size_t num_pages)
{
   std::lock_guard l{_mutex};
   return allocate_unlocked(num_pages);
}

page_id psidb::file_allocator::allocate_unlocked(std::size_t num_pages)
{
   // first fit
   for (auto iter = freelist.begin(), end = freelist.end(); iter != end; ++iter)
   {
      // TODO: merge adjacent allocated segments to allow skipping
      // Also since we only deallocate in batches and completely
      // rebuild the freelist, we can remember a good place to
      // start searching.
      if (iter->size >= num_pages)
      {
         auto result = iter->start;
         iter->start += num_pages;
         iter->size -= num_pages;
         return result;
      }
   }
   throw std::bad_alloc();
}

void psidb::file_allocator::deallocate(page_id start, std::size_t num_pages)
{
   std::lock_guard l{_mutex};
   deallocate_unlocked(start, num_pages);
}

void psidb::file_allocator::deallocate_unlocked(page_id start, std::size_t num_pages)
{
   next_freelist.push_back({start, static_cast<page_id>(num_pages)});
}

template <typename It>
It merge_adjacent(It iter, It end)
{
   if (iter == end)
      return iter;
   It out = iter;
   ++iter;
   for (; iter != end; ++iter)
   {
      if (iter->start == out->start + out->size)
      {
         out->size += iter->size;
      }
      else
      {
         ++out;
         *out = *iter;
      }
   }
   ++out;
   return out;
}

// Merges two sorted free lists and calls out on each element in
// the resulting sequence.  As with the single sequence version,
// adjacent segments are combined.
template <typename It1, typename It2, typename F>
void merge_adjacent(It1 it1, It1 end1, It2 it2, It2 end2, F&& out)
{
   auto filter = [&](const auto& segment)
   {
      if (segment.size)
         out(segment);
   };
   if (it1 == end1)
   {
      std::for_each(it2, end2, filter);
      return;
   }
   else if (it2 == end2)
   {
      std::for_each(it1, end1, filter);
      return;
   }
   auto tmp = it1->start < it2->start ? *it1++ : *it2++;
   while (it1 != end1 && it2 != end2)
   {
      auto next = it1->start < it2->start ? *it1++ : *it2++;
      if (tmp.start + tmp.size == next.start)
      {
         tmp.size += next.size;
      }
      else
      {
         filter(tmp);
         tmp = next;
      }
   }
   if (it1 == end1)
   {
      if (tmp.start + tmp.size == it2->start)
      {
         tmp.size += it2->size;
         ++it2;
      }
      filter(tmp);
      std::for_each(it2, end2, filter);
   }
   else if (it2 == end2)
   {
      if (tmp.start + tmp.size == it1->start)
      {
         tmp.size += it1->size;
         ++it1;
      }
      filter(tmp);
      std::for_each(it1, end1, filter);
   }
}

file_allocator::free_segment psidb::file_allocator::flush(gc_allocator& alloc)
{
   // TODO: Using a first fit allocation algorithm means that the tail of the
   // free list may be unchanged.  If we split the free list into pages, then
   // we can reduce the amount of data that needs to be written.
   std::lock_guard l{_mutex};

   // Reorganization cannot fail and does not change the logical state

   // Compact the current free list
   freelist.erase(
       std::remove_if(freelist.begin(), freelist.end(), [](auto v) { return v.size == 0; }),
       freelist.end());
   // Organize and compact the deallocated pages
   std::sort(next_freelist.begin(), next_freelist.end(),
             [](auto lhs, auto rhs) { return lhs.start < rhs.start; });
   next_freelist.erase(merge_adjacent(next_freelist.begin(), next_freelist.end()),
                       next_freelist.end());
   // Calculate an upper bound on the size of the final free list
   std::size_t n = 0;
   merge_adjacent(freelist.begin(), freelist.end(), next_freelist.begin(), next_freelist.end(),
                  [&](const auto&) { ++n; });

   std::size_t freelist_size = n * sizeof(free_segment);
   std::size_t num_pages     = (freelist_size + page_size - 1) / page_size;
   // FIXME: This allocation needs to be rolled back on failure
   page_id                   free_root = allocate_unlocked(num_pages);
   std::vector<free_segment> new_freelist;
   new_freelist.reserve(n);
   merge_adjacent(freelist.begin(), freelist.end(), next_freelist.begin(), next_freelist.end(),
                  [&](const auto& segment) { new_freelist.push_back(segment); });
   // TODO: Use this buffer instead of freelist.  They both hold the same data,
   // so there's no need to make an extra copy.
   auto* buf = static_cast<free_segment*>(alloc.allocate(num_pages * page_size));
   auto  pos = std::uninitialized_copy(new_freelist.begin(), new_freelist.end(), buf);
   std::uninitialized_fill(pos, buf + num_pages * page_size / sizeof(free_segment), free_segment{});
   // TODO: handle write errors
   write(free_root, buf, num_pages);
   alloc.deallocate(buf, num_pages * page_size);
   free_segment result{free_root, static_cast<page_id>(num_pages)};

   // nothrow commit
   freelist = std::move(new_freelist);
   next_freelist.clear();
   next_freelist.push_back(result);
   return result;
}

int psidb::file_allocator::write(page_id page, const void* data, std::size_t num_pages)
{
   return ::pwrite(fd, data, num_pages * page_size, page * page_size);
}

int psidb::file_allocator::read(void* data, page_id page, std::size_t num_pages)
{
   return ::pread(fd, data, num_pages * page_size, page * page_size);
}

void psidb::file_allocator::load(page_id root, std::uint32_t num_pages, gc_allocator& alloc)
{
   std::lock_guard l{_mutex};
   auto*           buf = static_cast<free_segment*>(alloc.allocate(num_pages * page_size));
   read(buf, root, num_pages);
   // TODO: only search the last page.  I think all other pages
   // are guaranteed to be full.
   auto end = std::partition_point(buf, buf + num_pages * page_size / sizeof(free_segment),
                                   [](const auto& segment) { return segment.size != 0; });
   freelist = decltype(freelist)(buf, end);
   alloc.deallocate(buf, num_pages * page_size);
   previous_root.start = root;
   previous_root.size  = num_pages;
}

file_allocator::stats psidb::file_allocator::get_stats() const
{
   std::lock_guard l{_mutex};
   stats           result    = {};
   std::uint32_t   available = 0;
   for (const auto& free : freelist)
   {
      if ((0xffffffff - free.start) + 1 == free.size)
      {
         result.total = free.start - max_memory_pages;
      }
      else
      {
         available += free.size;
      }
   }
   result.used = result.total - available;
   return result;
}
