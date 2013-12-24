// Pre-emptive purging of the fastly cache fronting registry.npmjs.org.
// Clear out user and packages as they change.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

var conf = require('./config.js')
var follow = require('follow')
var fastly = require('fastly')(conf.fastlykey)
var path = require('path')
var fs = require('fs')

var regSeq = path.resolve(__dirname, 'registry.seq')
var regSince = readSeq(regSeq)

var puSeq = path.resolve(__dirname, 'public_users.seq')
var puSince = readSeq(puSeq)

var uSeq = path.resolve(__dirname, '_users.seq')
var uSince = readSeq(uSeq)

function readSeq (file) {
  try {
    return +fs.readFileSync(file, 'ascii') || 0
  } catch (er) {
    return 0
  }
}

var writing = {}
function writeSeq(file, seq) {
  if (writing[file])
    return
  writing[file] = true
  fs.writeFile(file, seq + '\n', 'ascii', function() {
    writing[file] = false
  })
}

// /registry/:pkg -> invalidate /:pkg
// /_users/:user -> invalidate /-/user/:user
// For views and such, just let the TTL and ETags do their thing

follow({
  db: conf.registry,
  include_docs: false,
  inactivity_ms: conf.inactivity_ms,
  since: regSince
}, function (er, change) {
  if (er)
    throw er

  writeSeq(regSeq, change.seq)
  purge.call(this, '/' + change.id)
})

follow({
  db: conf.public_users,
  include_docs: false,
  inactivity_ms: conf.inactivity_ms,
  since: puSince
}, userPurge(puSeq))

follow({
  db: conf._users,
  include_docs: false,
  inactivity_ms: conf.inactivity_ms,
  since: uSince
}, userPurge(uSeq))

function userPurge (seqFile) { return function (er, change) {
  if (er)
    throw er
  writeSeq(seqFile, change.seq)
  purge.call(this, '/-/user/' + change.id)
}}

function purge(url) {
  console.log('PURGE %s', url)
  this.pause()
  fastly.purge(conf.host, url, onpurge.bind(this))
}

function onpurge(er) {
  if (er)
    throw er
  this.resume()
}
