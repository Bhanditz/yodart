var logger = require('logger')('custodian')
var property = require('@yoda/property')
var Network = require('@yoda/network')
var bluetooth = require('@yoda/bluetooth')

var RuntimeState = {
  RAW_NETWORK: 0,
  CONFIGURING_NETWORK: 1,
  CONNECTING_NETWORK: 2,
  LOGGING: 3,
  LOGGED_IN: 4,
}

module.exports = Custodian

function Custodian (runtime) {
  this.runtime = runtime
  this.component = runtime.component
  this.masterId = null

  this.runtimeState = RuntimeState.RAW_NETWORK
  this.networkDisconnOccur = null
  this.networkDisconnInterval = 10 * 1000

  this.network = new Network(this.component.flora, true)
  this.initNetwork()

  this.bluetoothStream = bluetooth.getMessageStream()
  this.bleOpened = false
  this.bleTimer = null
  this.bleMaxAlive = 180 * 1000
  this.initBluetooth()
}

Custodian.prototype.reConfigureNetwork = function () {
  this.runtimeState = RuntimeState.CONFIGURING_NETWORK
  this.openBluetooth()
}

Custodian.prototype.resetState = function () {
  this.runtimeState = RuntimeState.RAW_NETWORK
}

Custodian.prototype.isConfiguringNetwork = function () {
  return this.runtimeState === RuntimeState.CONFIGURING_NETWORK
}

Custodian.prototype.isLogging = function () {
  return this.runtimeState === RuntimeState.LOGGING
}

Custodian.prototype.isLoggedIn = function () {
  return this.runtimeState === RuntimeState.LOGGED_IN
}

Custodian.prototype.onLoggedIn = function () {
  this.runtimeState = RuntimeState.LOGGED_IN
  this.network.wifiStopScan()
  this.closeBluetooth(0, { topic: 'bind', sCode: code, sMsg: msg })
}

Custodian.prototype.initNetwork = function () {
  this.network.subscribe()

  this.network.on('network.status', function (status) {
    if (status.state === Network.CONNECTED) {
      /**
        * Start login when received event that network has connected
        */
      if (this.networkDisconnOccur)
        this.networkDisconnOccur = null

      if (this.runtimeState === RuntimeState.CONNECTING_NETWORK ||
          this.runtimeState === RuntimeState.RAW_NETWORK) {
        property.set('state.network.connected', 'true')

        if (this.masterId) {
          this.runtime.login({ masterId: this.masterId })
        } else {
          this.runtime.login()
        }
        this.runtimeState = RuntimeState.LOGGING
        logger.info(`connecting masterId=${this.masterId} is set`)
      }
    } else if (status.state === Network.DISCONNECTED) {
      /**
        * Reset runtimeState when received event that network is
        * disconnected continuously in ten seconds
        */
      if (this.networkDisconnOccur === null) {
        this.networkDisconnOccur = Date.now()
      } else if (Date.now() - this.networkDisconnOccur
        > this.networkDisconnInterval) {
        this.networkDisconnInterval = null
        property.set('state.network.connected', 'false')
        this.runtimeState = RuntimeState.RAW_NETWORK
      }
    }
  }.bind(this))

  this.network.triggerStatus()

  /**
   * TODO: re-configure network when wpa_supplicant.conf does not exists
   */
  //setTimeout(() => {
  //  if (this.runtimeState === RuntimeState.RAW_NETWORK) {
  //    this.reConfigureNetwork()
  //  }
  //}.bind(this), 15 * 1000)
}

Custodian.prototype.initBluetooth = function () {
  this.bluetoothStream.on('handshaked', () => {
    this.component.light.appSound('@yoda', 'system://ble_connected.ogg')
    logger.debug('ble device connected')
  }.bind(this))

  this.bluetoothStream.on('disconnected', () => {
    logger.debug('ble device disconnected')
  }.bind(this))

  this.bluetoothStream.on('data', function (message) {
    logger.debug(message)

    if (message.topic === 'getCapacities') {
      this.network.capacities().then((reply) => {
        var msg = JSON.parse(reply.msg[0])
        this.bluetoothStream.write({topic: 'getCapacities', data: msg})
      })

    } else if (message.topic === 'getWifiList') {
      this.network.wifiScanList().then((reply) => {
        var msg = JSON.parse(reply.msg[0])

        var wifiList = msg.wifilist.map((item) => {
          return {S: item.SSID, L: item.SIGNAL}
        })

        this.bluetoothStream.write({topic: 'getWifiList', data: wifiList})
      })

    } else if (message.topic === 'bind') {
      this.masterId = message.data.U
      this.runtimeState = RuntimeState.CONNECTING_NETWORK
      this.network.wifiOpen(message.data.S, message.data.P).then((reply) => {
        this.runtime.dispatchNotification('on-network-connected', [])

        property.set('persist.netmanager.wifi', 1)
        property.set('persist.netmanager.wifi_ap', 0)
        this.component.light.appSound(
          '@yoda', 'system://prepare_connect_wifi.ogg')
        this.bluetoothStream.write(
          {topic: 'bind', sCode: '11', sMsg: 'wifi连接成功'})
      }, (err) => {
        property.set('persist.netmanager.wifi', 0)
        this.component.light.appSound(
          '@yoda', 'system://wifi/connect_timeout.ogg')
        this.bluetoothStream.write(
          {topic: 'bind', sCode: '-12', sMsg: 'wifi连接超时'})
      })

    } else if (message.topic === 'bindModem') {
      this.network.modemOpen().then((reply) => {
        property.set('persist.netmanager.modem', 'true')
        // FIXME: play modem/connect_failed.ogg instead
        this.component.light.appSound(
          '@yoda', 'system://prepare_connect_wifi.ogg')
        this.bluetoothStream.write(
          {topic: 'bindModem', sCode: '11', sMsg: 'modem连接成功'})
      }, (err) => {
        property.set('persist.netmanager.modem', 'false')
        // FIXME: play modem/connect_failed.ogg instead
        this.component.light.appSound(
          '@yoda', 'system://wifi/connect_timeout.ogg')
        this.bluetoothStream.write(
          {topic: 'bindModem', sCode: '-12', sMsg: 'modem连接失败'})
      })
    }
  }.bind(this))
}

Custodian.prototype.openBluetooth = function () {
  var uuid = (property.get('ro.boot.serialno') || '').substr(-6)
  var productName = property.get('ro.rokid.build.productname') || 'Rokid-Me'
  var BLE_NAME = [ productName, uuid ].join('-')

  this.bluetoothStream.start(BLE_NAME, (err) => {
    if (err) {
      logger.info('open ble failed, name', BLE_NAME)
      logger.error(err && err.stack)
      return
    }

    this.bleOpened = true
    this.component.light.appSound('@yoda', 'system://wifi/setup_network.ogg')
    this.component.light.play(
      '@yoda', 'system://setStandby.js', {}, { shouldResume: true })
    logger.info('open ble success, name', BLE_NAME)
  })

  this.closeBluetooth(this.bleMaxAlive)
}

Custodian.prototype.closeBluetooth = function (delaySecond, msg) {
  if (msg) {
    this.bluetoothStream.write(msg)
  }

  clearTimeout(this.bleTimer)
  this.bleTimer = setTimeout(() => {
    this.bleOpened = false
    this.component.light.stop('@yoda', 'system://setStandby.js')
    if (delaySecond === 0) {
      setTimeout(() => this.bluetoothStream.end(), 2000)
    }
  }, delaySecond)
}

Custodian.prototype.turenDidWakeUp = function () {
  if (this.runtimeState !== RuntimeState.RAW_NETWORK) {
    return
  }
  this.component.turen.pickup(false)

  logger.info('Network not connected, announcing guide to network configuration.')
  return this.component.light.ttsSound(
    '@yoda', 'system://guide_config_network.ogg').then(() =>
      /** awaken is not set for no network available, recover media directly */
      this.component.turen.recoverPausedOnAwaken()
    )
}
