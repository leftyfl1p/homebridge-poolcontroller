var Accessory, Service, Characteristic, UUIDGen;
var debug = false;

var PoolCircuitAccessory = function(log, accessory, circuit, circuitState, homebridge, socket) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  Homebridge = homebridge;

  this.accessory = accessory;
  this.log = log;
  this.circuit = circuit;
  this.circuitState = circuitState;
  this.service = this.accessory.getService(Service.Lightbulb);
  this.socket = socket;

  if (this.service) {
    this.service
      .getCharacteristic(Characteristic.On)
      .on('set', this.setCircuitState.bind(this))
      .on('get', this.getCircuitState.bind(this));
  }

  accessory.updateReachability(true);
}

PoolCircuitAccessory.prototype.setCircuitState = function(circuitState, callback) {
  if (this.circuitState !== circuitState) {

    var circuitStateBinary = circuitState ? 1 : 0;
    this.log("Setting Circuit", this.accessory.displayName, "to", circuitStateBinary);
    this.socket.emit("toggleCircuit", this.circuit);
    //this.updateCircuitState(circuitState);
    //this following line will update the value without the internal callback to getCircuitState
    //this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).updateValue(circuitState);

  }

  callback();

};

PoolCircuitAccessory.prototype.getCircuitState = function(callback) {
  callback(null, this.circuitState);
};

// For when state is changed elsewhere.
PoolCircuitAccessory.prototype.updateCircuitState = function(circuitState) {
  if (this.circuitState !== circuitState) {
    this.log("Update Light State for %s (state: %s-->%s)", this.accessory.displayName, this.circuitState, circuitState)
    this.circuitState = circuitState;

    // since this is being called internally (via the socket initiation), call the function that will call the callback
  //this.accessory.getService(Service.Lightbulb).setCharacteristic(Characteristic.On, circuitState) // DO NOT USE - creates an infinite loop

   // this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).setValue(circuitState) // works
    this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).updateValue(circuitState); // works
    //this.service.getCharacteristic(Characteristic.On).setValue(this.circuitState); // works

  } else {
    //console.log("No change in state for %s", this.accessory.displayName)
  }
  return
};

module.exports = PoolCircuitAccessory;
