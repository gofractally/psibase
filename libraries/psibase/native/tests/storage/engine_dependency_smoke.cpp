#include <psitri/engines/big.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <unistd.h>
static_assert(psitri::engine<psitri::big_engine>);
int main(int argc, char** argv)
{
    if(argc!=2) return 2;
    const std::filesystem::path path=std::string(argv[1])+"-"+std::to_string(::getpid());
    // Retain each test's files, and fail rather than deleting an existing path.
    if(std::filesystem::exists(path)) throw std::runtime_error("test path already exists");
    using E=psitri::big_engine;
    E::config config;
    config.sync_mode=psitri::sync_mode::fsync;
    config.enable_read_cache=false;
    config.max_pinned_cache_size_mb=0;
    {
        auto db=E::database::open(path,psitri::open_mode::create_only,config);
        auto writer=db->start_write_session();
        {
            auto tx=writer->start_transaction(0);
            tx.upsert("opaque",std::string("a\0b",3));
            tx.commit();
        }
        auto snapshot=writer->get_root(0);
        {
            auto tx=writer->start_transaction(0);
            tx.upsert("opaque","updated");
            tx.commit();
        }
        if(snapshot.snapshot_cursor().get<std::string>("opaque")!=std::string("a\0b",3))
            throw std::runtime_error("snapshot isolation failed");
    }
    {
        auto db=E::database::open(path,psitri::open_mode::open_existing,config);
        if(db->start_read_session()->create_cursor(0).get<std::string>("opaque")!="updated")
            throw std::runtime_error("clean reopen failed");
    }
    std::cout << "Maintained generic Large Engine passed without any new psio dependency\n";
}
