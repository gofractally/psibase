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

psidb::page_manager::page_manager(int fd, std::size_t num_pages) : _allocator(num_pages * page_size)
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
      auto [page, id] = allocate_page();
      page->type      = page_type::leaf;
      page->version   = 0;
      static_cast<page_leaf*>(page)->clear();
      next_file_page += 2;

      checkpoint_root h     = {};
      h.table_roots[0]      = id;
      auto [iter, inserted] = active_checkpoints.emplace(0, h);
      stable_checkpoint = last_commit = head = &iter->second;
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

psidb::page_header* psidb::page_manager::read_page(page_id& id)
{
   auto            mutex = _page_load_mutex[id];
   std::lock_guard l{mutex};

   if (is_memory_page(id))
   {
      return translate_page_address(id);
   }

   auto [page, num] = allocate_page();
   page             = new (page) page_internal_node;

   read_page(page, id);

   id = num;
   return page;
}

psidb::page_header* psidb::page_manager::read_page(node_ptr ptr, page_id id)
{
   auto            mutex = _page_load_mutex[id];
   std::lock_guard l{mutex};

   id = *ptr;
   if (is_memory_page(id))
   {
      return translate_page_address(id);
   }

   page_internal_node* node = ptr.get_parent<page_internal_node>();
#if 0
   if(node->flags & page_flags::evicted) {
      unqueue_gc(node);
   }
#endif

   auto [page, num] = allocate_page();
   page             = new (page) page_internal_node;

   read_page(page, id);

   node->relink_all(ptr, id, num);
   return page;
}

page_id psidb::page_manager::allocate_file_page()
{
   return next_file_page++;
}

// TODO: implement
void page_manager::queue_gc(page_header* node) {}

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
            if (data)
            {
               if (data->fetch_add(-1, std::memory_order_relaxed) == 1)
               {
                  delete data;
                  write_header();
               }
            }
            break;
         }
         else
         {
            size -= res;
            src = static_cast<char*>(src) + res;
            dest += res;
         }
      } while (size != 0);
   }
}

void psidb::page_manager::queue_write(page_id dest, page_header* src, std::atomic<int>* refcount)
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

void psidb::page_manager::write_page(page_header*      page,
                                     page_flags        dirty_flag,
                                     std::atomic<int>* refcount)
{
   auto dest = allocate_file_page();
   page->id  = dest;
   page->set_dirty(dirty_flag, false);
   queue_write(dest, page, refcount);
   refcount->fetch_add(1, std::memory_order_relaxed);
}

bool psidb::page_manager::write_tree(page_id           page,
                                     version_type      version,
                                     page_flags        dirty_flag,
                                     std::atomic<int>* refcount)
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
         write_page(header, dirty_flag, refcount);
         return true;
      }
   }
}

void psidb::page_manager::start_flush(checkpoint_root* c)
{
   std::atomic<int>* refcount = new std::atomic<int>(1);
   // TODO: flush all tables
   write_tree(c->table_roots[0], c->version, switch_dirty_flag(_dirty_flag), refcount);
   if (refcount->fetch_add(-1, std::memory_order_relaxed))
   {
      delete refcount;
      write_header();
   }
}

void psidb::page_manager::read_page(void* out, page_id id)
{
   char*       dest      = reinterpret_cast<char*>(out);
   std::size_t remaining = sizeof(database_header);
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
   for (std::uint32_t i = 0; i < tmp.num_checkpoints; ++i)
   {
      auto [iter, inserted] =
          active_checkpoints.emplace(tmp.checkpoints[i].version, tmp.checkpoints[i]);
      if (i == 0)
      {
         stable_checkpoint = &iter->second;
      }
      else if (i == 1)
      {
         last_commit = &iter->second;
      }
      else
      {
         head = &iter->second;
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

void psidb::page_manager::prepare_header(database_header* header)
{
   header->checkpoints[0] = *stable_checkpoint;
   prepare_flush(header->checkpoints[0].table_roots[0]);
   header->num_checkpoints = 1;
   header->set_checksum();
}

// Writing the header MUST be fully syncronized, but doesn't need to block
// other work.
void psidb::page_manager::write_header()
{
   database_header tmp;
   read_page(&tmp, header_page);
   write_page(&tmp, backup_header_page);
   if (::fdatasync(fd) != 0)
   {
      throw std::system_error{errno, std::system_category(), "fdatasync"};
   }
   prepare_header(&tmp);
   tmp.set_checksum();
   write_page(&tmp, header_page);
   // TODO: On linux pwritev2 with RWF_DSYNC can sync just the data written
   // by this call.
   if (::fdatasync(fd) != 0)
   {
      throw std::system_error{errno, std::system_category(), "fdatasync"};
   }
}
