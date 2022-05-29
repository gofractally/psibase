#include <trie/ring_alloc.hpp>
#include <trie/debug.hpp>

using namespace trie;

int main(int argc, char** argv)
{
   //  std::filesystem::remove( "data.ring" );
   ring_allocator ra(
       "data.ring", ring_allocator::read_write,
       ring_allocator::config{
           .max_ids = 1000, .hot_pages = 2, .warm_pages = 2, .cool_pages = 2, .cold_pages = 10});

   WARN( "========== START ===========" );
//   ra.dump();
   WARN( "========== ALLOC  ===========" );

   std::vector<std::pair<object_id,char*>> ob;
   for( uint32_t i = 0; i < 200; ++i ) {
      if( i % 4 ) {
         ra.swap();
         ra.claim_free();
      }
      ob.push_back( ra.alloc(100) );
   }
   ra.dump();
   WARN( "========== SWAP===========" );
   ra.swap();

   ra.dump();
   WARN( "========== CLAIM FREE ===========" );
   ra.claim_free();
   ra.dump();

   WARN( "========== GET FREE ===========" );
   ra.get( ob[30].first );
   ra.get( ob[100].first );
   WARN( "========== RELEASE ", ob[105].first.id, " ===========" );
   ra.release( ob[105].first );
   ra.get( ob[20].first );
   ra.dump();


   return 0;
}
