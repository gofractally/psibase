#include <psidb/file_allocator.hpp>
#include <psidb/page_header.hpp>
#include <psidb/page_manager.hpp>

using namespace psidb;

// maintain free page index

void psidb::file_allocator::initialize(std::uint32_t reserved_pages)
{
   freelist_by_addr.insert(
       {max_memory_pages + reserved_pages, 0xffffffffu - max_memory_pages - reserved_pages + 1});
}

page_id psidb::file_allocator::allocate(std::size_t num_pages)
{
   std::lock_guard l{_mutex};
   return allocate_unlocked(num_pages);
}

page_id psidb::file_allocator::allocate_unlocked(std::size_t num_pages)
{
   // first fit
   auto pos = std::find_if(freelist_by_addr.begin(), freelist_by_addr.end(),
                           [=](const auto& segment) { return segment.second >= num_pages; });
   if (pos == freelist_by_addr.end())
   {
      throw std::bad_alloc();
   }
   auto [result, size] = *pos;
   pos                 = freelist_by_addr.erase(pos);
   if (size != num_pages)
   {
      freelist_by_addr.insert(pos, {result + num_pages, size - num_pages});
   }
   return result;
}

void psidb::file_allocator::deallocate(page_id start, std::size_t num_pages)
{
   std::lock_guard l{_mutex};
   deallocate_unlocked(start, num_pages);
}

void psidb::file_allocator::deallocate_unlocked(page_id start, std::size_t num_pages)
{
   // merge adjacent free pages
   auto pos = freelist_by_addr.lower_bound(start);
   if (pos != freelist_by_addr.end() && start + num_pages == pos->first)
   {
      num_pages += pos->second;
      pos = freelist_by_addr.erase(pos);
   }
   if (pos != freelist_by_addr.begin())
   {
      auto prev = pos;
      --prev;
      if (prev->first + prev->second == start)
      {
         prev->second += num_pages;
         return;
      }
   }
   freelist_by_addr.insert(pos, {start, num_pages});
}

file_allocator::free_segment psidb::file_allocator::flush(gc_allocator& alloc)
{
   std::lock_guard l{_mutex};
   std::size_t     n             = freelist_by_addr.size() + 1;
   std::size_t     freelist_size = n * sizeof(free_segment);
   std::size_t     num_pages     = (freelist_size + page_size - 1) / page_size;
   page_id         free_root     = allocate_unlocked(num_pages);
   if (previous_root.size != 0)
   {
      deallocate_unlocked(previous_root.start, previous_root.size);
   }
   auto* buf = static_cast<free_segment*>(alloc.allocate(num_pages * page_size));
   auto  pos = std::uninitialized_copy(freelist_by_addr.begin(), freelist_by_addr.end(), buf);
   std::uninitialized_fill(pos, buf + num_pages * page_size / sizeof(free_segment), free_segment{});
   // TODO: handle errors
   write(free_root, buf, num_pages);
   alloc.deallocate(buf, num_pages * page_size);
   previous_root = std::pair{free_root, num_pages};
   return previous_root;
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
   auto end         = std::partition_point(buf, buf + num_pages * page_size / sizeof(free_segment),
                                           [](const auto& segment) { return segment.size != 0; });
   freelist_by_addr = decltype(freelist_by_addr)(buf, end);
   alloc.deallocate(buf, num_pages * page_size);
   previous_root.start = root;
   previous_root.size  = num_pages;
}

file_allocator::stats psidb::file_allocator::get_stats() const
{
   std::lock_guard l{_mutex};
   stats           result    = {};
   std::uint32_t   available = 0;
   for (const auto& free : freelist_by_addr)
   {
      if ((0xffffffff - free.first) + 1 == free.second)
      {
         result.total = free.first - max_memory_pages;
      }
      else
      {
         available += free.second;
      }
   }
   result.used = result.total - available;
   return result;
}
