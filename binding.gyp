{
  'targets': [
    {
      'target_name': 'fdblib',
      'sources': [ 'src/FdbV8Wrapper.cpp', 'src/Database.cpp', 'src/Transaction.cpp', 'src/Cluster.cpp', 'src/FdbError.cpp', 'src/options.cpp', 'src/future.cpp' ],
      'conditions': [
        ['OS=="linux"', {
          'link_settings': { 'libraries': ['-lfdb_c'] },
        }],
        ['OS=="mac"', {
          'xcode_settings': { 'OTHER_CFLAGS': ['-std=c++0x'] },
          'include_dirs': ['/usr/local/include'],
          'link_settings': { 'libraries': ['-lfdb_c', '-L/usr/local/lib'] },
        }],
        ['OS=="win"', {
          'link_settings': { 'libraries': ['<!(echo %FOUNDATIONDB_INSTALL_PATH%)\\lib\\foundationdb\\fdb_c.lib'] },
          'include_dirs': ['<!(echo %FOUNDATIONDB_INSTALL_PATH%)\\include'],
        }],
      ],
      'cflags': ['-std=c++0x'],
      'include_dirs': [
        "<!(node -e \"require('nan')\")"
      ],
    }
  ]
}
