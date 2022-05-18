#include <sys/mman.h>
#include <psidb/cursor.hpp>  // ??? for visit, which belongs elsewhere
#include <psidb/gc_allocator.hpp>
#include <psidb/page_types/internal_node.hpp>
#include <psidb/page_types/leaf_node.hpp>

using namespace psidb;

//#define GC_LOG

#ifdef GC_LOG
#define DEBUG_PRINT(...) std::osyncstream(std::cout) << __VA_ARGS__
#else
#define DEBUG_PRINT(...) ((void)0)
#endif

static node_ptr get_prev(page_header* header)
{
   return node_ptr{header, &header->prev};
}

psidb::gc_allocator::gc_allocator(std::size_t max_pages)
    : _page_flags(new std::atomic<gc_flag_type>[max_pages])
{
   _size = max_pages * page_size;
   _base = _unused =
       ::mmap(nullptr, _size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
}

psidb::gc_allocator::~gc_allocator()
{
   ::munmap(_base, _size);
}

void psidb::gc_allocator::sweep(cycle&& c)
{
   // process any queued nodes
   while (true)
   {
      // Block until all any copies that have started finish.
      // If the queue is empty, then we can safely ignore any elements
      // that are added afterwards (they are pushed to the queue
      // before the data is copied, therefore the data that they
      // read must have been completley processed by the garbage
      // collector, but we still need to drain the queue, and
      // mark the nodes).
      _gc_mutex.store(_gc_mutex.load(std::memory_order_relaxed) ^ 1);
      auto queue = get_scan_queue();
      if (queue.empty())
      {
         break;
      }
      // wait to make sure that the queued nodes are initialized
      _gc_mutex.store(_gc_mutex.load(std::memory_order_relaxed) ^ 1);
      for (auto ptr : queue)
      {
         scan_root(c, ptr);
      }
   }

   c.versions.clear();

   page_header* last       = nullptr;
   page_header* new_head   = nullptr;
   std::int64_t used_pages = 0;
   // iterate over all allocated objects
   for (page_header *iter = reinterpret_cast<page_header*>(_base),
                    *end  = reinterpret_cast<page_header*>(_unused);
        iter < end;
        iter = reinterpret_cast<page_header*>(reinterpret_cast<char*>(iter) + page_size))
   {
      if (!is_marked(iter) && !is_free(iter) && !is_new(iter))
      {
         mark_free(iter);
         DEBUG_PRINT("freeing page: " << get_id(iter) << " v" << iter->version << std::endl);
         page_id id = null_page;
         if (!last)
         {
            last = iter;
         }
         else
         {
            id = get_id(new_head);
         }
         iter->type = page_type::free;
         iter->prev.store(id, std::memory_order_relaxed);
         new_head = iter;
      }
      else if (!is_free(iter))
      {
         ++used_pages;
      }
   }
   gc_set_threshold(used_pages / 2);
   if (last)
   {
      while (true)
      {
         auto old_head = _free_pool.load(std::memory_order_relaxed);
         auto old_id   = old_head ? get_id(old_head) : null_page;
         last->prev.store(old_id, std::memory_order_relaxed);
         if (_free_pool.compare_exchange_weak(old_head, new_head, std::memory_order_release))
         {
            break;
         }
      }
   }
}

gc_allocator::cycle psidb::gc_allocator::start_cycle()
{
   _gc_flag.store(_gc_flag.load(std::memory_order_relaxed) ^ 1, std::memory_order_relaxed);
   // Ensure that the flag is propagated to all threads that might allocate
   _gc_mutex.store(_gc_mutex.load(std::memory_order_relaxed) ^ 1);
   return {};
}

void psidb::gc_allocator::scan_root(cycle& data, page_header* page)
{
   if (!is_marked(page))
   {
      DEBUG_PRINT("scanning page: " << get_id(page) << std::endl);
      visit([&](auto* p) { scan_children(data, p); }, page);
      scan_prev(data, page);
      mark(page);
   }
}

void psidb::gc_allocator::scan(cycle& data, node_ptr ptr)
{
   // decide whether to move the page...
   //
   auto id = *ptr;
   if (is_memory_page(id))
   {
      page_header* page = translate_page_address(id);
      if (!is_marked(page))
      {
         DEBUG_PRINT("scanning page: " << id << std::endl);
         visit([&](auto* p) { scan_children(data, p); }, page);
         scan_prev(data, page);
      }
      if (is_old(page))
      {
         if (!is_dirty(page))
         {
            ptr->store(page->id, std::memory_order_relaxed);
         }
         else
         {
            // For now, don't write back.  The checkpoint manager is responsible for that
            // and pages will never remain dirty indefinitely.  In fact, we could probably
            // fold is_dirty into is_old.
            mark(page);
         }
      }
      else
      {
         mark(page);
      }
   }
   // for now, ignore file pages
}
bool psidb::gc_allocator::is_old(page_header* header)
{
   return false;
}
bool psidb::gc_allocator::is_dirty(page_header* header)
{
   return true;
}
void psidb::gc_allocator::scan_prev(cycle& data, page_header* page)
{
   if (node_ptr prev = get_prev(page))
   {
      page_id id = *prev;
      DEBUG_PRINT("scan prev: " << get_id(page) << " -> " << id << std::endl);
      version_type min_version = page->version;
      while (is_memory_page(id))
      {
         assert(id != get_id(page));
         page_header* prev_page = translate_page_address(id);
         assert(prev_page->version < min_version);
         min_version = prev_page->version;
         if (page_is_live(data, prev_page, page->version))
         {
            DEBUG_PRINT("prev: " << get_id(page) << " -> " << id << std::endl);
            scan(data, prev);
            break;
         }
         else
         {
            auto new_id = prev_page->prev.load(std::memory_order_relaxed);
            DEBUG_PRINT("dropping page: " << id << ", version [" << prev_page->version << ","
                                          << page->version << ") " << get_id(page) << " -> "
                                          << new_id << std::endl);
            id = new_id;
            assert(id != get_id(page));
            prev->store(id);
         }
      }
   }
}

void psidb::gc_allocator::scan_children(cycle& data, page_internal_node* node)
{
   for (std::size_t i = 0; i <= node->_size; ++i)
   {
      scan(data, node->child(i));
   }
}

void psidb::gc_allocator::scan_children(cycle& data, page_leaf*) {}

// A page is live if there is an active checkpoint after its creation,
// but before its removal.
bool psidb::gc_allocator::page_is_live(cycle& data, page_header* page, version_type end_version)
{
   auto low_version = page->version;
   auto pos         = std::lower_bound(data.versions.begin(), data.versions.end(), low_version);
   // Newly created checkpoints are considered live
   return pos == data.versions.end() || *pos < end_version;
}
