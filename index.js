var Accessory, Service, Characteristic, UUIDGen;
var io = require('socket.io-client');
var socket;
var debug = false;

function fahrenheitToCelsius (fahrenheit) {
  return (fahrenheit - 32) * 5/9;
}

function celsiusToFahrenheit (celsius) {
  return celsius * 9/5 + 32;
}

function targetHeatingCoolingStateForHeatModeAndCircuitState (heatMode, circuitState) {
  if (heatMode && circuitState) {
    return Characteristic.TargetHeatingCoolingState.HEAT;
  } else if(!heatMode && circuitState) {
    return Characteristic.TargetHeatingCoolingState.AUTO;
  }

  return Characteristic.TargetHeatingCoolingState.OFF;
};

module.exports = function(homebridge) {
  //check homebridge version

  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  
  homebridge.registerPlatform("homebridge-PoolControllerPlatform", "PoolControllerPlatform", PoolControllerPlatform, true);
};

function PoolControllerPlatform(log, config, api) {
  log("Loading PoolControllerPlatform");
  this.log = log;
  this.config = config;
  this.accessories = {};

  socket = io.connect(config["ip_address"], {secure: config["secure"], reconnect: true, rejectUnauthorized : false});
  //check config here.
  //check pool controller version

  if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', function() {
        socket.on('one', this.InitialData.bind(this)); // will eventually change to 'all' instead of 'one'
      }.bind(this));
  }

};

PoolControllerPlatform.prototype.InitialData = function(data) {
  socket.removeAllListeners("one");
  if(debug) this.log("InitialData:", data);
  var circuitData = data.circuits;

  for (var i = 0; i < circuitData.length; i++) {
    if (circuitData[i].numberStr != undefined) {

      var id = "poolController." + circuitData[i].numberStr;
      var uuid = UUIDGen.generate(id);
      var cachedAccessory = this.accessories[uuid];
      var circuitNumber = circuitData[i].number;
      var circuitFunction = circuitData[i].circuitFunction.toLowerCase();
      var circuitName = circuitData[i].name;
      var circuitState = circuitData[i].status;

      // Used for when blacklisting is added to get circuit identifier.
      this.log("Found circuit " + circuitName + " with identifier: " + circuitData[i].numberStr);

      // Add heater accessory
      if (circuitFunction == "pool" || circuitFunction == "spa") {
        var temperatures = data.temperatures;
        var heaterActive = temperatures.heaterActive;
        var targetHeatingCoolingState = targetHeatingCoolingStateForHeatModeAndCircuitState(heatMode, circuitState);
        var heatMode = temperatures[circuitFunction + "HeatMode"] == 1? 1:0; // Don't allow solar for now. Not sure how interface with that.
        var currentTemperature = temperatures[circuitFunction + "Temp"];
        var targetTemperature = temperatures[circuitFunction + "SetPoint"];

        if (cachedAccessory == undefined) {
          this.addHeaterAccessory(this.log, id, circuitName, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature);
        } else {
          this.accessories[uuid] = new HeaterAccessory(this.log, cachedAccessory, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature); //change heatmode to heater active later
        }

      } else {
        // Add switch accessory
        // circuit type is generic, intellibrite, or spillway (?)
        if (cachedAccessory == undefined) {
          this.addCircuitAccessory(this.log, id, circuitName, circuitNumber, circuitState);
        } else {
          this.accessories[uuid] = new PoolCircuitAccessory(this.log, cachedAccessory, circuitNumber, circuitState);
        }
      }
    }
  }

  socket.on('circuit', this.socketCircuitUpdated.bind(this));
};

PoolControllerPlatform.prototype.socketCircuitUpdated = function(circuitData) {
  if(debug) this.log('FROM SOCKET CLIENT CIRCUIT: ' + JSON.stringify(circuitData, null, "\t"));

  for (var i = 0; i < circuitData.length; i++) {
    if (circuitData[i].numberStr != undefined) {
      var id = "poolController." + circuitData[i].numberStr;
      var uuid = UUIDGen.generate(id);
      var accessory = this.accessories[uuid];
      var circuit = circuitData[i].number;
      var circuitState = circuitData[i].status;
      if (accessory != undefined) {
        accessory.updateCircuitState(circuitState); // All accessories should have a circuit state associated to them.
      }
    }
  }
};

PoolControllerPlatform.prototype.configureAccessory = function(accessory) {
  accessory.reachable = false; // Don't allow accessories to be controlled until we associate circuits/circuitState to them.
  this.accessories[accessory.UUID] = accessory; // Throw it into dictionary to be updated with initial data.
};

PoolControllerPlatform.prototype.addCircuitAccessory = function(log, identifier, accessoryName, circuit, power) {
  this.log("Adding new circuit accessory with name " + accessoryName);
  var uuid = UUIDGen.generate(identifier);
  var accessory = new Accessory(accessoryName, uuid);
  accessory.addService(Service.Switch, accessoryName);

  this.accessories[uuid] = new PoolCircuitAccessory(log, accessory, circuit, power);
  this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);

  //get this info from socket? does it matter? also model and serial.
  accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");
  
};

PoolControllerPlatform.prototype.addHeaterAccessory = function(log, identifier, accessoryName, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature)  {
  this.log("Adding new heater accessory with name " + accessoryName);
  var uuid = UUIDGen.generate(identifier);
  var accessory = new Accessory(accessoryName, uuid);
  accessory.addService(Service.Thermostat, accessoryName);

  this.accessories[uuid] = new HeaterAccessory(log, accessory, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature);
  this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);
};


function PoolCircuitAccessory(log, accessory, circuit, circuitState) {
  this.accessory = accessory;
  this.log = log;
  this.circuit = circuit;
  this.circuitState = circuitState;
  this.service = this.accessory.getService(Service.Switch);

  if (this.service) {
    this.service
    .getCharacteristic(Characteristic.On)
    .on('set', this.setCircuitState.bind(this))
    .on('get', this.getCircuitState.bind(this));
  }

  accessory.updateReachability(true);
};

PoolCircuitAccessory.prototype.setCircuitState = function(circuitState, callback) {
  if (this.circuitState != circuitState) {
    this.log("Setting Circuit", this.accessory.displayName, "to", circuitState);
    socket.emit("toggleCircuit", this.circuit);
    this.updateCircuitState(circuitState);
  }
  
  callback();

};

PoolCircuitAccessory.prototype.getCircuitState = function(callback) {
  callback(null, this.circuitState);
};

// For when state is changed elsewhere.
PoolCircuitAccessory.prototype.updateCircuitState = function(circuitState) {
  this.circuitState = circuitState;

  this.service
  .getCharacteristic(Characteristic.On).updateValue(this.circuitState);

};

function HeaterAccessory(log, accessory, circuitFunction, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature) {
  this.accessory = accessory;
  this.log = log;
  this.circuit = circuit;
  this.circuitState = circuitState;
  this.currentHeatingCoolingState;
  this.currentTemperature = fahrenheitToCelsius(currentTemperature);
  this.targetHeatingCoolingState = targetHeatingCoolingState;
  this.targetTemperature = fahrenheitToCelsius(targetTemperature);
  this.circuitFunction = circuitFunction; // 'pool' or 'spa'
  this.heatMode = heatMode;

  this.service = this.accessory.getService(Service.Thermostat);
  accessory.updateReachability(true);

  if (this.service) {
    this.service
    .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .on('get', this.getCurrentHeatingCoolingState.bind(this));

    this.service
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .on('set', this.setTargetHeatingCoolingState.bind(this))
    .on('get', this.getTargetHeatingCoolingState.bind(this));

    // disable until setpoint sockets are fixed
    // this.service
    // .getCharacteristic(Characteristic.TargetTemperature)
    // .on('set', this.setTargetTemperature.bind(this))
    // .on('get', this.getTargetTemperature.bind(this));

    this.service
    .getCharacteristic(Characteristic.CurrentTemperature)
    .on('get', this.getCurrentTemperature.bind(this));


    this.service
    .getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .on('get', this.getTemperatureDisplayUnits.bind(this));
  }

  // Subscribe to temperature updates.
  socket.on('temp', this.socketTemperaturesUpdated.bind(this));
}

HeaterAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
  if (callback) callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
};

HeaterAccessory.prototype.setTargetHeatingCoolingState = function(targetHeatingCoolingState, callback) {
  this.targetHeatingCoolingState = targetHeatingCoolingState;

  var targetHeatMode = 0;
  var targetCircuitState = 0;

  // Off.
  if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF) {
    targetHeatMode = 0;
    targetCircuitState = 0;
  }

  // Heating turns on the circuit and sets the heater to heat mode.
  else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.HEAT) {
    targetHeatMode = 1;
    targetCircuitState = 1;
  }

  // Set the state to off when user tries to set the target state to cooling.
  else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.COOL) {
    targetHeatMode = 0;
    targetCircuitState = 0;
    this.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF; // no coolers here
  }

  // Auto turns on the pump but not the heat.
  else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.AUTO) {
    targetHeatMode = 0;
    targetCircuitState = 1;
  }

  socket.emit(this.circuitFunction + "heatmode", targetHeatMode);
  // set pump to target state
  if (this.circuitState != targetCircuitState) {
    socket.emit("toggleCircuit", this.circuit);
  }
  
  if (callback) callback(null, this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.updateTargetHeatingCoolingState = function() {
  this.targetHeatingCoolingState = targetHeatingCoolingStateForHeatModeAndCircuitState(this.heatMode, this.circuitState);

  this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
  if (callback) callback(null, this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
  if (callback) callback(null, this.currentHeatingCoolingState);
};

HeaterAccessory.prototype.setTargetTemperature = function(targetTemperature, callback) {
  //this.log("setTargetTemperature: " + celsiusToFahrenheit(targetTemperature));
  this.targetTemperature = targetTemperature;
  socket.emit(this.circuitFunction + "setpoint", celsiusToFahrenheit(this.targetTemperature));
  if (callback) callback(null, this.targetTemperature);
};

HeaterAccessory.prototype.getTargetTemperature = function(callback) {
  this.log("TARGET TEMPERATURE: " + this.targetTemperature);
  if (callback) callback(null, this.targetTemperature > 100? 100: this.targetTemperature); // HomeKit/the home app doesn't understand target temperatures >100.
};

HeaterAccessory.prototype.getCurrentTemperature = function(callback) {
  if (callback) callback(null, this.currentTemperature);
};

HeaterAccessory.prototype.socketTemperaturesUpdated = function(data) {
    this.heatMode = data[this.circuitFunction + "HeatMode"] == 1? 1:0; // data.heaterActive; broken right now so change later

    var currentTemperature = data[this.circuitFunction + "Temp"];
    var targetTemperature = data[this.circuitFunction + "SetPoint"];
  
    this.currentTemperature = fahrenheitToCelsius(currentTemperature);
    this.targetTemperature = fahrenheitToCelsius(targetTemperature);

    this.updateTargetHeatingCoolingState();
    this.updateCurrentHeatingCoolingState();
};

HeaterAccessory.prototype.updateCurrentHeatingCoolingState = function() {
  if(this.heatMode && this.circuitState) {
    this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;
  } else {
    this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
  }

  this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentHeatingCoolingState);
};

HeaterAccessory.prototype.updateCircuitState = function(circuitState) {
  this.circuitState = circuitState;

  this.updateTargetHeatingCoolingState();
  this.updateCurrentHeatingCoolingState();
};

