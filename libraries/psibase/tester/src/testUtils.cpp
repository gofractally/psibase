#include <iomanip>
#include <iostream>
#include <psibase/testUtils.hpp>

using namespace psibase;
using namespace psibase::benchmarking;
using namespace std;

BenchmarkData::BenchmarkData() : activeColumn{0}
{
   timings.reserve(10000);
   timings[0].reserve(10000);
}
void BenchmarkData::print() const
{
   if (timings.size() == 0 || timings[0].size() == 0)
   {
      std::cout << "No benchmark data.\n";
      return;
   }

   for (size_t i = 0; i < timings.at(0).size(); ++i)
   {
      for (size_t j = 0; j < timings.size(); ++j)
      {
         std::string output{timings[j][i]};
         std::cout << std::left << std::setw(output.size() + 1) << output;
      }
      std::cout << "\n";
   }
}
void BenchmarkData::nextColumn()
{
   activeColumn++;
}
void BenchmarkData::addTime(const std::string& t)
{
   while (timings.size() <= activeColumn)
   {
      timings.push_back({});
   }
   timings[activeColumn].push_back(t);
}

Benchmarker::Benchmarker(std::shared_ptr<BenchmarkData> data) : d(data)
{
   startClock = Clock::now();
}

Benchmarker::~Benchmarker()
{
   d->addTime(std::to_string((Clock::now() - startClock).count() / 1000));
}
