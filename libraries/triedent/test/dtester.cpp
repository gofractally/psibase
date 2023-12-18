#include <stdlib.h>
#include <triedent/block_allocator.hpp>
#include <triedent/id_allocator.hpp>
#include <triedent/seg_allocator.hpp>
#include <triedent/node.hpp>
#include <triedent/database.hpp>
using namespace std::chrono_literals;

using namespace triedent;

int main(int argc, char** argv)
{
   try
   {
      std::vector<char> result;
      std::filesystem::remove_all("big.dir");
      std::filesystem::create_directories("big.dir");
      auto db = std::make_shared<database>("big.dir", read_write);
      auto ws = db->start_write_session();
      auto top = ws->get_top_root();
      auto r = ws->upsert(top, "key", "val" );
      std::cerr<< "old size: " << r <<"\n";
      auto r2 = ws->get(top, "key", &result );
      std::cerr<< "found: " << r2 <<" " << result.data() <<"\n";
      auto r3 = ws->upsert(top, "bottom", "dollar" );
      auto r4 = ws->get(top, "bottom", &result );
      std::cerr<< "found: " << r4 <<" " << result.data() <<"\n";
      return 0;



      std::filesystem::remove("data");
      std::filesystem::remove("ids");
      std::filesystem::remove("header");
      triedent::seg_allocator segs(".");

      std::cerr << "starting session\n";
      auto ss = segs.start_session();
      std::cerr << "locking data before accessing...\n";
      {
      auto sl = ss.lock();
      std::cerr << "about to alloc\n";
      // pointers only valid while sl is held
      auto oref = sl.alloc(20, triedent::node_type::inner);
      std::cout << "oref.id: " << oref.id().id << "\n";
      std::cout << "oref.ref: " << oref.ref_count() << "\n";
      std::cout << "oref.type: " << (int)oref.type() << "\n";
      std::cout << "oref.obj->size: " << (int)oref.obj()->size << "\n";
      std::cout << "oref.obj->cap: " << (int)oref.obj()->data_capacity() << "\n";
      std::cout << "oref.obj->id: " << (int)oref.obj()->id << "\n";
      std::cout << "oref.loc->seg: " << (int)oref.loc().segment() << "\n";
      std::cout << "oref.loc->idx: " << (int)oref.loc().index() << "\n";
      auto oref2 = sl.alloc(25, triedent::node_type::inner);
      std::cout << "oref2.id: " << oref2.id().id << "\n";
      std::cout << "oref2.ref: " << oref2.ref_count() << "\n";
      std::cout << "oref2.type: " << (int)oref2.type() << "\n";
      std::cout << "oref2.obj->size: " << (int)oref2.obj()->size << "\n";
      std::cout << "oref2.obj->cap: " << (int)oref2.obj()->data_capacity() << "\n";
      std::cout << "oref2.obj->id: " << (int)oref2.obj()->id << "\n";
      std::cout << "oref2.loc->seg: " << (int)oref2.loc().segment() << "\n";
      std::cout << "oref2.loc->idx: " << (int)oref2.loc().index() << "\n";

      auto oref3 = sl.alloc(25, triedent::node_type::inner);
      std::cout << "oref3.id: " << oref3.id().id << "\n";
      std::cout << "oref3.ref: " << oref3.ref_count() << "\n";
      std::cout << "oref3.type: " << (int)oref3.type() << "\n";
      std::cout << "oref3.obj->size: " << (int)oref3.obj()->size << "\n";
      std::cout << "oref3.obj->cap: " << (int)oref3.obj()->data_capacity() << "\n";
      std::cout << "oref3.obj->id: " << (int)oref3.obj()->id << "\n";
      std::cout << "oref3.loc->seg: " << (int)oref3.loc().segment() << "\n";
      std::cout << "oref3.loc->idx: " << (int)oref3.loc().index() << "\n";

      std::vector<triedent::seg_allocator::session::read_lock::object_ref<char>> objs;

      for (uint32_t i = 0; i < 260; ++i)
      {
         auto oref3 = sl.alloc(1024 * 1024, triedent::node_type::inner);
         objs.push_back(oref3);
      }

      segs.dump();

      std::cerr << "test release\n";
      oref3.release();

      segs.dump();

      std::cerr << "freeing half the objects";
      for (uint32_t i = 0; i < objs.size() / 2; ++i)
         objs[i * 2].release();
      segs.dump();

      std::cerr << "waiting on compact loop\n";
   //   for (uint32_t i = 0; i < objs.size() / 2; ++i)
//
      std::this_thread::sleep_for(1000ms);

      segs.dump();
      }
      std::cerr<<"after lock release\n";
      segs.dump();

      {
      auto sl = ss.lock();
      std::cerr<<"after lock reopened\n";
      segs.dump();

      std::vector<triedent::seg_allocator::session::read_lock::object_ref<char>> objs;
      for (uint32_t i = 0; i < 260; ++i)
      {
         auto oref3 = sl.alloc(1024 * 1024, triedent::node_type::inner);
         objs.push_back(oref3);
      }
      std::cerr<<"after a bunch of alloc \n";
      segs.dump();
      }


      /*
      triedent::id_allocator oa("test_file.dat");

      auto ses = oa.start_session();

      srand(time(nullptr));

      for (uint32_t r = 0; r < 100; ++r)
      {
         auto     start = std::chrono::steady_clock::now();
         uint64_t count = 1000 * 1000ull * 5;

         for (uint32_t i = 0; i < count; ++i)
         {
            ses.get_new_id();
         }
         auto end = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(12)
                   << int64_t(count /
                              (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                   << " items/sec  free: " << oa.get_free_count() <<"  cap: " << oa.get_capacity() <<"\n";
      }
      */
   }
   catch (std::exception& e)
   {
      std::cerr << "exception: " << e.what() << "\n";
   }
   return 0;
}
