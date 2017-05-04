#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var ssh2 = require('ssh2');
var minimist = require('minimist');
var ndjson = require('ndjson');
var tmp = require('tmp');
var uuid = require('uuid').v4;
var rpc = require('rpc-multistream');

var argv = minimist(process.argv.slice(2), {
  alias: {
    D: 'debug',
    p: 'port',
    h: 'host',
    d: 'device',
    p: 'pubkey',
    c: 'cmd'
  },
  boolean: [
    'debug'
  ],
default: {
}
});

var settings = require('../settings.js');
settings.hostname = argv.hostname || settings.hostname;
settings.port = argv.port || settings.port;
settings.device = argv.device || settings.device;
settings.pubkey = argv.pubkey || settings.pubkey;
settings.cmd = argv.cmd || settings.cmd;
settings.name = settings.name.replace(/^\w\d\.\-_]+/, '-');

console.log("Using printer name:", settings.name);

var conn;

function debug(str) {
  if(!settings.debug) return;

  console.log('[debug] ', str);
}

function getNodeID() {
  var filepath = path.join(__dirname, '..', "node_id");
  var id;
  try {
    id = fs.readFileSync(filepath, {encoding: 'utf8'});
    if(id.length !== 36) throw new Error("invalid node ID... regenerating");
  } catch(e) {
    id = uuid();
    fs.writeFileSync(filepath, id);
    return id;
  }                 
}

var nodeID = getNodeID();

function printLabel(path, cb) {
  console.log("Printing:", path);

  var cmd = settings.cmd + ' ' + settings.device + ' w ' + path;

  childProcess.exec(cmd, function(err, stdout, stderr) {
    if(err) return cb(err);
    cb();
  });
}


var clientRPC = {
  identify: function(cb) {
    cb(null, {
      id: nodeID,
      name: settings.name
    });
  },

  print: function(stream, cb) {
    tmp.tmpName(function(err, path) {
      if(err) return cb(err);
      var out = fs.createWriteStream(path);

      stream.pipe(out);

      debug("opened temporary file: " + path);

      out.on('error', function(err) {
        console.error("error writing temporary file:", err);
        out.close();
        fs.unlink(path);
        cb(err);
      });
      
      stream.on('end', function() {
        printLabel(path, function(err) {
          fs.unlink(path);
          cb(err);
        });
      });
    });
  }
};


function connect() {
  console.log("Connecting to: "+settings.hostname+":"+settings.port);

  conn = new ssh2.Client();
  conn.connect({
    host: settings.hostname,
    port: settings.port,
    username: settings.username,
    privateKey: fs.readFileSync(settings.privkey),
    hostHash: 'sha1',
    hostVerifier: function(hashedKey) {
      if(hashedKey === settings.hosthash) {
        return true;
      }
      console.log("Untrusted host key!");
      console.log("If you want to trust this host, set settings.hosthash to:");
      console.log("  "+hashedKey);
      console.log("");
      return false;
    }
  });

  conn.on('ready', function() {
    console.log("Connected!");

    conn.exec('stream', function(err, stream) {
      if(err) return console.error(err);

      var client = rpc(clientRPC, {
        heartbeat: 5000, // send heartbeat every 5000 ms
        maxMissedBeats: 3.5 // die after 3.5 times the above timeout
      });

      // if heartbeat fails
      client.on('death', function() {
        conn.end();
        debug("heartbeat timeout. disconnecting");
        debug("will attempt reconnect in 3 seconds");
        setTimeout(connect, 3000);
      });

      client.pipe(stream).pipe(client);
      client.on('methods', function(remote) {
        
      });
    });
  });
  

  conn.on('error', function(err) {
    console.error("Connection error:", err);

    console.log("Attempting reconnect in 10 seconds");
    setTimeout(connect, 10 * 1000);
  });

}

connect();
