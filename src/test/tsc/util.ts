import 'mocha'
import * as fdb from '../../../dist/js'
import * as Docker from 'dockerode';
import * as stream from 'stream';
import * as http from 'http';

const raw = require('docker-raw-stream')
const crypto = require('crypto');
const os = require('os'); 
const path = require('path'); 
const fs = require('fs');

function tmpFile(prefix: string = '', suffix: string = '', tmpdir: string = <string><unknown>null): string {
    prefix = (typeof prefix !== 'undefined') ? prefix : 'tmp.';
    suffix = (typeof suffix !== 'undefined') ? suffix : '';
    tmpdir = tmpdir ? tmpdir : os.tmpdir();
    return path.join(tmpdir, prefix + crypto.randomBytes(16).toString('hex') + suffix);
}

// We'll tuck everything behind this prefix and delete it all when the tests finish running.
export const prefix = '__test_data__/'

// export const prefixBuf = (key: Buffer) => Buffer.concat([Buffer.from(prefix), key])

// Using big endian numbers because they're lexographically sorted correctly.
export const bufToNum = (b: Buffer | null, def: number = 0) => b ? b.readInt32BE(0) : def
export const numToBuf = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n, 0)
  return b
}

export const numXF = {
  pack: numToBuf,
  unpack: bufToNum
}

export const strXF = {
  pack(s: string) {return s},
  unpack(b: Buffer) {return b.toString('utf8')}
}

// Only testing with one API version for now.
// This should work with API versions 510, 520, 600, 610 and 620.
export const testApiVersion = 620

fdb.setAPIVersion(testApiVersion)

// These tests just use a single shared database cluster instance which is
// reset between tests. It would be cleaner if we used beforeEach to close &
// reopen the database but its probably fine like this.

class TestContext {
  db: fdb.Database = <fdb.Database><unknown>null
  clusterFilePath: string = <string><unknown>null
}

export const testContext : TestContext = new TestContext() // TODO: Make his strictly typed.

// const s = defaultSubspace
// const y = s.at(null, fdb.tuple)
// const y2 = y.at(null, undefined, fdb.tuple)

// const dy = db.at(null, fdb.tuple)
// const dy2 = dy.at(null, undefined, fdb.tuple)

var docker = new Docker();

const dockerImage = 'foundationdb/foundationdb:6.3.12'

// consider using fs/promise ?
const writeFile = (src: string, dst: string) => {
  return new Promise((resolve, reject) => {
    fs.writeFile(src, dst, (err: any) => {
      if (err) return reject(err)
      resolve(undefined)
    })
  })
}

before(async function() {
  this.timeout(900000);
  console.log('Pulling %s docker image before starting tests.', dockerImage)
  await docker.pull(dockerImage, {});
  await new Promise((resolve, reject) => {
    docker.pull(dockerImage, function (err: any, stream: any) {
     if(err)
      return reject(err);
 
     docker.modem.followProgress(stream, onFinished, onProgress);
 
     function onFinished(err: any, output: any) {
 
      if (err) return reject(err);
 
      return resolve(output);
     }
 
     function onProgress(event: any) {
      console.log(event?.status);
     }
    });
 
   })
  console.log('Stopping any pre-existing containers.')
  const existingContainer = docker.getContainer('node-foundationdb-test');
  try { await existingContainer.stop() } catch (e) { /* swallow exceptions here */ }
  try { await existingContainer.remove() } catch (e) { /* swallow exceptions here */}
  console.log('Creating and starting new node-foundationdb-test instance.')
  const container = await docker.createContainer({ Image: dockerImage, Tty: true, name: 'node-foundationdb-test',  Env: [ "FDB_PORT=4500", "FDB_COORDINATOR_PORT=4500", "FDB_NETWORKING_MODE=host" ], ExposedPorts: { '4500/tcp': { } }, HostConfig : { 'PortBindings' : { '4500/tcp' : [{ 'HostPort': '4500' }] } } })
  await container.start()
  const exec = await container.exec({ AttachStdout: true, AttachStderr: true, Tty: false, Cmd: [ '/usr/bin/fdbcli', '--exec', 'configure new single memory' ] })

  const result =await new Promise((resolve, reject) => {
    exec.start({ Tty: false, Detach: false }, function (err?: any, res?: stream.Duplex) {
      if(err) {
        return reject(err);
      }
      
      if (!stream) {
        return reject('no stream provided');
      }
    
      let finished = false;
      followProgressRaw(<stream.Readable>res, onFinished, onProgress);

      const checkForCompletion = async () => {
        try {
          const execInspect = await exec.inspect()
          if (execInspect.ExitCode != null) {
            if (execInspect.ExitCode != 0) {
              onFinished(execInspect)
            } else {
              onFinished(undefined, execInspect)
            }

            if (res && !res.destroyed) {
              res.destroy()
            }
          } else {
            setTimeout(checkForCompletion, 1000)
          }
        } catch (e) {
          reject(e)
        }
      }

      checkForCompletion();

      function onFinished(err: any, output?: Docker.ExecInspectInfo) {
        if (finished) return;
        if (err) { return reject(err); }
        exec.inspect(function(err, data) {
          return resolve(output);
        })
      }
 
     function onProgress(event: any) {
       if (finished) return;
       console.log(event);
     }
    });
   })
  
  console.log('node-foundationdb-test instance started.')
  console.log('Connecting to foundatindb...')
  testContext.clusterFilePath = tmpFile('fdb-', '.cluster');
  await writeFile(testContext.clusterFilePath, 'docker:docker@127.0.0.1:4500')
  let db = testContext.db = fdb.open(testContext.clusterFilePath).at(prefix)
  console.log('Verifying connection...')
  await db.set('test', 'hello world')
  await db.clear('test')

})

after(async function () {
  this.timeout(60000)
  if (testContext.db != null) testContext.db.close()
  // fdb.stopNetworkSync()
  var existingContainer = docker.getContainer('node-foundationdb-test');
  try { await existingContainer.stop() } catch (e) { /* swallow exceptions here */ }
  try { await existingContainer.remove() } catch (e) { /* swallow exceptions here */}
})

// We need to do this both before and after tests run to clean up any mess
// that a previously aborted test left behind. This is safe - it only clears
// everything at the specified prefix. Its terrifying though.
beforeEach(() => testContext.db.clearRangeStartsWith(''))
afterEach(() => testContext.db.clearRangeStartsWith(''))

// describe('fdb', () => fn(db))

// TODO: It would be nice to check that nothing was written outside of the prefix.

const followProgressRaw = function (stream: stream.Readable, onFinished: any, onProgress: any) {
  var buf = '';
  const output: any[] = [];
  var finished = false;

  const decode = raw.decode();
  decode.stdout.on('data', onStreamEvent)
  decode.stderr.on('data', onStreamError)

  stream = stream.pipe(decode)

  stream.on('data', onStreamEvent);
  stream.on('error', onStreamError);
  stream.on('end', onStreamEnd);
  stream.on('close', onStreamEnd);

  function onStreamEvent(data: any) {
    buf += data.toString();
    pump();

    function pump() {
      var pos;
      while ((pos = buf.indexOf('\n')) >= 0) {
        if (pos == 0) {
          buf = buf.slice(1);
          continue;
        }
        processLine(buf.slice(0, pos));
        buf = buf.slice(pos + 1);
      }
    }

    function processLine(line: string) {
      if (line[line.length - 1] == '\r') line = line.substr(0, line.length - 1);
      if (line.length > 0) {
        var obj = line;
        output.push(obj);
        if (onProgress) {
          onProgress(obj);
        }
      }
    }
  };

  function onStreamError(err: any) {
    finished = true;
    stream.removeListener('data', onStreamEvent);
    stream.removeListener('error', onStreamError);
    stream.removeListener('end', onStreamEnd);
    stream.removeListener('close', onStreamEnd);
    onFinished(err, output);
  }

  function onStreamEnd() {
    if(!finished) onFinished(null, output);
    finished = true;
  }
}