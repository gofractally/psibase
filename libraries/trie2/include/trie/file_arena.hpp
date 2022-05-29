#pragma once
#include <filesystem>

namespace trie
{

   /**
    *  Potential Policies:
    *  1. always alloc to the page that most recently went from full to less than full
    *      - this will tend to keep pages full
    *      - this will tend to be a most-recently used location
    *  
    *
    *  Dealing with Sparce pages
    *      - Regardless of policy, a page will be allocated if 1 item is never freed
    *        even if the vast majority of the elements of a particular size are freed.
    *        To avoid this, all objects need to be periodically freed and reallocated.
    *       
    */
   class file_arena
   {
     public:
      file_arena(const std::filesystem::path& d, uint64_t size, bool write);
      ~file_arena();

      uint64_t alloc(uint32_t size);
      void     free(uint64_t pos);

      void read(uint64_t pos, char* data, uint32_t size);
      void write(uint64_t pos, char* data, uint32_t size);

     private:
      std::unique_ptr<struct file_arena_impl> my;
   };

}  // namespace trie
