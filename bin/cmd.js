#!/usr/bin/env node

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const minimist = require('minimist');
const backoff = require('backoff');
const ndjson = require('ndjson');
const tmp = require('tmp');
const uuid = require('uuid').v4;
const rpc = require('rpc-multistream');
var HID; // included on demand

const scancodeDecode = require('../scancode_decode.js');

const argv = minimist(process.argv.slice(2), {
  alias: {
    D: 'debug',
    p: 'port',
    h: 'host',
    d: 'device',
    i: 'insecure',
    c: 'cmd'
  },
  boolean: [
    'debug'
  ],
default: {
}
});

const settings = require('../settings.js');
settings.hostname = argv.hostname || settings.hostname;
settings.port = argv.port || settings.port;
settings.device = argv.device || settings.device;
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

function printLabel(device, path, copies, cb) {
  copies = parseInt(copies);
  if(!copies || copies < 1 || copies > 20) {
    return cb(new Error("Invalid or disallowed number of copies"));
  }
  console.log("On device '"+device.name+"' printing:", path);

  var cmd;

  if(device.type === 'qlPrinter') {
    cmd = (device.cmd || 'ql570') + " '" + device.device + "' " + (device.paperType || 'n')  + " " + (device.args || '') + " '" + path + "'";
    
    if(device.supportsCopies) {
      device.supportsCopies = false;
    }

  } else if(device.type === 'dymoPrinter') {

    var args = (device.args || '');
    if(device.supportsCopies) {
      args += ' -# '+copies;
    }
    cmd = (device.cmd || 'lpr') + " -P '"+device.device+"' "+args+" '"+path+"'"
  }
  
  debug(cmd);

  childProcess.exec(cmd, {}, function(err, stdout, stderr) {
    if(err) return cb(err);
    debug(stdout);
    debug(stderr);
    if(!device.supportsCopies && --copies) {
      printLabel(device, path, copies, cb);
    }
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


  print: function(indexOrType, streamOrBuffer, copies, cb) {
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
      device = settings.devices[indexOrType];
      if(!device) return cb(new Error("No device with index: " + indexOrType));
    }
    if(!device.type.match(/Printer$/)) return cb(new Error("This device is not a printer"));

    tmp.tmpName(function(err, path) {
      if(err) return cb(err);

      var out;
      
      function fileWritten() {
        printLabel(device, path, copies || 1, function(err) {
          if(err) console.error(err);
          fs.unlink(path, cb);
        });
      }

      function fileWriteError(err) {
        console.error("error writing temporary file:", err);
        if(out) {
          out.close();
        }
        fs.unlink(path, cb);
      }
      
      debug("opened temporary file: " + path);

      if(streamOrBuffer.type === 'Buffer' && streamOrBuffer.data) {
        streamOrBuffer = Buffer.from(streamOrBuffer.data);
      }
      
      // If we got a buffer
      if(streamOrBuffer instanceof Buffer) {
        fs.writeFile(path, streamOrBuffer, function(err) {
          if(err) return fileWriteError(err);
          fileWritten();
        });
      } else { // If we got a stream
        var out = fs.createWriteStream(path);
        out.on('error', fileWriteError);
        out.on('finish', fileWritten);
        streamOrBuffer.pipe(out);
      }

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
    if(!HID) {
      HID = require('node-hid');
    }
    
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

function disconnect() {
  
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


function connectOnce(host, port, cb) {
  console.log("Connecting to: "+host+":"+port);

  var opts = {
    ca: settings.serverTLSCert, // only trust this cert
    key: settings.tlsKey,
    cert: settings.tlsCert
  };

  if(argv.insecure) {
    opts.rejectUnauthorized = false;
  }
  
  var socket = tls.connect(port, host, opts)
 
  socket.on('secureConnect', function() {
    cb();
    
    console.log("Connected!");
    const client = rpc(clientRPC, {
      heartbeat: settings.heartbeatRate, // send heartbeat every 3000 ms
      maxMissedBeats: 3.5 // die after 3.5 times the above timeout
    });
    
    // if heartbeat fails
    client.on('death', function() {
      debug("heartbeat timeout. disconnecting");
      debug("will attempt reconnect in 3 seconds");
      socket.end();
    });
    
    client.pipe(socket).pipe(client);
    
    client.on('methods', initDevices);
  });
  

  socket.on('error', function(err) {
    console.error("Connection error:", err);

  });

  socket.on('close', function() {
    cb(true);
    console.log("socket closed");
  });
  
}

function connect(host, port) {

  // Retry with increasing back-off 
  var back = backoff.fibonacci({
    randomisationFactor: 0,
    initialDelay: 3 * 1000, // 3 seconds
    maxDelay: 30 * 1000
  });
  
  var count = 0;
  function tryConnect() {
    connectOnce(host, port, function(disconnected) {
      if(disconnected) {
        if(count > 0) {
          back.backoff();
          return;
        }
        process.nextTick(tryConnect);
        count++;
      } else {
        count = 0;
        back.reset();
      }
    });
  }
  
  tryConnect();
  
  back.on('backoff', function(number, delay) {
    console.log("Retrying in", Math.round(delay / 1000), "seconds");  
  });

  back.on('ready', function(number, delay) {
    tryConnect();
  });  
}


connect(settings.host, settings.port);
