#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var HID = require('node-hid');
var ssh2 = require('ssh2');
var minimist = require('minimist');
var ndjson = require('ndjson');
var tmp = require('tmp');
var uuid = require('uuid').v4;
var rpc = require('rpc-multistream');

var scancodeDecode = require('../scancode_decode.js');

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
settings.debug = argv.debug || settings.debug;

console.log("Using device name:", settings.name);

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
  }           
  return id;      
}

var nodeID = getNodeID();

function printLabel(device, path, cb) {

  console.log("On device '"+device.name+"' printing:", path);

  var cmd;

  if(device.type === 'qlPrinter') {
    cmd = (device.cmd || 'ql570') + " '" + device.device + "' " + (device.paperType || 'n')  + " '" + path + "'";
  } else if(device.type === 'dymoPrinter') {
    cmd = "lpr -P '"+device.device+"' '"+path+"'"
  }
  debug(cmd);

  childProcess.exec(cmd, function(err, stdout, stderr) {
    if(err) return cb(err);
    console.log("AAA", stdout, stderr);
    debug(stdout);
    debug(stderr);
    cb();
  });
}


var clientRPC = {
  identify: function(cb) {
    var devices = [];
    var i, device;
    for(i=0; i < settings.devices.length; i++) {
      device = settings.devices[i];
      devices.push({
        index: i,
        name: device.name,
        type: device.type
      })
    }

    cb(null, {
      id: nodeID,
      name: settings.name,
      devices: devices
    });
  },


  print: function(indexOrType, stream, cb) {
    var device;

    if(typeof indexOrType === 'string') {
      var i;
      for(i=0; i < settings.devices.length; i++) {
        if(settings.devices[i].type === indexOrType) {
          device = settings.devices[i];
          break;
        }
      }

      if(!device) return cb(new Error("No printer device of specified type found."));
    } else {
      device = settings.devices[index];
      if(!device) return cb(new Error("No device with index: " + index));
    }
    if(!device.type.match(/Printer$/)) return cb(new Error("This device is not a printer"));

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
      
      out.on('finish', function() {
        printLabel(device, path, function(err) {
          fs.unlink(path);
          cb(err);
        });
      });
    });
  }
};

var webcamScanning = false;

function webcamInit(cb) {
  childProcess.exec("v4l2-ctl -c brightness=100", function(err, stdout, stderr) {
    if(err) return cb(err);
    childProcess.exec("v4l2-ctl -c contrast=100", function(err, stdout, stderr) {
      if(err) return cb(err);
      webcamScanning = true;
      cb();
    });
  });
}

function webcamScan(cb) {
  var cmd = "streamer -q -c "+settings.device+" -f jpeg -s 1024x768 -o /dev/stdout | dmtxread -m 200 -N1 /dev/stdin";

  childProcess.exec(cmd, function(err, stdout, stderr) {
    if(err && stderr.length) console.error(err);
    if(!webcamScanning) return;
    var code = stdout.trim();
    if(code.length) {
      cb(null, code);
    }
    if(webcamScanning) {
      webcamScan(cb);
    }
  });
}

function webcamScanStart(remote) {

  webcamInit(function(err, cb) {
    if(err) return console.error(err);
    webcamScan(function(err, code) {
      if(err) return console.error(err);
      remote.reportScan(code);
    });
  });
}

function webcamScanStop() {
  webcamScanning = false;
}

var hidScanner;

function keyboardScanStart(remote) {
  try {
    var parts = settings.device.split(':');
    var dev = new HID.HID(parseInt(parts[0], 16), parseInt(parts[1], 16));
    hidScanner = dev;
  } catch(e) {
    console.error("Failed to open USB HID scanner:", e);
    console.error("Hint: You may need to be root or grant required permissions");
    return;
  }

  console.log("Initialized USB HID barcode scanner");

  dev.on('error', function(err) {
    console.error("Scanner error: " + err);
  });

  dev.on('data', function(data) {
    
    var str = scancodeDecode(data);
    if(str) {
      var i;
      for(i=0; i < str.length; i++) {
        dev.emit('char', str[i]);
      }
    }
  });
  
  var lineBuffer = '';

  dev.on('char', function(char) {
    lineBuffer += char;
    
    if(char == '\n') {
      dev.emit('line', lineBuffer.trim());
      lineBuffer = '';
    }
  });

  dev.on('line', function(code) {
    console.log("GOT:", code)
    remote.reportScan(code);
  });

}

function keyboardScanStop() {
  hidScanner.close();
}

function disconnect(conn) {
  conn.end();
  if(settings.deviceType === 'webcamScanner') {
    webcamScanStop();
    return;
  }
  if(settings.deviceType === 'keyboardScanner') {
    keyboardScanStop();
    return;
  }
}

function initDevices(remote) {
  var i, device;
  for(i=0; i < settings.devices.length; i++) {
    device = settings.devices[i];
    if(device.type === 'webcamScanner' && remote.reportScan) {
      webcamScanStart(remote);
      return;
    }
    if(device.type === 'keyboardScanner') {
      keyboardScanStart(remote);
      return;
    }
  }
}

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
        heartbeat: settings.heartbeatRate, // send heartbeat every 3000 ms
        maxMissedBeats: 3.5 // die after 3.5 times the above timeout
      });

      // if heartbeat fails
      client.on('death', function() {
        disconnect(conn);
        debug("heartbeat timeout. disconnecting");
        debug("will attempt reconnect in 3 seconds");
        setTimeout(connect, 3000);
      });

      client.pipe(stream).pipe(client);
      client.on('methods', initDevices);
    });
  });
  

  conn.on('error', function(err) {
    console.error("Connection error:", err);

    console.log("Attempting reconnect in 10 seconds");
    setTimeout(connect, 10 * 1000);
  });

}

connect();
