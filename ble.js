
var noble = require('noble');

// flic: 80:e4:da:7

function ble(opts) {
  opts = opts || {};
  opts.minRssi = opts.minRssi || -75;
  opts.checkFrequency = opts.checkFrequency || 500; // in ms
  opts.timeout = opts.timeout || 10000; // in ms

  this.opts = opts;
  this.running = false;

  this.nearby = {};

  this.checkTimes = function() {
    if(!this.running) return;

    var last = new Date().getTime() - this.opts.timeout;

    var address;
    for(address in nearby) {
      if(nearby[address] < last) {
        this.emit('depart', address);
        delete this.nearby[address];
      }
    }

    setTimeout(this.checkTimes.bind(this), this.opts.checkFrequency)
  };

  noble.on('discover', function(dev) {
    if(dev.addressType !== 'public') return;
    if(dev.rssi < this.opts.minRssi) return;

    if(!this.nearby[dev.address]) {
      this.emit('arrive', dev.address);
    }

    this.nearby[dev.address] = new Date().getTime();    
    
  }.bind(this))
  
  
  noble.on('stateChange', function(state) {
    if(state === 'poweredOn') {
      noble.startScanning([], true);
      this.running = true;
      setTimeout(this.checkTimes.bind(this), this.opts.checkFrequency);
    } else {
      noble.stopScanning();
      this.running = false;
    }
  }.bind(this));
}


module.exports = ble;
