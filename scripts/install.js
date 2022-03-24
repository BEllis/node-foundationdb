#!/usr/bin/env node

console.info('\x1b[32m%s\x1b[0m', 'Started install stage.')

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process');

function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) fs.mkdirSync(to);
    fs.readdirSync(from).forEach(element => {
        if (fs.lstatSync(path.join(from, element)).isFile()) {
            fs.copyFileSync(path.join(from, element), path.join(to, element));
        } else {
            copyFolderSync(path.join(from, element), path.join(to, element));
        }
    });
}

if (fs.existsSync('src')) {
    console.info('\x1b[32m%s\x1b[0m', 'Detected local install - Rebuilding dist directory.')
    if (fs.existsSync('dist')) {
        fs.rmSync('dist', { recursive: true, force: true })
    }
    
    fs.mkdirSync('dist')
    copyFolderSync('src/main/static', 'dist')

    fs.mkdirSync('dist/src');
    copyFolderSync('src/main/cpp', 'dist/src')
}

console.info('\x1b[32m%s\x1b[0m', 'Building FoundationDB native binding.')
execSync(path.resolve('./node_modules/.bin/node-gyp-build'), { cwd: './dist', stdio: 'inherit' })
if (fs.existsSync('bin')) { 
    fs.rmSync('bin', { recursive: true, force: true });
}

fs.mkdirSync('bin')
copyFolderSync('dist/bin', 'bin')
copyFolderSync('dist/build/Release', 'bin')
fs.rmSync('bin/obj', { recursive: true, force: true })
fs.rmSync('dist/build', { recursive: true, force: true })
console.info('\x1b[32m%s\x1b[0m', 'Completed install stage.')