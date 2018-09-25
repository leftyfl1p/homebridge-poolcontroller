var Accessory, Service, Characteristic, UUIDGen, Homebridge;
var io = require('socket.io-client');
var ssdp = require('node-ssdp').Client
var socket;
var debug = false;
var circuitAccessory = require('./circuitAccessory.js');
var lightAccessory = require('./lightAccessory.js');
var heaterAccessory = require('./heaterAccessory.js');

function targetHeatingCoolingStateForHeatModeAndCircuitState(heatMode, circuitState) {
    if (heatMode && circuitState) {
        return Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (!heatMode && circuitState) {
        return Characteristic.TargetHeatingCoolingState.AUTO;
    }

    return Characteristic.TargetHeatingCoolingState.OFF;
};

module.exports = function (homebridge) {
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
        self.api.on('didFinishLaunching', self.SSDPDiscovery.bind(this));
    }

}

PoolControllerPlatform.prototype.SSDPDiscovery = function () {
    var self = this
    var elapsedTime = 0;
    if (self.config.ip_address === '*') {
        var client = new ssdp({})
        self.log('Starting UPnP search for PoolController.')

        client.on('response', function inResponse(headers, code, rinfo) {
            //console.log('Got a response to an m-search:\n%d\n%s\n%s', code, JSON.stringify(headers, null, '  '), JSON.stringify(rinfo, null, '  '))
            if (headers.ST === 'urn:schemas-upnp-org:device:PoolController:1') {
                self.config.ip_address = headers.LOCATION.replace('/device','');
                self.log('Found nodejs-poolController at %s.', self.config.ip_address)
                client.stop()
                clearTimeout(timer)
                self.validateVersion(headers.LOCATION)
            }
        })

        client.search('urn:schemas-upnp-org:device:PoolController:1')

        //Or maybe if you want to scour for everything after 5 seconds
        timer = setInterval(function () {
            elapsedTime += 5;
            client.search('urn:schemas-upnp-org:device:PoolController:1')
            self.log('Can not find nodejs-PoolController after %s seconds.', elapsedTime)
        }, 5000)

    } else {
      self.validateVersion(self.config.ip_address + "/device");
    }
}

PoolControllerPlatform.prototype.validateVersion = function (URL) {
    var self = this;
    var request = require('request')
        , valid = false
        , validMajor = 4
        , validMinor = 1
    request(URL, function (error, response, body) {
        if (error)
            self.log('Error retrieving configuration from poolController.', error)
        else {
            var major = parseInt(body.match("<major>(.*)</major>")[1])
            var minor = parseInt(body.match("<minor>(.*)</minor>")[1])
            if (major > validMajor)
                valid = true
            else if (major === validMajor && minor >= validMinor)
                valid = true
            if (valid)
                self.socketInit()
            else {
                self.log.error('Version of poolController %s.%s does not meet the minimum for this Homebridge plugin %s.%s', major, minor, validMajor, validMinor)
                process.exit()
            }
        }
    })


}


PoolControllerPlatform.prototype.socketInit = function () {
    var self = this;
    socket = io.connect(self.config.ip_address, {
        secure: self.config.secure,
        reconnect: true,
        rejectUnauthorized: false
    });


    socket.on('connection', function () {
        self.log('homebridge-poolcontroller connected to the server')
    })
    socket.on('connect_error', function () {
        self.log('ERROR: homebridge-poolcontroller can NOT find the pool controller')
    })
    // will eventually change to 'all' instead of 'one'
    socket.once('all', function (data) {
        self.InitialData(data);
    });
    socket.on('error', function (data) {
        console.log('Socket error:', data)
    });


};

PoolControllerPlatform.prototype.InitialData = function (data) {

    socket.off("one");
    if (debug) this.log("InitialData:", data);
    var circuitData = data.circuit;

    for (var i in circuitData) {
        if (circuitData[i].name !== "NOT USED") {

            var circuitNumber = circuitData[i].number;
            var circuitFunction = circuitData[i].circuitFunction.toLowerCase();
            var circuitName = circuitData[i].friendlyName;

            var circuitState = circuitData[i].status;

            var id = "poolController." + circuitData[i].numberStr + "." + circuitName; //added circuitName because circuit numbers will never change.  Changing the name will trigger a new UUID/device.
            var uuid = UUIDGen.generate(id);
            if (debug) console.log('in InitialData circuitFunction: %s, circuitNumber: %s, id: %s, uuid: %s', circuitFunction, circuitNumber, id, uuid)
            var cachedAccessory = this.accessories[uuid];

            // type === light
            if (['intellibrite', 'light', 'sam light', 'sal light', 'color wheel'].indexOf(circuitFunction) >= 0) {
                if (cachedAccessory === undefined) {
                    this.addLightAccessory(this.log, id, circuitName, circuitNumber, circuitState, socket);
                } else {
                    this.accessories[uuid] = new lightAccessory(this.log, cachedAccessory, circuitNumber, circuitState, Homebridge, socket);
                }
            } else {
                if (cachedAccessory === undefined) {
                    this.addCircuitAccessory(this.log, id, circuitName, circuitNumber, circuitState, socket);
                } else {

                    // deal with heaters below
                    if (!cachedAccessory.displayName.includes("Heater")) {
                        this.accessories[uuid] = new circuitAccessory(this.log, cachedAccessory, circuitNumber, circuitState, Homebridge, socket);
                    }
                    else {
                        console.log('Skipping cached accessory because it is a heater. %s', cachedAccessory.displayName)
                    }
                }
            }


            // Used for when blacklisting is added to get circuit identifier.
            this.log("Found circuit %s (function: %s) with identifier: %s", circuitName, circuitFunction, id);
            // Add heater accessory
            if (circuitFunction === "pool" || circuitFunction === "spa") {
                id += ".heater";
                circuitName += " Heater"

                uuid = UUIDGen.generate(id);
                cachedAccessory = this.accessories[uuid];


                var temperature = data.temperature;
                var heaterActive = temperature.heaterActive;
                var targetHeatingCoolingState = targetHeatingCoolingStateForHeatModeAndCircuitState(heatMode, circuitState);
                var heatMode = temperature[circuitFunction + "HeatMode"] == 1 ? 1 : 0; // Don't allow solar for now. Not sure how interface with that.
                var currentTemperature = temperature[circuitFunction + "Temp"];
                var targetTemperature = temperature[circuitFunction + "SetPoint"];

                if (cachedAccessory === undefined) {
                    this.addHeaterAccessory(this.log, id, circuitName, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, socket);
                } else {
                    this.accessories[uuid] = new heaterAccessory(this.log, cachedAccessory, circuitFunction, circuitNumber, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, Homebridge, socket); //change heatmode to heater active later
                }

            }
        }
    }

    socket.on('circuit', this.socketCircuitUpdated.bind(this));
    socket.on('temperature', this.socketTemperatureUpdated.bind(this));
};

PoolControllerPlatform.prototype.socketCircuitUpdated = function (circuitData) {
    //if (debug) this.log('FROM SOCKET CLIENT CIRCUIT: ' + JSON.stringify(circuitData, null, "\t"));
    circuitData = circuitData.circuit
    for (var i = 1; i <= Object.keys(circuitData).length; i++) {
        //console.log("Analyzing circuit %s of %s", i, Object.keys(circuitData).length)
        if (circuitData[i].numberStr !== undefined || circuitData[i].name !== "NOT USED") {
            var id = "poolController." + circuitData[i].numberStr + "." + circuitData[i].name; //added circuitName because circuit numbers will never change.  Changing the name will trigger a new UUID/device.
            var uuid = UUIDGen.generate(id);
            var accessory = this.accessories[uuid];
            var circuit = circuitData[i].number;
            var circuitState = circuitData[i].status;
            if (accessory !== undefined) {
                accessory.updateCircuitState(circuitState); // All accessories should have a circuit state associated to them.
            }

            var circuitFunction = circuitData[i].circuitFunction.toLowerCase()
            // also send to heater
            if (circuitFunction === "pool" || circuitFunction === "spa") {
                id += '.heater'
                uuid = UUIDGen.generate(id);
                accessory = this.accessories[uuid];
                if (accessory !== undefined) {
                    accessory.updateCircuitState(circuitState); // All accessories should have a circuit state associated to them.
                }
            }
        }
    }
};

PoolControllerPlatform.prototype.socketTemperatureUpdated = function (temperatureData) {
    //if (debug) this.log('FROM SOCKET CLIENT CIRCUIT: ' + JSON.stringify(temperatureData, null, "\t"));
    temperatureData = temperatureData.temperature
    for (var uuid in this.accessories) {
        //console.log("Analyzing temperature %s of %s", i, Object.keys(temperatureData).length)
        if ((this.accessories[uuid].accessory.displayName).includes('Heater')) {
            this.accessories[uuid].updateTemperatureState(temperatureData); // All heaters should have a temperature state associated to them.
        }
    }
}


PoolControllerPlatform.prototype.configureAccessory = function (accessory) {
    accessory.reachable = false; // Don't allow accessories to be controlled until we associate circuits/circuitState to them.
    this.accessories[accessory.UUID] = accessory; // Throw it into dictionary to be updated with initial data.
    console.log('%s (%s) - added to local current array from cache with UUID:%s ', accessory.displayName, accessory.id, accessory.UUID);
};

PoolControllerPlatform.prototype.addCircuitAccessory = function (log, identifier, accessoryName, circuit, power, socket) {
    this.log("Adding new circuit accessory with name " + accessoryName);
    var uuid = UUIDGen.generate(identifier);
    var accessory = new Accessory(accessoryName, uuid);
    accessory.addService(Service.Switch, accessoryName);

    this.accessories[uuid] = new circuitAccessory(log, accessory, circuit, power, Homebridge, socket);
    this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);

    //get this info from socket? does it matter? also model and serial.
    accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");

};

PoolControllerPlatform.prototype.addLightAccessory = function (log, identifier, accessoryName, circuit, power, socket) {
    this.log("Adding new light accessory with name " + accessoryName);
    var uuid = UUIDGen.generate(identifier);
    var accessory = new Accessory(accessoryName, uuid);
    accessory.addService(Service.Lightbulb, accessoryName);

    this.accessories[uuid] = new lightAccessory(log, accessory, circuit, power, Homebridge, socket);
    this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);

    //get this info from socket? does it matter? also model and serial.
    accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");

};

PoolControllerPlatform.prototype.addHeaterAccessory = function (log, identifier, accessoryName, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, socket) {
    this.log("Adding new heater accessory with name " + accessoryName);
    var uuid = UUIDGen.generate(identifier);
    var accessory = new Accessory(accessoryName, uuid);
    accessory.addService(Service.Thermostat, accessoryName);

    accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, "Pentair");

    this.accessories[uuid] = new heaterAccessory(log, accessory, type, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, Homebridge, socket);
    this.api.registerPlatformAccessories("homebridge-PoolControllerPlatform", "PoolControllerPlatform", [accessory]);
};
