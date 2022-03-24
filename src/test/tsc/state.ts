import 'mocha'
import assert = require('assert')
import * as fdb from '../../../'
import {testApiVersion} from './util'
// import mod from '../../../dist/js/native'


describe('state tests', () => {
  it('throws if a closed database has a tn run on it', async () => {
    fdb.setAPIVersion(testApiVersion)
    const db = fdb.open()
    db.close()
    // Not supported on node 8 :(
    // await assert.rejects(db.get('x'))
    await db.get('x').then(
      () => Promise.reject('should have thrown'),
      (e) => true
    )
  })

  it.skip('cancels pending watches when the database is closed', async () => {
    // This doesn't actually work, though I thought it would.
    fdb.setAPIVersion(testApiVersion)
    const db = fdb.open()
    const w = await db.getAndWatch('x')
    db.close()

    await w.promise

  })

  /*
  it('does nothing if the native module has setAPIVersion called again', () => {
    mod.setAPIVersion(testApiVersion)
    mod.setAPIVersionImpl(testApiVersion, testApiVersion)
  }) */
})