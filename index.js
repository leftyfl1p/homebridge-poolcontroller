var Accessory, Service, Characteristic, UUIDGen;
var io = require('socket.io-client');
var socket;


module.exports = function(homebridge) {
  //check homebridge version

  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  
  homebridge.registerPlatform("homebridge-PoolControllerPlatform", "PoolControllerPlatform", PoolControllerPlatform, true);
};

function PoolControllerPlatform(log, config, api) {
  log("PoolControllerPlatform Init");
  var platform = this;
  this.log = log;
  this.config = config;
  this.accessories = {};

  socket = io.connect(config["ip_address"], {secure: config["secure"], reconnect: true, rejectUnauthorized : false});
  this.log(socket.connected);
  //check config here.
  //check pool controller version

  if (api) {
      this.api = api;
      
      this.api.on('didFinishLaunching', function() {
        platform.log("DidFinishLaunching");
        socket.on('circuit', platform.socketCircuitUpdated.bind(this)); // do this after adding all cached accessoriess
      }.bind(this));
  }

};


PoolControllerPlatform.prototype.socketCircuitUpdated = function(data) {
  this.log("socketCircuitUpdated");
  //this.log('FROM SOCKET CLIENT CIRCUIT: ' + JSON.stringify(data, null, "\t"));

  for (var i = 0; i < data.length; i++) {
    var accessoryName = data[i].name;
    if (accessoryName != undefined) {
      var uuid = UUIDGen.generate(accessoryName);
      var accessory = this.accessories[uuid];
      var circuit = data[i].number;
      var powerState = data[i].status;
      if (this.accessories[uuid] != undefined) {
        //handle cached accessories
        if(accessory instanceof Accessory) { //ideally do this somewhere different. only needs to be done once.
          this.accessories[uuid] = new PoolCircuitAccessory(this.log, accessory, circuit, powerState);
          accessory = this.accessories[uuid];
        }
        accessory.setState(powerState);

      } else {
        this.addAccessory(this.log, accessoryName, circuit, powerState);
      };
    
    };

  }

};


PoolControllerPlatform.prototype.configureAccessory = function(accessory) {
  this.log("Configuring Accessory with name", accessory.displayName);
  accessory.reachable = false; // dont allow accessories to be controlled until we associate circuits/powerstate to them
  this.accessories[accessory.UUID] = accessory; // throw it into dict to be updated later
};

PoolControllerPlatform.prototype.addAccessory = function(log, accessoryName, circuit, power) {
  this.log("Adding accessory with name " + accessoryName);
  var platform = this;
  var uuid = UUIDGen.generate(accessoryName);
  var accessory = new Accessory(accessoryName, uuid);
  accessory.addService(Service.Switch, accessoryName);

  this.accessories[uuid] = new PoolCircuitAccessory(log, accessory, circuit, power);
  this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);

  //get this info from socket? does it matter? also model and serial.
  accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");
  
};


function PoolCircuitAccessory(log, accessory, circuit, powerState) {
  this.accessory = accessory;
  this.log = log;
  this.circuit = circuit;
  this.powerState = powerState;
  this.service = this.accessory.getService(Service.Switch);

  if (this.service) {
    this.service
    .getCharacteristic(Characteristic.On)
    .on('set', this.setPowerOn.bind(this))
    .on('get', this.getPowerOn.bind(this));
  }

  accessory.updateReachability(true);

};

PoolCircuitAccessory.prototype.setPowerOn = function(powerState, callback) {
  if (this.powerState != powerState) {
    this.log("Setting Circuit", this.accessory.displayName, "to", powerState);
    socket.emit("toggleCircuit", this.circuit);
    this.setState(powerState);
  }
  
  callback();

};

PoolCircuitAccessory.prototype.getPowerOn = function(callback) {
  callback(null, this.powerState);
};

//for when power is changed elsewhere
PoolCircuitAccessory.prototype.setState = function(powerState) {
  this.powerState = powerState;

  this.service
  .getCharacteristic(Characteristic.On).updateValue(this.powerState);

};

