#!/usr/bin/env node
const path = require('path')

console.info('\x1b[32m%s\x1b[0m', 'Started prepare stage.')

const { execSync } = require('child_process');

console.info('\x1b[32m%s\x1b[0m', 'Transpiling typescript.')
execSync(path.resolve('./node_modules/.bin/tsc') + ' --build . --force -pretty --verbose', { stdio: 'inherit', cwd: './src/main/tsc' })

console.info('\x1b[32m%s\x1b[0m', 'Completed prepare stage.')