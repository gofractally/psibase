
These are instructions for building **psibase** on Mac OS X Sonoma 14.1 using M-series CPUs.

1. Install the following brew libraries 

  ``` 
  brew install binaryen yarn node wasm-pack 
  ```

2. Install rust https://www.rust-lang.org/tools/install

   - If you have installed rust via homebrew, uninstall it
   - make sure ~/.cargo/bin is in your path
   - install wasm32 support for rust via:

  ``` 
  rustup target add wasm32-unknown-unknown 
  ```

  For more information: https://rustwasm.github.io/wasm-pack/book/prerequisites/non-rustup-setups.html

3. Install WASI_SDK 20.0 

  https://github.com/WebAssembly/wasi-sdk/releases
  set WASI_SDK_PREFIX to the root of the wasi-sdk release you downloaded

4. Patch up Catch2


```
Catch2: 
psibase/external/Catch2/include/reporters/catch_reporter_bases.cpp:39:14: error: 'sprintf' is deprecated: This function is provided for compatibility reasons only.  Due to security concerns inherent in the design of sprintf(3), it is highly recommended that you use snprintf(3) instead. [-Werror,-Wdeprecated-declarations]
        std::sprintf(buffer, "%.3f", duration);
```
with:
```
        std::snprintf(buffer, sizeof(buffer), "%.3f", duration);
```

5. Install icu4c 

```
git clone https://github.com/unicode-org/icu
cd icu/icu4c/source
./configure
make
export ICU_LIBRARY_DIR = icu/icu4c/source/lib
export DYLD_LIBRARY_PATH = $DYLD_LIBRARY_PATH:$ICU_LIBRARY_DIR
```

