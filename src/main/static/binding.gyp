{
  'targets': [
    {
      'target_name': 'fdblib',
      'sources': [
        'src/module.cpp',
        'src/database.cpp',
        'src/transaction.cpp',
        'src/error.cpp',
        'src/options.cpp',
        'src/future.cpp',
        'src/utils.cpp'
      ],
      'libraries': [ "-l<!(node -p \"process.env.FDB_LIB_PATH ? process.env.FDB_LIB_PATH : String.raw`<(module_root_dir)/lib/fdb_c_x86_64`\")" ],
      'include_dirs': [ "<!(node -p \"process.env.FDB_INCLUDE_PATH ? process.env.FDB_INCLUDE_PATH : String.raw`<(module_root_dir)/include`\")" ],
      'cflags': [ '-std=c++0x' ],
      'xcode_settings': { 'OTHER_CFLAGS': ['-std=c++0x'] }
    }
  ]
}
