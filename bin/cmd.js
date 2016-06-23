#!/usr/bin/env node

var fs = require('fs');
var buffersEqual = require('buffer-equal-constant-time');
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


var pubKey = ssh2.utils.genPublicKey(ssh2.utils.parseKey(fs.readFileSync(settings.pubkey)));


