'use strict'

/**
 * @module @yoda/network
 * @description Provides classes to manage network functions on the device.
 */

var EventEmitter = require('events').EventEmitter

class Network extends EventEmitter {
  constructor (flora) {
    super()

    this._remoteCallTarget = 'net_manager'
    this._remoteCallCommand = 'network.command'
    this._remoteCallTimeout = 60 * 1000

    this._flora = flora
  }

  subscribe () {
    this._flora.subscribe('network.status', (caps, type) => {
      var msg = JSON.parse(caps[0])

      if (msg.network) {
        this.emit('network.status', msg.network)
      } else if (msg.wifi) {
        this.emit('wifi.status', msg.wifi)
      } else if (msg.ethernet) {
        this.emit('ethernet.status', msg.ethernet)
      } else if (msg.modem) {
        this.emit('modem.status', msg.modem)
      }
    })
  }

  _remoteCall (device, command, params) {
    var data = {
      device: device,
      command: command
    }
    if (params) { data.params = params }

    return this._flora.call(
      this._remoteCallCommand,
      [JSON.stringify(data)],
      this._remoteCallTarget,
      this._remoteCallTimeout
    )
  }

  triggerStatus () {
    return this._remoteCall('NETWORK', 'TRIGGER_STATUS')
  }

  capacities () {
    return this._remoteCall('NETWORK', 'GET_CAPACITY')
  }

  getStatus (device) {
    return this._remoteCall(device, 'GET_STATUS')
  }

  wifiOpen (ssid, passwd) {
    return this._remoteCall('WIFI', 'CONNECT', {'SSID': ssid, 'PASSWD': passwd})
  }

  wifiClose () {
    return this._remoteCall('WIFI', 'DISCONNECT')
  }

  wifiStartScan () {
    return this._remoteCall('WIFI', 'START_SCAN')
  }

  wifiStopScan () {
    return this._remoteCall('WIFI', 'STOP_SCAN')
  }

  wifiScanList () {
    return this._remoteCall('WIFI', 'GET_WIFILIST')
  }

  wifiApOpen (ssid, passwd, ip, timeout) {
    return this._remoteCall('WIFI_AP', 'CONNECT', {
      SSID: ssid,
      PASSWD: passwd,
      IP: ip,
      TIMEOUT: timeout
    })
  }

  wifiApClose () {
    return this._remoteCall('WIFI_AP', 'DISCONNECT')
  }

  modemOpen () {
    return this._remoteCall('MODEM', 'CONNECT')
  }

  modemClose () {
    return this._remoteCall('MODEM', 'DISCONNECT')
  }
}

Network.CONNECTED = 'CONNECTED'
Network.DISCONNECTED = 'DISCONNECTED'

module.exports = Network
