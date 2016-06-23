#!/usr/bin/env node

var fs = require('fs');
var ssh2 = require('ssh2');
var minimist = require('minimist');

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


var conn = new ssh2.Client();

conn.on('ready', function() {
    console.log("Connected!");
    conn.exec('getLabel', function(err, stream) {
        if(err) return console.error(err);
        stream.on('data', function(data) {
            console.log("got:", data);
            stream.write("Thanks!");
        });
    });
});
 

conn.on('error', function(err) {
    console.error("Connection error:", err);
});

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
