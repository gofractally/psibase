#include <trie/debug.hpp>
#include <trie/ring_alloc.hpp>

using namespace trie;

int main(int argc, char** argv)
{
   //  std::filesystem::remove( "data.ring" );
   ring_allocator ra(
       "data.ring", ring_allocator::read_write,
       ring_allocator::config{
           .max_ids = 1000, .hot_pages = 1, .warm_pages = 1, .cool_pages = 1, .cold_pages = 1});

   /*
   WARN("========== START ===========");
   ra.dump();
   auto o = ra.alloc(88);
   WARN("alloc id: ", o.first.id);
   ra.dump();
   WARN("========== SWAP===========");
   ra.swap();
   ra.dump();
   WARN("========== CLAIM ===========");
   ra.claim_free();
   ra.dump();
   return 0;
   */

   std::vector<std::pair<object_id, char*>> ob;
   for (int t = 0; t < 1; ++t)
   {
  //    WARN("========== START ===========");
  //    ra.dump();
  //    WARN("========== ALLOC   ===========");

      for (uint32_t i = 0; i < 20; ++i)
      {
         ra.swap();
         ra.claim_free();
         if (i % 4 == 3)
         {
            if (ob.size() > 5)
            {
               DEBUG("releasing ", ob[ob.size() - 2].first.id);
               DEBUG( "old ref: " , ra.get_ref_no_cache({ob[ob.size()-2].first.id}).first );
               ra.release(ob[ob.size() - 2].first);
               DEBUG( "new ref: " , ra.get_ref_no_cache({ob[ob.size()-2].first.id}).first );
            }
         }
         ob.push_back(ra.alloc(88));
         memset(ob.back().second, 0xab, 100);
      }
      ra.dump();
      return 0;
      WARN("========== SWAP===========");
      ra.swap();
      ra.dump();
   }

   WARN("========== CLAIM FREE ===========");
   ra.claim_free();
   ra.dump();

   WARN("========== GET FREE ===========");
   ra.get(ob[30].first);
   ra.get(ob[100].first);
   WARN("========== RELEASE ", ob[105].first.id, " ===========");
   ra.release(ob[105].first);
   ra.get(ob[20].first);
   ra.dump();

   return 0;
}
