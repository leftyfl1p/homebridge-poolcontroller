var Accessory, Service, Characteristic, UUIDGen, Homebridge;
var io = require('socket.io-client');
var socket;
var debug = true;
var circuitAccessory = require('./circuitAccessory.js');
var heaterAccessory = require('./heaterAccessory.js');

function fahrenheitToCelsius(fahrenheit) {
    return (fahrenheit - 32) * 5 / 9;
}

function celsiusToFahrenheit(celsius) {
    return celsius * 9 / 5 + 32;
}

function targetHeatingCoolingStateForHeatModeAndCircuitState(heatMode, circuitState) {
    if (heatMode && circuitState) {
        return Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (!heatMode && circuitState) {
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
    Homebridge = homebridge;

    homebridge.registerPlatform("homebridge-PoolControllerPlatform", "PoolControllerPlatform", PoolControllerPlatform, true);
};

function PoolControllerPlatform(log, config, api) {
    var self = this;
    log("Loading PoolControllerPlatform");
    self.log = log;
    self.config = config;
    self.accessories = {};

    //check config here.
    //check pool controller version

    if (api) {
        self.api = api;
        self.api.on('didFinishLaunching', self.socketInit.bind(this));
    }

}

PoolControllerPlatform.prototype.socketInit = function() {
    var self = this;
    socket = io.connect(self.config.ip_address, {
        secure: self.config.secure,
        reconnect: true,
        rejectUnauthorized: false
    });


    socket.on('one', function(data) {
        console.log('got data');
        self.InitialData(data); // will eventually change to 'all' instead of 'one'
    });

};

PoolControllerPlatform.prototype.InitialData = function(data) {

    socket.removeAllListeners("one");
    if (debug) this.log("InitialData:", data);
    var circuitData = data.circuits;

    console.log('circuitData.length', Object.keys(circuitData).length);

    for (var i in circuitData) {
        if (circuitData[i].name !== "NOT USED") {

            var circuitNumber = circuitData[i].number;
            var circuitFunction = circuitData[i].circuitFunction.toLowerCase();
            var circuitName = circuitData[i].friendlyName;
            var circuitState = circuitData[i].status;
            var id = "poolController." + circuitData[i].numberStr + "." + circuitName;  //added circuitName because circuit numbers will never change.  Changing the name will trigger a new UUID/device.

            var uuid = UUIDGen.generate(id);
            var cachedAccessory = this.accessories[uuid];

            // Used for when blacklisting is added to get circuit identifier.
            this.log("Found circuit " + circuitName + " with identifier: " + id);
            console.log('cachedAccessory', cachedAccessory)
            // Add heater accessory
            this.log("circuitFunction is " + circuitFunction);
            if (circuitFunction === "pool" || circuitFunction === "spa") {
              console.log('adding %s heater function', circuitFunction)
                var temperatures = data.temperatures;
                var heaterActive = temperatures.heaterActive;
                var targetHeatingCoolingState = targetHeatingCoolingStateForHeatModeAndCircuitState(heatMode, circuitState);
                var heatMode = temperatures[circuitFunction + "HeatMode"] == 1 ? 1 : 0; // Don't allow solar for now. Not sure how interface with that.
                var currentTemperature = temperatures[circuitFunction + "Temp"];
                var targetTemperature = temperatures[circuitFunction + "SetPoint"];

                if (cachedAccessory === undefined) {
                    this.addHeaterAccessory(this.log, id, circuitName, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, socket);
                } else {
                    this.accessories[uuid] = new heaterAccessory(this.log, cachedAccessory, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, Homebridge, socket); //change heatmode to heater active later
                }

            } else {
                // Add switch accessory
                // circuit type is generic, intellibrite, or spillway (?)
                if (cachedAccessory === undefined) {
                    this.addCircuitAccessory(this.log, id, circuitName, circuitNumber, circuitState, socket);
                } else {
                    this.accessories[uuid] = new circuitAccessory(this.log, cachedAccessory, circuitNumber, circuitState, Homebridge, socket);
                }
            }
        }
    }

    socket.on('circuit', this.socketCircuitUpdated.bind(this));
};

PoolControllerPlatform.prototype.socketCircuitUpdated = function(circuitData) {
    //if (debug) this.log('FROM SOCKET CLIENT CIRCUIT: ' + JSON.stringify(circuitData, null, "\t"));

    for (var i = 1; i <= Object.keys(circuitData).length; i++) {
      //console.log("Analyzing circuit %s of %s", i, Object.keys(circuitData).length)
        if (circuitData[i].numberStr !== undefined || circuitData[i].name !== "NOT USED") {
            var id = "poolController." + circuitData[i].numberStr + "." + circuitData[i].name;  //added circuitName because circuit numbers will never change.  Changing the name will trigger a new UUID/device.
            var uuid = UUIDGen.generate(id);
            var accessory = this.accessories[uuid];
            var circuit = circuitData[i].number;
            var circuitState = circuitData[i].status;
            if (accessory !== undefined) {
                accessory.updateCircuitState(circuitState); // All accessories should have a circuit state associated to them.
            }
        }
    }
};

PoolControllerPlatform.prototype.configureAccessory = function(accessory) {
    accessory.reachable = false; // Don't allow accessories to be controlled until we associate circuits/circuitState to them.
    this.accessories[accessory.UUID] = accessory; // Throw it into dictionary to be updated with initial data.
    console.log('accessory.UUID (%s) added to local current array from cache', accessory.displayName);
};

PoolControllerPlatform.prototype.addCircuitAccessory = function(log, identifier, accessoryName, circuit, power, socket) {
    this.log("Adding new circuit accessory with name " + accessoryName);
    var uuid = UUIDGen.generate(identifier);
    var accessory = new Accessory(accessoryName, uuid);
    accessory.addService(Service.Switch, accessoryName);

    this.accessories[uuid] = new circuitAccessory(log, accessory, circuit, power, Homebridge, socket);
    this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);

    //get this info from socket? does it matter? also model and serial.
    accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");

};

PoolControllerPlatform.prototype.addHeaterAccessory = function(log, identifier, accessoryName, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, socket) {
    this.log("Adding new heater accessory with name " + accessoryName);
    var uuid = UUIDGen.generate(identifier);
    var accessory = new Accessory(accessoryName, uuid);
    accessory.addService(Service.Thermostat, accessoryName);

    this.accessories[uuid] = new heaterAccessory(log, accessory, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, Homebridge, socket);
    this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);
};
