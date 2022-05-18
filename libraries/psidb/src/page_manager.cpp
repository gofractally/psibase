#include <new>

#include <psidb/page_manager.hpp>
#include <psidb/page_types/internal_node.hpp>
#include <psidb/page_types/leaf_node.hpp>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

using namespace psidb;

static constexpr page_id header_page        = max_memory_pages;
static constexpr page_id backup_header_page = header_page + 1;

psidb::page_manager::page_manager(int fd, std::size_t num_pages)
    : _allocator(num_pages), _file_allocator(fd), _page_map(num_pages * 2)
{
   // FIXME: inconsistent behavior W.R.T. cleanup of fd on exception.
   this->fd = fd;
   if (fd == -1)
   {
      throw std::system_error(errno, std::system_category(), "open");
   }
   struct stat file_info;
   if (::fstat(fd, &file_info) == -1)
   {
      throw std::system_error(errno, std::system_category(), "fstat");
   }
   if (file_info.st_size == 0)
   {
      // initialize new database
      auto [page, id]   = allocate_page();
      page->type        = page_type::leaf;
      page->id          = 0;
      page->version     = 1;
      page->min_version = page->version;
      page->prev.store(gc_allocator::null_page, std::memory_order_relaxed);
      touch_page(page, page->version);
      static_cast<page_leaf*>(page)->clear();

      checkpoint_root h = {};
      h.version         = page->version;
      h.table_roots[0]  = id;
      stable_checkpoint = nullptr;
      last_commit = head = checkpoint_ptr{new checkpoint_data{this, h}};

      // reserve the first two pages for the header
      _file_allocator.initialize(2);
   }
   else
   {
      read_header();
   }
}

psidb::page_manager::page_manager(const char* filename, std::size_t num_pages)
    : page_manager(::open(filename, O_RDWR | O_CREAT, S_IRUSR | S_IWUSR), num_pages)
{
}

psidb::page_manager::~page_manager()
{
   _write_queue.interrupt();
   _write_worker.join();
   if (fd != -1)
   {
      ::close(fd);
   }
}

static off_t get_file_offset(page_id id)
{
   return static_cast<off_t>(id - max_memory_pages) * page_size;
}

void* psidb::page_manager::read_pages(page_id& id, std::size_t count)
{
   auto pos = _page_map.lock(id);
   if (pos)
   {
      id = *pos;
   }

   if (is_memory_page(id))
   {
      return translate_page_address(id);
   }

   void* result = _allocator.allocate(count * page_size);

   read_page(result, id, count);

   auto new_id = get_id(static_cast<page_header*>(result));

   id = new_id;
   // makes the loaded page visible to other threads
   pos.store(new_id);
   return result;
}

psidb::page_header* psidb::page_manager::read_page(page_id& id)
{
   auto pos = _page_map.lock(id);
   if (pos)
   {
      id = *pos;
   }

   if (is_memory_page(id))
   {
      return translate_page_address(id);
   }

   auto [page, num] = allocate_page();
   page             = new (page) page_internal_node;

   read_page(page, id);

   id = num;
   pos.store(num);
   return page;
}

psidb::page_header* psidb::page_manager::read_page(node_ptr ptr, page_id id)
{
   auto pos = _page_map.lock(id);
   if (pos)
   {
      id = *pos;
      // TODO: what if ptr was modified after we checked it?
      // read/read conflict is excluded by the page lock
      // read/evict conflict????  This will always result in ABA
      //   and is undetectable.  Not yet sure whether it's a problem.
      ptr->store(id, std::memory_order_release);
      return translate_page_address(id);
   }

   id = *ptr;
   if (is_memory_page(id))
   {
      return translate_page_address(id);
   }

   page_internal_node* node = ptr.get_parent<page_internal_node>();

   auto [page, num] = allocate_page();
   page             = new (page) page_internal_node;

   read_page(page, id);

   ptr->store(num, std::memory_order_release);
   pos.store(num);

   return page;
}

page_id psidb::page_manager::allocate_file_page()
{
   return _file_allocator.allocate(1);
}

page_id psidb::page_manager::allocate_file_pages(std::size_t count)
{
   return _file_allocator.allocate(count);
}

void page_manager::queue_gc(page_header* node)
{
   //_gc_manager.queue_gc(_allocator, node);
}

void psidb::page_manager::write_worker()
{
   while (true)
   {
      write_queue_element next;
      if (!_write_queue.pop(next))
         return;
      auto [dest, src, size, data] = next;
      do
      {
         ssize_t res = pwrite(fd, src, size, dest);
         if (res == -1)
         {
            perror("pwrite");
            // notify error
         }
         else if (size == res)
         {
            break;
         }
         else
         {
            size -= res;
            src = static_cast<const char*>(src) + res;
            dest += res;
         }
      } while (size != 0);
   }
}

void psidb::page_manager::queue_write(page_id                      dest,
                                      page_header*                 src,
                                      const std::shared_ptr<void>& refcount)
{
   _write_queue.push({get_file_offset(dest), src, page_size, refcount});
}

#if 0
void psidb::page_manager::evict_page(node_ptr ptr) {
   // The page must not be dirty
   page_id id = *ptr;
   page_header* node = translate_page_address(id);
   queue_gc(node);
   node->relink_all(ptr, id, node->id);
}
#endif

void psidb::page_manager::write_page(page_header*                 page,
                                     page_flags                   dirty_flag,
                                     const std::shared_ptr<void>& refcount)
{
   auto dest = allocate_file_page();
   _page_map.store(dest, get_id(page));
   page->id = dest;
   page->set_dirty(dirty_flag, false);
   queue_write(dest, page, refcount);
}

void psidb::page_manager::write_pages(page_id                      dest,
                                      const void*                  src,
                                      std::size_t                  count,
                                      const std::shared_ptr<void>& refcount)
{
   _write_queue.push({get_file_offset(dest), src, page_size * count, refcount});
}

static void fix_data_reference(std::string_view value,
                               page_id          page,
                               std::uint16_t    offset,
                               std::uint32_t    size)
{
   page_manager::value_reference result{.flags  = page_manager::value_reference_flags::file,
                                        .offset = offset,
                                        .size   = size,
                                        .page   = page};
   // FIXME: This probably needs to be an atomic store -- which means that reads also need to be atomic
   std::memcpy(const_cast<char*>(value.data()), &result, sizeof(result));
}

bool psidb::page_manager::write_tree(page_id                      page,
                                     version_type                 version,
                                     page_flags                   dirty_flag,
                                     const std::shared_ptr<void>& refcount)
{
   // This requires the invariant that if a node is on
   // disk, its children are also on disk.
   while (true)
   {
      if (!is_memory_page(page))
      {
         return false;
      }
      page_header* header = translate_page_address(page);
      if (header->version > version)
      {
         // TODO: The thread that modified next did not make any changes
         // to memory that we need to see, right?  xxx on a double modification
         // we need to see the version from the first modification.
         page = header->prev.load(std::memory_order_acquire);
         continue;
      }
      if (!header->is_dirty(dirty_flag))
      {
         return false;
      }
      if (header->type == page_type::node)
      {
         bool result = false;
         for (auto& child : static_cast<page_internal_node*>(header)->get_children())
         {
            result |=
                write_tree(child.load(std::memory_order_acquire), version, dirty_flag, refcount);
         }
         if (result)
         {
            write_page(header, dirty_flag, refcount);
         }
         return result;
      }
      else
      {
         auto*       leaf              = static_cast<page_leaf*>(header);
         std::size_t current_page_size = page_size;
         std::size_t pages             = 0;
         for (std::size_t i = 0; i < leaf->size; ++i)
         {
            auto [value, flags] = leaf->get_value(i);
            if (flags)
            {
               value_reference ref;
               assert(value.size() == sizeof(ref));
               std::memcpy(&ref, value.data(), sizeof(ref));
               if (ref.size > page_size)
               {
                  // pages += (ref.size + page_size - 1)/page_size;
                  current_page_size = page_size;
                  auto page         = allocate_file_pages((ref.size + page_size - 1) / page_size);
                  write_pages(page, ref.data, (ref.size + page_size - 1) / page_size, refcount);
                  fix_data_reference(value, page, 0, ref.size);
               }
               else if (ref.size + current_page_size > page_size)
               {
                  ++pages;
                  current_page_size = ref.size;
               }
               else
               {
                  current_page_size += ref.size;
               }
            }
         }
         if (pages != 0)
         {
#if 1
            assert("multi page allocation not implemented");
#else
            void* data_pages           = _allocator.allocate(pages * page_size);
            current_page_size          = page_size;
            std::size_t page_num       = 0;
            page_id     data_base_page = allocate_file_pages(pages);
            for (std::size_t i = 0; i < leaf->size; ++i)
            {
               auto [value, flags] = leaf->get_value(i);
               if (flags)
               {
                  // TODO: handle values that are already stored in the file
                  value_reference ref;
                  assert(value.size() == sizeof(ref));
                  std::memcpy(&ref, value.data(), sizeof(ref));
                  if (ref.size > page_size)
                  {
                     // pages += (ref.size + page_size - 1)/page_size;
                     current_page_size = page_size;
                  }
                  else if (ref.size + current_page_size > page_size)
                  {
                     // TODO: should we zero the rest of the current_page?
                     std::memcpy(reinterpret_cast<char*>(data_pages) + page_num * page_size,
                                 ref.data, ref.size);
                     // TODO: this probably needs to run after the I/O has been queued
                     fix_data_reference(value, data_base_page + page_num * page_size, 0, ref.size);
                     ++page_num;
                     current_page_size = ref.size;
                  }
                  else
                  {
                     std::memcpy(reinterpret_cast<char*>(data_pages) + page_num * page_size +
                                     current_page_size,
                                 ref.data, ref.size);
                     fix_data_reference(value, data_base_page + page_num * page_size,
                                        current_page_size, ref.size);
                     current_page_size += ref.size;
                  }
               }
            }
            write_pages(data_base_page, data_pages, pages, refcount);
            write_page(header, dirty_flag, refcount);
#endif
         }
         else
         {
            write_page(header, dirty_flag, refcount);
         }
         return true;
      }
   }
}

void psidb::page_manager::start_flush(const checkpoint_ptr& ptr, bool stable)
{
   struct finish_flush
   {
      ~finish_flush() { self->write_header(ptr, stable); }
      checkpoint_ptr ptr;
      page_manager*  self;
      bool           stable;
   };
   std::shared_ptr<void> refcount = std::make_shared<finish_flush>(ptr, this, stable);
   // TODO: flush all tables
   auto* c = &ptr->_root;
   write_tree(c->table_roots[0], c->version, switch_dirty_flag(_dirty_flag), refcount);
}

void psidb::page_manager::read_page(void* out, page_id id, std::size_t count)
{
   char*       dest      = reinterpret_cast<char*>(out);
   std::size_t remaining = page_size * count;
   off_t       offset    = get_file_offset(id);
   do
   {
      auto res = ::pread(fd, dest, remaining, offset);
      if (res < 0)
      {
         if (errno == EINTR)
         {
            continue;
         }
         else
         {
            throw std::system_error{errno, std::system_category(), "pread"};
         }
      }
      if (res == 0)
      {
         // Zero-fill after EOF
         std::memset(dest, 0, remaining);
         return;
      }
      offset += res;
      dest += res;
      remaining -= res;
   } while (remaining);
}

void psidb::page_manager::write_page(const void* in, page_id id)
{
   const char* src       = reinterpret_cast<const char*>(in);
   std::size_t remaining = sizeof(database_header);
   off_t       offset    = get_file_offset(id);
   do
   {
      auto res = ::pwrite(fd, src, remaining, offset);
      if (res < 0)
      {
         if (errno == EINTR)
         {
            continue;
         }
         else
         {
            throw std::system_error{errno, std::system_category(), "pwrite"};
         }
      }
      offset += res;
      src += res;
      remaining -= res;
   } while (remaining);
}

void psidb::page_manager::read_header(database_header* header)
{
   read_page(header, header_page);
   if (header->verify())
   {
      return;
   }
   read_page(header, backup_header_page);
   if (!header->verify())
   {
      throw "Cannot read database.  File corrupt.";
   }
}

void psidb::page_manager::read_header()
{
   database_header tmp;
   read_header(&tmp);
   _file_allocator.load(tmp.freelist, tmp.freelist_size, _allocator);
   for (std::uint32_t i = 0; i < tmp.num_checkpoints; ++i)
   {
      checkpoint_ptr c{new checkpoint_data(this, tmp.checkpoints[i])};
      if (i == 0)
      {
         stable_checkpoint = c;
      }
      else if (i == 1)
      {
         last_commit = c;
      }
      else
      {
         head = c;
         // TODO: make sure that uncommitted checkpoints do not get freed.
      }
   }
   if (!last_commit)
   {
      last_commit = stable_checkpoint;
   }
   if (!head)
   {
      head = last_commit;
   }
}

void psidb::page_manager::prepare_flush(page_id& root)
{
   if (is_memory_page(root))
   {
      root = translate_page_address(root)->id;
   }
}

void psidb::page_manager::prepare_header(database_header* header, const checkpoint_ptr& root)
{
   if (stable_checkpoint == nullptr)
   {
      stable_checkpoint = root;
   }
   header->checkpoints[0] = stable_checkpoint->_root;
   header->checkpoints[1] = root->_root;
   prepare_flush(header->checkpoints[0].table_roots[0]);
   prepare_flush(header->checkpoints[1].table_roots[0]);
   header->num_checkpoints = 2;
   header->set_checksum();
}

// Writing the header MUST be fully syncronized, but doesn't need to block
// other work.
void psidb::page_manager::write_header(const checkpoint_ptr& root, bool stable)
{
   // ensure that the old stable checkpoint is preserved until after
   // the new checkpoint is durably stored.
   // TODO: on error, swap back
   checkpoint_ptr old_stable_checkpoint;
   if (stable)
   {
      old_stable_checkpoint = root;
      std::swap(stable_checkpoint, old_stable_checkpoint);
   }
   database_header tmp;
   auto [freelist, freelist_pages] = _file_allocator.flush(_allocator);
   tmp.freelist                    = freelist;
   tmp.freelist_size               = freelist_pages;
   // TODO: skip the copy if the header is not valid (after creating a new
   // database or after crash recovery)
   read_page(&tmp, header_page);
   write_page(&tmp, backup_header_page);
   if (::fdatasync(fd) != 0)
   {
      throw std::system_error{errno, std::system_category(), "fdatasync"};
   }
   prepare_header(&tmp, root);
   tmp.set_checksum();
   write_page(&tmp, header_page);
   // TODO: On linux pwritev2 with RWF_DSYNC can sync just the data written
   // by this call.
   if (::fdatasync(fd) != 0)
   {
      throw std::system_error{errno, std::system_category(), "fdatasync"};
   }
   _syncing.store(false, std::memory_order_release);
}

psidb::checkpoint_data::checkpoint_data(page_manager* self, const checkpoint_root& value)
    : _self(self), _root(value)
{
   std::lock_guard l{_self->_checkpoint_mutex};
   _self->_active_checkpoints.push_back(*this);
}

// Creates a new checkpoint based on the head checkpoint
psidb::checkpoint_data::checkpoint_data(page_manager* self) : _self(self)
{
   std::lock_guard l{_self->_checkpoint_mutex};
   _root = _self->_active_checkpoints.back()._root;
   ++_root.version;
   _self->_active_checkpoints.push_back(*this);
}

psidb::checkpoint_data::~checkpoint_data()
{
   std::lock_guard l{_self->_checkpoint_mutex};
   // process cleanups
   auto pos = _self->_active_checkpoints.iterator_to(*this);
   if (pos == _self->_active_checkpoints.begin())
   {
      free_pages(0);
      for (auto& v : _pages_to_free)
      {
         assert(v.empty());
      }
   }
   else
   {
      auto prev = pos;
      --prev;
      free_pages(prev->_root.version);
      prev->splice_pages(*this);
   }
   _self->_active_checkpoints.erase(pos);
}

void psidb::checkpoint_data::add_free_pages(std::vector<page_header*>&& pages)
{
   //std::cerr << "freeing pages: " << pages.size() << std::endl;
   // partition first? I don't know whether that's worthwhile
   std::sort(pages.begin(), pages.end(),
             [](page_header* lhs, page_header* rhs)
             { return lhs->min_version < rhs->min_version; });
   while (!pages.empty() && pages.back()->min_version > _root.version)
   {
      _self->queue_gc(pages.back());
      pages.pop_back();
   }
   _pages_to_free.push_back(std::move(pages));
}

// Free all pages more recent than version
void psidb::checkpoint_data::free_pages(version_type version)
{
   for (auto& v : _pages_to_free)
   {
      while (!v.empty() && v.back()->min_version > version)
      {
         _self->queue_gc(v.back());
         v.pop_back();
      }
   }
}

void psidb::checkpoint_data::splice_pages(checkpoint_data& other)
{
   for (auto& v : other._pages_to_free)
   {
      if (!v.empty())
      {
         _pages_to_free.push_back(std::move(v));
      }
   }
}

void psidb::page_manager::print_summary()
{
   std::lock_guard l{_checkpoint_mutex};
   for (auto& c : _active_checkpoints)
   {
      std::size_t count = 0;
      for (const auto& v : c._pages_to_free)
      {
         count += v.size();
      }
   }
}
