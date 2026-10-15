#!/usr/bin/env bash
# Build matched PRoot and talloc ARM64 native libraries using verified upstream source.
# GPL-2.0 PRoot; LGPL-3.0-or-later talloc; BSD-3-Clause libandroid-shmem.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="${V2_NATIVE_SOURCE_CACHE:-$HOME/cp16-proot-clean-inputs}"
work="${V2_NATIVE_WORKDIR:-$repo/.native-proot-arm64}"
ndk="${V2_ANDROID_NDK:-$HOME/v2-build-toolchain-1008/android-sdk/ndk/27.0.12077973}"
tool="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
libs="$repo/android/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$cache" "$work" "$work/lib" "$work/include/sys"
for toolname in "$tool/aarch64-linux-android26-clang" "$tool/llvm-strip" "$tool/llvm-objdump" "$tool/llvm-objcopy"; do
  test -x "$toolname" || { echo "Missing NDK tool: $toolname" >&2; exit 42; }
done

verify() {
  local filename="$1" sha="$2"
  (cd "$cache" && printf '%s  %s\n' "$sha" "$filename" | sha256sum -c -)
}
acquire() {
  local filename="$1" url="$2" sha="$3"
  if ! test -s "$cache/$filename"; then
    curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
      --connect-timeout 15 --max-time 180 --output "$cache/$filename" "$url"
  fi
  verify "$filename" "$sha"
}
acquire proot-v5.1.107.96.zip \
  https://github.com/termux/proot/archive/refs/tags/v5.1.107.96.zip \
  75f654fe60dea92dabff2bf083ae8bfe4f91baa6a1a374786a6bf391015eebaa
acquire talloc-2.5.0.tar.gz \
  https://www.samba.org/ftp/talloc/talloc-2.5.0.tar.gz \
  912afa237510ae542a7733998eb18a12bcda35ab6729c8e2ddb43e8d0ebab007
acquire libandroid-shmem-v0.7.tar.gz \
  https://github.com/termux/libandroid-shmem/archive/refs/tags/v0.7.tar.gz \
  1e5ff8459bc0a8c229dd8a94b27d119987e09ef3414331c2b5ebfff20b98e867

if ! test -d "$work/proot-5.1.107.96"; then unzip -q "$cache/proot-v5.1.107.96.zip" -d "$work"; fi
if ! test -d "$work/talloc-2.5.0"; then tar -xzf "$cache/talloc-2.5.0.tar.gz" -C "$work"; fi
if ! test -d "$work/libandroid-shmem-0.7"; then tar -xzf "$cache/libandroid-shmem-v0.7.tar.gz" -C "$work"; fi
src="$work/proot-5.1.107.96/src"
talloc="$work/talloc-2.5.0"
cp "$work/libandroid-shmem-0.7/shm.h" "$work/include/sys/shm.h"
if ! grep -q '^#include <strings.h>$' "$src/tracee/tracee.c"; then
  sed -i '1i#include <strings.h>' "$src/tracee/tracee.c"
fi
if ! grep -q '^#include <string.h>$' "$src/extension/ashmem_memfd/ashmem_memfd.c"; then
  sed -i '1i#include <string.h>' "$src/extension/ashmem_memfd/ashmem_memfd.c"
fi
cat > "$work/rep_memset_explicit.c" <<'C'
/* Derived from the upstream talloc replace implementation (LGPL-3.0-or-later). */
#include <string.h>
#include <stddef.h>
void *rep_memset_explicit(void *block, int c, size_t size) {
  void *p=memset(block,c,size);
  __asm__ volatile("" : : "g"(block) : "memory");
  return p;
}
C
"$tool/aarch64-linux-android26-clang" \
  -include stdbool.h -include string.h -include dlfcn.h -include limits.h \
  -DHAVE_BOOL=1 -DHAVE_STDBOOL_H=1 -DHAVE_INTPTR_T=1 \
  -DHAVE_UINTPTR_T=1 -DHAVE_PTRDIFF_T=1 -DHAVE_USLEEP=1 \
  -DHAVE_VA_COPY=1 -DHAVE_C99_VSNPRINTF=1 -DHAVE_VSNPRINTF=1 \
  -DHAVE_SNPRINTF=1 -DHAVE_MEMMOVE=1 -DHAVE_STRNLEN=1 \
  -shared -fPIC -O2 -fstack-protector-strong -DNO_CONFIG_H \
  -D__STDC_WANT_LIB_EXT1__=1 \
  -DTALLOC_BUILD_VERSION_MAJOR=2 -DTALLOC_BUILD_VERSION_MINOR=5 \
  -DTALLOC_BUILD_VERSION_RELEASE=0 \
  -I"$talloc" -I"$talloc/lib/replace" \
  -Wl,-soname,libtalloc_candidate.so \
  -Wl,-z,noexecstack -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
  -o "$work/lib/libtalloc_candidate.so" \
  "$talloc/talloc.c" "$work/rep_memset_explicit.c" \
  >"$work/talloc-build.log" 2>&1

# Keep the static guest loader compatible with 16 KiB Android page-size devices.
# The original loader link rule only aligns its segments to 4 KiB.
sed -i 's/-z,noexecstack$/-z,noexecstack,-z,max-page-size=16384,-z,common-page-size=16384/' "$src/GNUmakefile"
export CFLAGS="-Wall -Wextra -O2 -fPIE -fstack-protector-strong"
make -C "$src" -f GNUmakefile -B -j4 V=1 \
  PROOT_WITH_LIBANDROID_SHMEM=true \
  PROOT_UNBUNDLE_LOADER=/data/data/com.bossbayu.aiteam/files/usr/libexec/proot \
  CC="$tool/aarch64-linux-android26-clang" \
  LD="$tool/aarch64-linux-android26-clang" \
  STRIP="$tool/llvm-strip" OBJCOPY="$tool/llvm-objcopy" OBJDUMP="$tool/llvm-objdump" \
  CPPFLAGS="-D_GNU_SOURCE -D_FILE_OFFSET_BITS=64 -DARG_MAX=131072 -DVERSION=\\\"5.1.107.96\\\" -I$talloc -I$work/include -I. -I$src" \
  LDFLAGS="-L$work/lib -l:libtalloc_candidate.so -L$libs -l:libandroid-shmem.so -Wl,-z,noexecstack -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -Wl,--build-id=sha1 -pie" \
  >"$work/proot-build.log" 2>&1

test -s "$src/proot" && test -s "$src/loader/loader"
readelf -d "$src/proot" | grep -F 'Shared library: [libtalloc_candidate.so]'
! readelf -d "$src/proot" | grep -F 'Shared library: [libtalloc_v2.so]'
readelf -d "$work/lib/libtalloc_candidate.so" | grep -F 'Library soname: [libtalloc_candidate.so]'
"$tool/llvm-nm" -D "$work/lib/libtalloc_candidate.so" | grep -E ' T talloc_enable_leak_report$'
! "$tool/llvm-nm" -D "$work/lib/libtalloc_candidate.so" | grep -E ' U rep_'
file "$src/proot" "$src/loader/loader" "$work/lib/libtalloc_candidate.so"
cp "$src/proot" "$libs/libproot_exec.so"
cp "$src/loader/loader" "$libs/libproot_loader.so"
cp "$work/lib/libtalloc_candidate.so" "$libs/libtalloc_candidate.so"
sha256sum "$libs/libproot_exec.so" "$libs/libproot_loader.so" "$libs/libtalloc_candidate.so"
echo "ARM64_PAIR_REBUILT_AND_STATIC_LINK_CHECK_PASS"