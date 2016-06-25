#!/usr/bin/env node

var fs = require('fs');
var childProcess = require('child_process');
var ssh2 = require('ssh2');
var minimist = require('minimist');
var ndjson = require('ndjson');
var tmp = require('tmp');

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

var lastBeat;

function gotHeartbeat(fake) {
    if(!fake) debug("received heartbeat from server");
    lastBeat = new Date();
}

function heartbeat(outStream, cb) {

    var diff = (new Date() - lastBeat) / 1000;
    
    if(diff > (settings.heartbeatRate * 3 + 1)) {
        cb("Missed three heartbeat responses in a row");
        return;
    }

    outStream.write({type: 'heartbeat'});
    debug("sent heartbeat");

    setTimeout(function() {
        heartbeat(outStream, cb);
    }, settings.heartbeatRate * 1000);
}


function printLabel(path, cb) {

    console.log("Printing:", path);

    var cmd = settings.cmd + ' ' + settings.device + ' n ' + path;

    childProcess.exec(cmd, function(err, stdout, stderr) {
        if(err) return cb(err);
//        fs.unlink(path, function(unlinkErr) {

            cb();
//        });
    });
}

function getLabel(filename, cb) {

    conn.exec('getLabel ' + filename, function(err, stream) {
        if(err) return console.error(err);
        var errBuf;

        // generate unique temporary file name
        tmp.tmpName(function(err, path) {
            if(err) return cb(err);

            var out = fs.createWriteStream(path);
            debug("opened temporary file: " + path);

            out.on('error', function(err) {
                console.error("error writing temporary file:", err);
                out.close();
                fs.unlink(path);
                cb(err);
            });

            stream.pipe(out);
            
            stream.stderr.on('data', function(data) {
                if(errBuf) {
                    errBuf = Buffer.concat([errBuf, data]);
                } else {
                    errBuf = data;
                }
            });
            var fail = false;
            stream.on('close', function(code, signal) {
                if(code) {
                    console.error("Server error:", errBuf.toString('utf8'));
                    fs.unlink(path);
                    fail = true;
                }
            });
            out.on('finish', function() {
                if(fail) return;
                cb(null, path);
            });
        })
    });

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

        conn.exec('msgChannel ' + settings.name, function(err, stream) {
            if(err) return console.error(err);
            var input = stream.pipe(ndjson.parse());
            var output = ndjson.serialize();
            output.pipe(stream);

            gotHeartbeat(true);
            
            input.on('data', function(msg) {
                if(msg.type === 'heartbeat') return gotHeartbeat();

                if(msg.type === 'print' && msg.filename) {
                    getLabel(msg.filename, function(err, path) {
                        if(err) return console.error(err);
                        

                        printLabel(path, function(err) {
                            if(err) console.error(err);
                            console.log("Sent label to printer:", msg.filename);
                            // ToDo tell server 
                        });
                    });
                } else {
                    console.error("Got unknown message of type:", msg.type);
                }
            });

            heartbeat(output, function(err) {
                if(err) {
                    conn.end();
                    console.error("Disconnected:", err);
                    console.log("Attempting reconnect in 10 seconds");
                    setTimeout(connect, 10 * 1000);
                }
            });
        });
    });
    

    conn.on('error', function(err) {
        console.error("Connection error:", err);
    });

}

connect();
