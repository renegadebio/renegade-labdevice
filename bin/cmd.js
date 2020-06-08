#!/usr/bin/env node

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const minimist = require('minimist');
const ndjson = require('ndjson');
const tmp = require('tmp');
const uuid = require('uuid').v4;
const JSONC = require('comment-json');
const rpc = require('rpc-multistream');
var HID; // included on demand

const limsConnector = require('renegade-lims-connector');

const scancodeDecode = require('../scancode_decode.js');

const devicesFilePath = path.join(__dirname, '..', 'devices.json');

var devices;

const argv = minimist(process.argv.slice(2), {
  alias: {
    D: 'debug',
    p: 'port',
    h: 'host',
    d: 'device',
    c: 'cmd'
  },
  boolean: [
    'debug',
    'insecure', // don't validate TLS certs
    'keep', // don't delete temporary image files
    'pretend' // don't actually print
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
settings.devPrintersPath = settings.devPrintersPath || '/dev/printers';

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
  console.log("On device '"+device.name+"' printing", copies, "copies of:", path);
  if(argv.pretend) {
    return cb();
  }

  var cmd;

  var args = (device.args || '') + ' ' + (device.labels.args || '');
  
  if(device.type === 'qlPrinter') {
    cmd = (device.cmd || 'ql570') + " '" + device.dev + "' " + (device.labels.type || 'n')  + " " + args + " '" + path + "'";
    
    if(device.supportsCopies) {
      device.supportsCopies = false;
    }

  } else if(device.type === 'cupsPrinter') {

    if(device.supportsCopies) {
      args += ' -# '+copies;
    }
    cmd = (device.cmd || 'lpr') + " -P '"+device.dev+"' "+args+" '"+path+"'"
  }
  
  debug("Running command: " + cmd);

  childProcess.exec(cmd, {}, function(err, stdout, stderr) {
    if(err) return cb(err);
    if(stdout) {
      debug("command stdout: " + stdout);
    }
    if(stderr) {
      debug("command stderr: " + stderr);
    }
    if(!device.supportsCopies && --copies) {
      printLabel(device, path, copies, cb);
    } else {
      cb();
    }
  });
}

function writeDevicesFile(devices, cb) {
  try {
    var data = JSONC.stringify(devices);
  } catch(e) {
    return cb(e);
  }
  
  tmp.tmpName(function(err, tmpPath) {
    if(err) return cb(err);
    
    fs.writeFile(tmpPath, data, {encoding: 'utf8'}, function(err) {
      if(err) return cb(err);

      fs.rename(tmpPath, devicesFilePath, cb);
    });
  });
}

function listBrotherPrinters(cb) {
  var r = new RegExp(/^brother/i);

  // TODO implement
  fs.readdir(settings.devPrintersPath, function(err, files) {
    if(err) return cb(err);

    var printers = [];
    var m, devFile;
    for(let file of files) {
      m = file.match(r);
      if(!m) continue;

      devFile = m[1];
      
      printers.push({
        dev: path.join(settings.devPrintersPath, devFile),
        name: devFile.replace(/_+/, ' ')
      });
    }

    cb(null, printers);
  });
}

function nicifyPrinterName(printerName) {

  printerName = printerName.replace(/_+/g, ' ');
  var parts = printerName.split(/-+/);

  // For e.g. the name "DYMO-DYMO LabelWriter 450-01234"
  // get rid of the first 'DYMO'
  if(parts.length > 1 && parts[1].length > parts[0].length) {
    if(parts[0].toLowerCase() === parts[1].toLowerCase().slice(0, parts[0].length)) {
      parts[1] = parts[1].slice(parts[0].length);
    }
  }
  printerName = parts.join(' - ');
  printerName = printerName.replace(/\s+/g, ' ');

  return printerName;
}

function listCUPSPrinters(cb) {
  var rDev = new RegExp(":\\s+"+settings.devPrintersPath);
  var rName = new RegExp("device for ([^:]+):", 'i');

  var printers = [];
  
  childProcess.exec("lpstat -v", {}, function(err, stdout, stderr) {
    if(err) return cb(err);

    var m, printerName;
    var lines = stdout.split(/\r?\n/);
    for(let line of lines) {
      if(!line.match(rDev)) continue;
      m = line.match(rName);
      if(!m) continue;

      printerName = m[1];
      
      printers.push({
        dev: printerName,
        name: nicifyPrinterName(printerName)
      });
    }

    cb(null, printers);
  });
}

function getDeviceByDev(dev) {
  for(let device of devices) {
    if(device.dev === dev) {
      return device;
    }
  }
  return null;
}

function getAllPrinters(cb) {
  listBrotherPrinters(function(err, brotherPrinters) {
    if(err) return cb(err);

    listCUPSPrinters(function(err, cupsPrinters) {
      if(err) return cb(err);

      var printers = brotherPrinters.concat(cupsPrinters);

      cb(null, printers);
    });
  });
}

// printer has printer.dev and printer.type 
// label has label.name and (label.type for brother or label.arg for dymo)
function installPrinter(printer, label, name, opts,  cb) {
  if(!printer.type) return cb(new Error("Printer type not specified"));
  if(!printer.dev) return cb(new Error("No CUPS printer name nor device path specified"));
  
  if(!name) return cb(new Error("No printer name specified"));

  if(!label || !label.name) return cb(new Error("No label specified"));

  printer.name = name.replace(/'/g, '');

  if(printer.type === 'ql') {
    printer.cmd = settings.ql570Path || 'ql570';
    
    if(!label.type) return cb(new Error("No label type specified"));
    
  } else if(printer.type === 'cups') {
    printer.cmd = settings.lprPath || 'lpr';
    
    printer.supportsCopies = opts.supportsCopies;
    
  } else {
    return cb(new Error("Cannot install printer: Unknown printer type: " + printer.type));
  }
  
  printer.labels = label;

  devices.push(printer);

  writeDevicesFile(devices, cb);
}

var clientRPC = {
  identify: function(cb) {
    var devices = [];
    var i, device;
    for(i=0; i < devices.length; i++) {
      device = devices[i];
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

  listLabelTypes: function(printerType, cb) {
    if(!printerType) return cb(new Error("printerType must be specified"));
    if(!settings.labelTypes) return cb(new Error("labdevice settings do not specify any label types"));
    
    var labelTypes = [];
    var types = settings.labelTypes[printerType];
    if(!types) return cb(new Error("No label types found for printer type: " + printerType));

    for(let type of types) {
      if(!type.name) continue;
      labelTypes.push(type.name);
    }
    cb(null, labelTypes);
  },

  listInstallablePrinters: getAllPrinters,

  // printerType is 'ql' or 'cups'
  // devFileOrName is a '/dev/printers/' path
  installPrinter: function(printerType, devFileOrName, labelTypeName, name, opts, cb) {
    // TODO implement
    if(getDeviceByDev(devFileOrName)) {
      return cb(new Error("Device is already installed"));
    }

    getAllPrinters(function(err, printers) {
      if(err) return cb(err);

      var toInstall;
      for(let printer of printers) {
        if(printer.dev === devFileOrName && printer.type === printerType) {
          toInstall = printer;
          break;
        }
      }
      if(!toInstall) {
        return cb(new Error("No such printer available"));
      }

      var label;
      var labelTypes = settings.labelTypes[printerType];
      if(!labelTypes) {
        return cb(new Error("No label types defined for printer type: " + printerType));
      }

      for(let labelType of labelTypes) {
        if(labelType.name === labelTypeName) {
          label = labelType;
          break;
        }
      }
      if(!label) {
        cb(new Error("No such label type defined: " + labelTypeName));
      }
      
      installPrinter(toInstall, label, name, opts, cb);
    });
  },

  // for changing a device, e.g. changing the device name or paper type
  saveDevice: function(deviceName, device, cb) {
    return cb(new Error("TODO not yet implemented"));
  },

  removeDevice: function(deviceName, cb) {
    return cb(new Error("TODO not yet implemented"));
  },
  
  print: function(indexOrType, streamOrBuffer, copies, cb) {
    var device;
    
    if(typeof indexOrType === 'string') {
      var i;
      for(i=0; i < devices.length; i++) {
        if(devices[i].type === indexOrType) {
          device = devices[i];
          break;
        }
      }

      if(!device) return cb(new Error("No printer device of specified type found."));
    } else {
      device = devices[indexOrType];
      if(!device) return cb(new Error("No device with index: " + indexOrType));
    }
    if(!device.type.match(/Printer$/)) return cb(new Error("This device is not a printer"));

    tmp.tmpName(function(err, path) {
      if(err) return cb(err);

      var out;
      
      function fileWritten() {
        debug("File was written: " + path);
        printLabel(device, path, copies || 1, (err) => {
          if(err) console.error(err);
          if(!argv.keep) {
            debug("Deleting file: " + path);
            fs.unlink(path, cb);
          } else {
            cb();
          }
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

  try{
    var str = fs.readFileSync(devicesFilePath, {encoding: 'utf8'});
    devices = JSONC.parse(str);
  } catch(e) {
    console.error("Error reading devices.json. No devices loaded");
    console.error(e);
    devices = [];
  }
  
  var i, device;
  for(i=0; i < devices.length; i++) {
    device = devices[i];
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


settings.clientRPC = clientRPC;
if(argv.insecure) {
  settings.insecure = true;
}
if(argv.debug) {
  settings.debug = true;
}

limsConnector(settings, function(err, remote) {
  if(remote) { // connected!
    
    initDevices(remote);
    
  } else { // disconnected (after having been connected)
    // TODO uninitialize devices
    console.log("Disconnected");
  }
});
