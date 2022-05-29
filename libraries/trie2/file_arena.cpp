#include <fstream>
#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <trie/file_arena.hpp>

namespace trie
{
   namespace bip = boost::interprocess;

   struct page_header
   {
      uint32_t next;
      uint32_t prev;
      uint32_t obj_size;
      uint16_t next_free;
      uint16_t num_free;
   };
   static_assert(sizeof(page_header) == 16);
   static constexpr uint32_t file_page_size       = (1 << 16) * 8;

   // 0 = empty list
   // 256 increments of 8 allocates objects up to 2048
   // 256 increments of 64 allocates objects from 2048 - 10,240
   // 256 
   static constexpr uint32_t num_page_sizes = 256;
   = file_page_size - 256*8

   struct file_header
   {
      uint64_t    free_area;
      uint32_t    free_pages_by_size[num_page_sizes];
      page_header headers[1];
   };

   struct file_arena_impl
   {
      FILE*               _file               = nullptr;
      struct file_header* _mapped_file_header = nullptr;

      std::unique_ptr<bip::file_mapping>  _page_header_mapping;
      std::unique_ptr<bip::mapped_region> _page_header_region;
   };

   file_arena::file_arena(const std::filesystem::path& d, uint64_t size, bool allow_write)
       : my(new file_arena_impl())
   {
      auto header_file = d / "page_headers.dat";
      auto data_file   = d / "data.dat";
      bool init_arena  = false;
      if (not std::filesystem::exists(d))
      {
         if (not allow_write)
            throw std::runtime_error("data directory does not exist: '" + d.generic_string() + "'");
         std::filesystem::create_directories(d);

         std::ofstream head(header_file.generic_string(), std::ofstream::trunc);
         std::ofstream data(data_file.generic_string(), std::ofstream::trunc);
         head.close();
         data.close();
         init_arena = true;
      }
      if (allow_write)
      {
         if (std::filesystem::file_size(data_file) < size)
         {
            if (size % file_page_size != 0)
               throw std::runtime_error("database size must be a multiple of " + std::to_string(file_page_size));
            std::filesystem::resize_file(data_file, size);
            std::filesystem::resize_file(
                header_file, sizeof(file_header) + sizeof(page_header) * (size / file_page_size));
         }
      }

      my->_page_header_mapping = std::make_unique<bip::file_mapping>(  //
          header_file.generic_string().c_str(), allow_write ? bip::read_write : bip::read_only);

      my->_page_header_region = std::make_unique<bip::mapped_region>(
          *my->_page_header_mapping, allow_write ? bip::read_write : bip::read_only);

      if( init ) {
        file_header* fh = my->_page_header_region->get_address();
        fh->free_area = 0;
        memset( fh->free_pages_by_size, 0xff, sizeof(file_header::free_pages_by_size) );
      }
   }

   file_arena::~file_arena() {}
}  // namespace trie
